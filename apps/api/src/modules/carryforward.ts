import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma, type Db } from '../db';
import { handle, parse } from '../lib/http';
import { badRequest, conflict } from '../lib/errors';
import { audit } from '../lib/audit';
import { parseDate } from '../lib/dates';
import { nextChargeNo } from '../lib/ids';
import { dec, money, sum } from '../lib/money';
import { currentUser, requirePermission } from '../auth/session';
import { ARREARS_FEE_CODE } from '../finance/reference';
import { checkTermOpen } from '../finance/periods';
import { getTerm, termLabel } from './setup';
import { loadCharges } from './charges';

export const router = Router();

/** FR-1101 to FR-1105: find charges in the source term with a positive balance (credits excluded, BR-19). */
export async function buildCarryPreview(db: Db, sourceTermId: number, destTermId: number) {
  if (sourceTermId === destTermId) throw badRequest('Choose a later term as the destination');
  const [source, dest] = await Promise.all([getTerm(db, sourceTermId), getTerm(db, destTermId)]);
  if (dest.startDate <= source.startDate) throw badRequest(`${termLabel(dest)} is not after ${termLabel(source)}. Arrears can only move forward.`);
  const examined = await db.chargeBalance.count({ where: { termId: sourceTermId, voided: false } });
  const candidates = await db.chargeBalance.findMany({ where: { termId: sourceTermId, voided: false, balance: { gt: 0 }, status: { not: 'CARRIED_FORWARD' } } });
  const charges = await loadCharges(db, candidates.map((c) => c.chargeId));
  const rows = charges
    .map((c) => ({ ...c, blockedReason: dec(c.pendingDiscount).gt(0) ? 'A discount on this charge is waiting for approval. Decide it first.' : null }))
    .sort((a, b) => a.pupilName.localeCompare(b.pupilName) || a.feeItemName.localeCompare(b.feeItemName));
  const ready = rows.filter((r) => !r.blockedReason);
  const diagnostics: string[] = [];
  if (examined === 0) diagnostics.push(`There are no charges in ${termLabel(source)}. Check the source term, or bill it first.`);
  else if (rows.length === 0) diagnostics.push(`All ${examined} charges in ${termLabel(source)} are fully settled or already carried forward. Nothing to carry.`);
  return {
    source: { id: source.id, label: termLabel(source) },
    dest: { id: dest.id, label: termLabel(dest), status: dest.status },
    counts: { examined, withBalance: rows.length, ready: ready.length, blocked: rows.length - ready.length },
    totalArrears: money(sum(ready.map((r) => r.balance))),
    diagnostics,
    rows,
  };
}

router.post(
  '/preview',
  requirePermission('carryforward.run'),
  handle(async (req) => {
    const body = parse(z.object({ sourceTermId: z.number().int(), destTermId: z.number().int() }), req.body);
    return buildCarryPreview(prisma, body.sourceTermId, body.destTermId);
  }),
);

/** D-01, BR-20, WR-18: each unpaid charge becomes its own Arrears B/F charge, and the source is closed by transfer. */
router.post(
  '/post',
  requirePermission('carryforward.run'),
  handle(async (req) => {
    const body = parse(
      z.object({
        sourceTermId: z.number().int(),
        destTermId: z.number().int(),
        idempotencyKey: z.string().min(8).max(100),
        chargeIds: z.array(z.number().int()).optional(),
        dueDate: z.string().nullable().optional(),
        confirm: z.literal(true, { errorMap: () => ({ message: 'Confirm the carry-forward' }) }),
      }),
      req.body,
    );
    const user = currentUser(req);
    const previous = await prisma.carryForwardBatch.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
    if (previous) return { batchId: previous.id, repeated: true, carried: previous.chargeCount, totalAmount: money(previous.totalAmount) };
    const postClose = await checkTermOpen(prisma, user, body.destTermId);
    const dueDate = body.dueDate ? parseDate(body.dueDate, 'Due date') : null;
    const arrearsItem = await prisma.feeItem.findUniqueOrThrow({ where: { code: ARREARS_FEE_CODE } });

    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "Charge" WHERE "termId" = ${body.sourceTermId} FOR UPDATE`;
          const preview = await buildCarryPreview(tx, body.sourceTermId, body.destTermId);
          if (preview.diagnostics.length) throw badRequest(preview.diagnostics.join(' '));
          let rows = preview.rows.filter((r) => !r.blockedReason);
          if (body.chargeIds) {
            const wanted = new Set(body.chargeIds);
            if (preview.rows.some((r) => wanted.has(r.id) && r.blockedReason)) throw badRequest('Some selected charges have discounts waiting for approval');
            rows = rows.filter((r) => wanted.has(r.id));
            if (rows.length !== wanted.size) throw badRequest('Some selected charges no longer have a balance to carry. Preview again.');
          }
          if (rows.length === 0) throw badRequest('Nothing selected to carry forward');
          const total = sum(rows.map((r) => r.balance));
          const batch = await tx.carryForwardBatch.create({
            data: { idempotencyKey: body.idempotencyKey, sourceTermId: body.sourceTermId, destTermId: body.destTermId, chargeCount: rows.length, totalAmount: total, createdById: user.id },
          });
          for (const r of rows) {
            const pupil = await tx.pupil.findUniqueOrThrow({ where: { id: r.pupilId } });
            await tx.charge.update({ where: { id: r.id }, data: { carriedForwardAmount: dec(r.balance), carryForwardBatchId: batch.id, updatedById: user.id } });
            await tx.charge.create({
              data: {
                chargeNo: await nextChargeNo(tx),
                pupilId: r.pupilId,
                termId: body.destTermId,
                classId: pupil.classId,
                feeItemId: arrearsItem.id,
                amountCharged: dec(r.balance),
                dueDate,
                sourceChargeId: r.id,
                carryForwardBatchId: batch.id,
                postClose,
                notes: `Brought forward from ${r.chargeNo} (${r.feeItemName}, ${r.termLabel})`,
                createdById: user.id,
                updatedById: user.id,
              },
            });
          }
          await audit(tx, user, 'carryforward.post', 'CarryForwardBatch', batch.id, { after: { source: preview.source.label, dest: preview.dest.label, count: rows.length, total: money(total) } });
          return { batchId: batch.id, repeated: false, carried: rows.length, totalAmount: money(total) };
        },
        { timeout: 60_000 },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw conflict('Some of these balances have already been carried forward. Preview again.');
      }
      throw err;
    }
  }),
);

router.get(
  '/batches',
  requirePermission('charges.view'),
  handle(async () => {
    const batches = await prisma.carryForwardBatch.findMany({
      include: { sourceTerm: { include: { academicYear: true } }, destTerm: { include: { academicYear: true } } },
      orderBy: { id: 'desc' },
      take: 100,
    });
    return batches.map((b) => ({ id: b.id, source: termLabel(b.sourceTerm), dest: termLabel(b.destTerm), chargeCount: b.chargeCount, totalAmount: money(b.totalAmount), createdAt: b.createdAt }));
  }),
);
