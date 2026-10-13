import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { handle, idParam, pagination, parse } from '../lib/http';
import { AppError, badRequest, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { displayDate, isoDate, parseDate, todayKampala } from '../lib/dates';
import { nextReceiptNo } from '../lib/ids';
import { dec, money, sum } from '../lib/money';
import { sendCsv, wantsCsv } from '../lib/csv';
import { currentUser, hasPermission, requirePermission } from '../auth/session';
import { assertDifferentApprover, receiptYear } from '../finance/policies';
import { checkTermOpen } from '../finance/periods';
import { assertRefCode, getSettings } from './setup';
import { moneyInput } from './fees';
import { loadCharges, userNames } from './charges';

export const router = Router();

/** Charges a pupil can still pay, oldest term first (A-09: payments must go to an existing charge). */
router.get(
  '/allocatable/:pupilId',
  requirePermission('payments.record'),
  handle(async (req) => {
    const pupilId = idParam(req, 'pupilId');
    const rows = await prisma.chargeBalance.findMany({
      where: { pupilId, voided: false, status: { in: ['UNPAID', 'PARTIAL'] } },
      select: { chargeId: true },
    });
    const charges = await loadCharges(prisma, rows.map((r) => r.chargeId));
    return charges.sort((a, b) => a.year - b.year || a.termLabel.localeCompare(b.termLabel) || a.feeItemName.localeCompare(b.feeItemName));
  }),
);

const paymentBody = z.object({
  pupilId: z.number().int(),
  paymentDate: z.string(),
  method: z.string(),
  reference: z.string().trim().max(100).transform((v) => v || null).nullable().optional(),
  notes: z.string().trim().max(500).transform((v) => v || null).nullable().optional(),
  idempotencyKey: z.string().min(8).max(100),
  acknowledgeOverpayment: z.boolean().optional(),
  lines: z.array(z.object({ chargeId: z.number().int(), amount: moneyInput })).min(1, 'Allocate the payment to at least one fee item'),
});

/** FR-601, FR-602, BR-17, D-06: record a payment visit as one receipt with one line per fee item. */
router.post(
  '/',
  requirePermission('payments.record'),
  handle(async (req) => {
    const body = parse(paymentBody, req.body);
    const user = currentUser(req);
    const prior = await prisma.receipt.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
    if (prior) return { id: prior.id, receiptNo: prior.receiptNo, repeated: true, warnings: [] };

    await assertRefCode(prisma, 'PAYMENT_METHOD', body.method, 'Payment method');
    const paymentDate = parseDate(body.paymentDate, 'Payment date');
    if (paymentDate > todayKampala()) throw badRequest('Payment date cannot be in the future');
    const pupil = await prisma.pupil.findUnique({ where: { id: body.pupilId } });
    if (!pupil) throw notFound('Pupil');
    const ids = body.lines.map((l) => l.chargeId);
    if (new Set(ids).size !== ids.length) throw badRequest('Each fee item can appear only once on a receipt');
    if (body.lines.some((l) => dec(l.amount).lte(0))) throw badRequest('Every amount must be more than zero');

    const warnings: string[] = [];
    if (body.reference) {
      const sameRef = await prisma.receipt.findFirst({ where: { reference: body.reference, method: body.method, reversedAt: null } });
      if (sameRef) warnings.push(`Reference ${body.reference} was already used on receipt ${sameRef.receiptNo}. Check this is not the same payment twice.`);
    }

    try {
      const receipt = await prisma.$transaction(async (tx) => {
        // Lock the pupil's charges so two cashiers cannot over-allocate at the same moment (WR-23).
        await tx.$queryRaw`SELECT "id" FROM "Charge" WHERE "id" IN (${Prisma.join(ids)}) FOR UPDATE`;
        const balances = await tx.chargeBalance.findMany({ where: { chargeId: { in: ids } } });
        const charges = await tx.charge.findMany({ where: { id: { in: ids } }, include: { feeItem: true } });
        let postClose = false;
        for (const line of body.lines) {
          const c = charges.find((x) => x.id === line.chargeId);
          const b = balances.find((x) => x.chargeId === line.chargeId);
          if (!c || !b || c.pupilId !== pupil.id) throw badRequest('A selected charge does not belong to this pupil');
          if (b.voided) throw badRequest(`${c.feeItem.name} (${c.chargeNo}) is void`);
          if (b.status === 'CARRIED_FORWARD') throw badRequest(`${c.feeItem.name} (${c.chargeNo}) was carried forward. Pay the Arrears B/F charge instead.`);
          if (dec(line.amount).gt(b.balance)) {
            // A-10: overpayment allowed with an explicit acknowledgement; it leaves a credit.
            if (!body.acknowledgeOverpayment) {
              throw new AppError(400, 'OVERPAYMENT', `The amount for ${c.feeItem.name} is more than its balance of ${money(b.balance)}. Confirm to record an overpayment as a credit.`);
            }
            warnings.push(`${c.feeItem.name} is overpaid and now shows a credit.`);
          }
          postClose = (await checkTermOpen(tx, user, c.termId)) || postClose;
        }
        const total = sum(body.lines.map((l) => l.amount));
        const created = await tx.receipt.create({
          data: {
            receiptNo: await nextReceiptNo(tx, receiptYear(paymentDate)),
            idempotencyKey: body.idempotencyKey,
            pupilId: pupil.id,
            paymentDate,
            method: body.method,
            reference: body.reference ?? null,
            notes: body.notes ?? null,
            total,
            receivedById: user.id,
            receivedByName: user.fullName,
            postClose,
            lines: { create: body.lines.map((l) => ({ chargeId: l.chargeId, amount: dec(l.amount) })) },
          },
          include: { lines: true },
        });
        await audit(tx, user, 'payment.record', 'Receipt', created.id, { after: created });
        return created;
      });
      return { id: receipt.id, receiptNo: receipt.receiptNo, repeated: false, warnings };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const again = await prisma.receipt.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
        if (again) return { id: again.id, receiptNo: again.receiptNo, repeated: true, warnings: [] };
      }
      throw err;
    }
  }),
);

/** WR-10: search payments by pupil, receipt, date range, year, term, method and officer. */
router.get(
  '/',
  requirePermission('payments.view'),
  handle(async (req, res) => {
    const q = req.query;
    const { skip, take, page, pageSize } = pagination(q);
    const search = typeof q.search === 'string' ? q.search.trim() : '';
    const where: Prisma.ReceiptWhereInput = {
      pupilId: q.pupilId ? Number(q.pupilId) : undefined,
      method: typeof q.method === 'string' && q.method ? q.method : undefined,
      receivedById: q.receivedById ? Number(q.receivedById) : undefined,
      paymentDate: {
        gte: typeof q.from === 'string' && q.from ? parseDate(q.from, 'From') : undefined,
        lte: typeof q.to === 'string' && q.to ? parseDate(q.to, 'To') : undefined,
      },
      reversedAt: q.reversed === 'true' ? { not: null } : q.reversed === 'false' ? null : undefined,
      lines: q.termId || q.academicYearId
        ? { some: { charge: { termId: q.termId ? Number(q.termId) : undefined, term: q.academicYearId ? { academicYearId: Number(q.academicYearId) } : undefined } } }
        : undefined,
      OR: search
        ? [
            { receiptNo: { contains: search, mode: 'insensitive' } },
            { reference: { contains: search, mode: 'insensitive' } },
            { pupil: { fullName: { contains: search, mode: 'insensitive' } } },
            { pupil: { pupilCode: { contains: search, mode: 'insensitive' } } },
          ]
        : undefined,
    };
    const csv = wantsCsv(q);
    const [items, total, totals] = await Promise.all([
      prisma.receipt.findMany({
        where,
        include: { pupil: true, reversal: true, lines: { include: { charge: { include: { feeItem: true, term: { include: { academicYear: true } } } } } } },
        orderBy: [{ paymentDate: 'desc' }, { id: 'desc' }],
        skip: csv ? undefined : skip,
        take: csv ? 20000 : take,
      }),
      prisma.receipt.count({ where }),
      prisma.receipt.aggregate({ where: { ...where, reversedAt: null }, _sum: { total: true } }),
    ]);
    const rows = items.map((r) => ({
      id: r.id,
      receiptNo: r.receiptNo,
      paymentDate: isoDate(r.paymentDate),
      pupilId: r.pupilId,
      pupilCode: r.pupil.pupilCode,
      pupilName: r.pupil.fullName,
      method: r.method,
      reference: r.reference,
      total: money(r.total),
      receivedByName: r.receivedByName,
      reversed: r.reversedAt !== null,
      reversalStatus: r.reversal?.status ?? null,
      postClose: r.postClose,
      items: r.lines.map((l) => `${l.charge.feeItem.name} (${l.charge.term.name} ${l.charge.term.academicYear.year})`).join('; '),
    }));
    if (csv) {
      sendCsv(res, 'payments.csv', ['Receipt No', 'Date', 'Pupil ID', 'Pupil', 'Fee items', 'Amount', 'Method', 'Reference', 'Received by', 'Reversed'],
        rows.map((r) => [r.receiptNo, displayDate(new Date(r.paymentDate!)), r.pupilCode, r.pupilName, r.items, r.total, r.method, r.reference, r.receivedByName, r.reversed ? 'Yes' : 'No']));
      return;
    }
    return { items: rows, total, page, pageSize, sumTotal: money(totals._sum.total) };
  }),
);

/** FR-1201 to FR-1205: everything the printed receipt needs, from the receipt number alone. */
router.get(
  '/receipts/:receiptNo',
  requirePermission('payments.view'),
  handle(async (req) => {
    const receipt = await prisma.receipt.findUnique({
      where: { receiptNo: req.params.receiptNo },
      include: {
        pupil: { include: { schoolClass: { include: { section: true } } } },
        reversal: true,
        lines: { include: { charge: { include: { feeItem: true, term: { include: { academicYear: true } }, schoolClass: true } } }, orderBy: { id: 'asc' } },
      },
    });
    if (!receipt) throw notFound('Receipt');
    const settings = await getSettings(prisma);
    const methods = await prisma.referenceValue.findMany({ where: { list: { code: 'PAYMENT_METHOD' } } });
    const balances = await prisma.chargeBalance.findMany({ where: { chargeId: { in: receipt.lines.map((l) => l.chargeId) } } });
    const pupilBalance = await prisma.chargeBalance.aggregate({ where: { pupilId: receipt.pupilId, voided: false }, _sum: { balance: true } });
    const terms = [...new Set(receipt.lines.map((l) => `${l.charge.term.name} ${l.charge.term.academicYear.year}`))];
    return {
      school: { name: settings.schoolName, address: settings.address, phone: settings.phone, email: settings.email, registrationNo: settings.registrationNo, footer: settings.receiptFooter },
      id: receipt.id,
      receiptNo: receipt.receiptNo,
      paymentDate: isoDate(receipt.paymentDate),
      pupil: {
        id: receipt.pupilId,
        pupilCode: receipt.pupil.pupilCode,
        fullName: receipt.pupil.fullName,
        className: receipt.pupil.schoolClass.name,
        sectionName: receipt.pupil.schoolClass.section.name,
        guardianName: receipt.pupil.guardianName,
      },
      termLabel: terms.join(', '),
      lines: receipt.lines.map((l) => ({
        chargeId: l.chargeId,
        chargeNo: l.charge.chargeNo,
        feeItemName: l.charge.feeItem.name,
        termLabel: `${l.charge.term.name} ${l.charge.term.academicYear.year}`,
        amount: money(l.amount),
        balanceAfter: money(balances.find((b) => b.chargeId === l.chargeId)?.balance),
      })),
      total: money(receipt.total),
      method: receipt.method,
      methodLabel: methods.find((m) => m.code === receipt.method)?.label ?? receipt.method,
      reference: receipt.reference,
      notes: receipt.notes,
      receivedByName: receipt.receivedByName,
      createdAt: receipt.createdAt,
      reversed: receipt.reversedAt !== null,
      reversal: receipt.reversal ? { status: receipt.reversal.status, reason: receipt.reversal.reason, requestedAt: receipt.reversal.requestedAt, decidedAt: receipt.reversal.decidedAt } : null,
      pupilOutstanding: money(pupilBalance._sum.balance),
    };
  }),
);

// ───────── Reversals (WR-09, D-05). Posted receipts are never edited or deleted. ─────────

router.post(
  '/:id/reversal',
  requirePermission('payments.reverse.request'),
  handle(async (req) => {
    const id = idParam(req);
    const body = parse(z.object({ reason: z.string().trim().min(5, 'Explain why the payment is being reversed').max(500) }), req.body);
    const user = currentUser(req);
    const receipt = await prisma.receipt.findUnique({ where: { id }, include: { reversal: true, lines: { include: { charge: true } } } });
    if (!receipt) throw notFound('Receipt');
    if (receipt.reversedAt) throw badRequest('This receipt is already reversed');
    if (receipt.reversal && receipt.reversal.status === 'PENDING') throw badRequest('A reversal is already waiting for approval');
    for (const l of receipt.lines) await checkTermOpen(prisma, user, l.charge.termId);
    const reversal = await prisma.$transaction(async (tx) => {
      // A rejected request can be raised again; replace it.
      if (receipt.reversal) await tx.paymentReversal.delete({ where: { id: receipt.reversal.id } });
      const created = await tx.paymentReversal.create({ data: { receiptId: id, reason: body.reason, requestedById: user.id } });
      await audit(tx, user, 'payment.reversal_request', 'Receipt', id, { reason: body.reason, before: receipt.reversal ?? undefined });
      return created;
    });
    return reversal;
  }),
);

router.post(
  '/reversals/:id/decide',
  requirePermission('payments.reverse.approve'),
  handle(async (req) => {
    const id = idParam(req);
    const body = parse(z.object({ approve: z.boolean(), note: z.string().trim().max(300).nullable().optional() }), req.body);
    const user = currentUser(req);
    const reversal = await prisma.paymentReversal.findUnique({ where: { id }, include: { receipt: { include: { lines: { include: { charge: true } } } } } });
    if (!reversal) throw notFound('Reversal');
    if (reversal.status !== 'PENDING') throw badRequest('This reversal has already been decided');
    assertDifferentApprover(reversal.requestedById, user.id);
    if (!body.approve && !body.note) throw badRequest('Give a reason for rejecting');
    for (const l of reversal.receipt.lines) await checkTermOpen(prisma, user, l.charge.termId);
    await prisma.$transaction(async (tx) => {
      const updated = await tx.paymentReversal.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: body.approve ? 'APPROVED' : 'REJECTED', decidedById: user.id, decidedAt: new Date(), decisionNote: body.note ?? null },
      });
      if (updated.count !== 1) throw badRequest('This reversal has already been decided');
      if (body.approve) await tx.receipt.update({ where: { id: reversal.receiptId }, data: { reversedAt: new Date() } });
      await audit(tx, user, body.approve ? 'payment.reversal_approve' : 'payment.reversal_reject', 'Receipt', reversal.receiptId, { reason: body.note ?? reversal.reason });
    });
    return { ok: true };
  }),
);

router.get(
  '/reversals',
  requirePermission('payments.view'),
  handle(async (req) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const items = await prisma.paymentReversal.findMany({ where: { status }, include: { receipt: { include: { pupil: true } } }, orderBy: { id: 'desc' }, take: 200 });
    const names = await userNames(items.flatMap((i) => [i.requestedById, i.decidedById ?? 0]));
    return items.map((r) => ({
      id: r.id, receiptId: r.receiptId, receiptNo: r.receipt.receiptNo, pupilName: r.receipt.pupil.fullName, total: money(r.receipt.total),
      reason: r.reason, status: r.status, requestedBy: names.get(r.requestedById), requestedById: r.requestedById, requestedAt: r.requestedAt,
      decidedBy: r.decidedById ? names.get(r.decidedById) : null, decidedAt: r.decidedAt, decisionNote: r.decisionNote,
      canDecide: hasPermission(req.user, 'payments.reverse.approve') && r.requestedById !== req.user?.id,
    }));
  }),
);
