import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma, type Db } from '../db';
import { handle, pagination, parse } from '../lib/http';
import { badRequest, conflict, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { parseDate } from '../lib/dates';
import { nextChargeNo } from '../lib/ids';
import { dec, money, sum } from '../lib/money';
import { currentUser, requirePermission } from '../auth/session';
import { frequencySkipReason } from '../finance/policies';
import { checkTermOpen } from '../finance/periods';
import { getTerm, termLabel } from './setup';
import { moneyInput } from './fees';
import { requestDiscount } from './charges';

export const router = Router();

export interface BillingRow {
  key: string;
  pupilId: number;
  pupilCode: string;
  pupilName: string;
  feeItemId: number;
  feeItemName: string;
  frequency: string;
  mandatory: boolean;
  amount: string;
  /** Set when the row would not be charged; "duplicate" rows can never be overridden. */
  skipReason: string | null;
  duplicate: boolean;
}

/** FR-1001 to FR-1004: build the proposed charges for one term and class, with diagnostics. */
export async function buildPreview(db: Db, termId: number, classId: number) {
  const term = await getTerm(db, termId);
  const cls = await db.schoolClass.findUnique({ where: { id: classId }, include: { section: true } });
  if (!cls) throw notFound('Class');
  const [lines, pupils] = await Promise.all([
    db.feeStructure.findMany({ where: { termId, classId, feeItem: { active: true } }, include: { feeItem: true }, orderBy: { feeItem: { sortOrder: 'asc' } } }),
    // FR-207 / BR-16: only Active pupils are billed.
    db.pupil.findMany({ where: { classId, status: 'ACTIVE' }, orderBy: { fullName: 'asc' } }),
  ]);

  const diagnostics: string[] = [];
  const where = `${cls.name}, ${termLabel(term)}`;
  if (lines.length === 0) diagnostics.push(`No fee structure exists for ${where}. Enter the fees for this class and term on the Fee structure page first (BR-15).`);
  if (pupils.length === 0) diagnostics.push(`There are no Active pupils in ${cls.name}. Register pupils or check their status and class on the Pupils page.`);

  const existing = pupils.length && lines.length
    ? await db.charge.findMany({
        where: { pupilId: { in: pupils.map((p) => p.id) }, feeItemId: { in: lines.map((l) => l.feeItemId) }, voidedAt: null, sourceChargeId: null },
        include: { term: true },
      })
    : [];

  const rows: BillingRow[] = [];
  for (const p of pupils) {
    for (const l of lines) {
      const mine = existing.filter((c) => c.pupilId === p.id && c.feeItemId === l.feeItemId);
      const history = {
        everCharged: mine.length > 0,
        chargedThisYear: mine.some((c) => c.term.academicYearId === term.academicYearId),
        chargedThisTerm: mine.some((c) => c.termId === termId),
      };
      rows.push({
        key: `${p.id}:${l.feeItemId}`,
        pupilId: p.id,
        pupilCode: p.pupilCode,
        pupilName: p.fullName,
        feeItemId: l.feeItemId,
        feeItemName: l.feeItem.name,
        frequency: l.feeItem.frequency,
        mandatory: l.mandatory,
        amount: money(l.amount),
        skipReason: frequencySkipReason(l.feeItem.frequency, history),
        duplicate: history.chargedThisTerm,
      });
    }
  }
  const billable = rows.filter((r) => !r.skipReason);
  return {
    term: { id: term.id, label: termLabel(term), status: term.status },
    class: { id: cls.id, name: cls.name, sectionName: cls.section.name },
    counts: { feeItems: lines.length, activePupils: pupils.length, proposedRows: rows.length, billableRows: billable.length, skippedRows: rows.length - billable.length },
    totalAmount: money(sum(billable.map((r) => r.amount))),
    diagnostics,
    rows,
  };
}

router.post(
  '/preview',
  requirePermission('billing.run'),
  handle(async (req) => {
    const body = parse(z.object({ termId: z.number().int(), classId: z.number().int() }), req.body);
    return buildPreview(prisma, body.termId, body.classId);
  }),
);

const postBody = z.object({
  termId: z.number().int(),
  classId: z.number().int(),
  idempotencyKey: z.string().min(8).max(100),
  dueDate: z.string().nullable().optional(),
  confirm: z.literal(true, { errorMap: () => ({ message: 'Confirm that you have reviewed the charges' }) }),
  // Per-row decisions from the review step (FR-1005). Rows not listed are posted as proposed.
  rows: z
    .array(
      z.object({
        key: z.string(),
        include: z.boolean().default(true),
        discount: moneyInput.optional().nullable(),
        discountReason: z.string().trim().max(300).optional().nullable(),
        overrideReason: z.string().trim().max(300).optional().nullable(),
      }),
    )
    .default([]),
});

/** FR-1006 (PC-01): post the reviewed rows as charges in one transaction. Idempotent (WR-07). */
router.post(
  '/post',
  requirePermission('billing.run'),
  handle(async (req) => {
    const body = parse(postBody, req.body);
    const user = currentUser(req);
    const previous = await prisma.billingBatch.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
    if (previous) return { batchId: previous.id, repeated: true, ...(previous.summary as object) };

    const postClose = await checkTermOpen(prisma, user, body.termId);
    const dueDate = body.dueDate ? parseDate(body.dueDate, 'Due date') : null;
    const decisions = new Map(body.rows.map((r) => [r.key, r]));

    try {
      return await prisma.$transaction(
        async (tx) => {
          const preview = await buildPreview(tx, body.termId, body.classId);
          if (preview.diagnostics.length) throw badRequest(preview.diagnostics.join(' '));
          for (const key of decisions.keys()) {
            if (!preview.rows.some((r) => r.key === key)) throw badRequest('The billing list has changed since you previewed it. Preview again.');
          }
          const created: Array<{ key: string; chargeId: number }> = [];
          const skipped: Array<{ pupilName: string; feeItemName: string; reason: string }> = [];
          let total = dec(0);
          for (const row of preview.rows) {
            const d = decisions.get(row.key);
            const include = d?.include ?? true;
            if (!include) {
              // A-08: mandatory items cannot be removed in the review step.
              if (row.mandatory) throw badRequest(`${row.feeItemName} is mandatory and cannot be removed for ${row.pupilName}`);
              skipped.push({ pupilName: row.pupilName, feeItemName: row.feeItemName, reason: 'Optional item removed in review' });
              continue;
            }
            if (row.duplicate) {
              skipped.push({ pupilName: row.pupilName, feeItemName: row.feeItemName, reason: row.skipReason! });
              continue;
            }
            if (row.skipReason && !d?.overrideReason) {
              skipped.push({ pupilName: row.pupilName, feeItemName: row.feeItemName, reason: row.skipReason });
              continue;
            }
            if (dec(row.amount).lte(0)) {
              skipped.push({ pupilName: row.pupilName, feeItemName: row.feeItemName, reason: 'Fee amount is zero' });
              continue;
            }
            const pupil = await tx.pupil.findUniqueOrThrow({ where: { id: row.pupilId } });
            const charge = await tx.charge.create({
              data: {
                chargeNo: await nextChargeNo(tx),
                pupilId: row.pupilId,
                termId: body.termId,
                classId: pupil.classId,
                feeItemId: row.feeItemId,
                amountCharged: dec(row.amount),
                dueDate,
                frequencyOverrideReason: row.skipReason ? d!.overrideReason : null,
                postClose,
                createdById: user.id,
                updatedById: user.id,
              },
            });
            if (d?.discount && dec(d.discount).gt(0)) {
              if (!d.discountReason) throw badRequest(`Give a reason for the discount for ${row.pupilName}`);
              await requestDiscount(tx, user.id, charge.id, d.discount, d.discountReason);
            }
            total = total.plus(row.amount);
            created.push({ key: row.key, chargeId: charge.id });
          }
          const summary = { created: created.length, skipped, totalAmount: money(total), termLabel: preview.term.label, className: preview.class.name };
          const batch = await tx.billingBatch.create({
            data: {
              idempotencyKey: body.idempotencyKey, termId: body.termId, classId: body.classId,
              createdCount: created.length, skippedCount: skipped.length, totalAmount: total, summary, createdById: user.id,
            },
          });
          if (created.length) await tx.charge.updateMany({ where: { id: { in: created.map((c) => c.chargeId) } }, data: { billingBatchId: batch.id } });
          await audit(tx, user, 'billing.post', 'BillingBatch', batch.id, { after: summary });
          return { batchId: batch.id, repeated: false, ...summary };
        },
        { timeout: 60_000 },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const again = await prisma.billingBatch.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
        if (again) return { batchId: again.id, repeated: true, ...(again.summary as object) };
        throw conflict('Some of these charges were posted by someone else at the same time. Preview again.');
      }
      throw err;
    }
  }),
);

router.get(
  '/batches',
  requirePermission('charges.view'),
  handle(async (req) => {
    const { skip, take } = pagination(req.query);
    const batches = await prisma.billingBatch.findMany({
      include: { term: { include: { academicYear: true } }, schoolClass: true },
      orderBy: { id: 'desc' },
      skip,
      take,
    });
    return batches.map((b) => ({
      id: b.id, termLabel: termLabel(b.term), className: b.schoolClass.name, createdCount: b.createdCount,
      skippedCount: b.skippedCount, totalAmount: money(b.totalAmount), createdAt: b.createdAt,
    }));
  }),
);
