import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma, type Db } from '../db';
import { handle, idParam, pagination, parse } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { isoDate, parseDate } from '../lib/dates';
import { nextChargeNo } from '../lib/ids';
import { dec, money } from '../lib/money';
import { currentUser, requirePermission } from '../auth/session';
import { assertDifferentApprover, assertDiscountWithinCharge } from '../finance/policies';
import { checkTermOpen } from '../finance/periods';
import { moneyInput } from './fees';

export const router = Router();

type ChargeWithRefs = Prisma.ChargeGetPayload<{
  include: { pupil: true; feeItem: true; schoolClass: true; term: { include: { academicYear: true } }; sourceCharge: { include: { term: { include: { academicYear: true } }; feeItem: true } } };
}>;

const chargeInclude = {
  pupil: true,
  feeItem: true,
  schoolClass: true,
  term: { include: { academicYear: true } },
  sourceCharge: { include: { term: { include: { academicYear: true } }, feeItem: true } },
} as const;

export function serializeCharge(c: ChargeWithRefs, b: { discount: unknown; pendingDiscount: unknown; netDue: unknown; totalPaid: unknown; carriedForward: unknown; balance: unknown; status: string } | undefined) {
  return {
    id: c.id,
    chargeNo: c.chargeNo,
    pupilId: c.pupilId,
    pupilCode: c.pupil.pupilCode,
    pupilName: c.pupil.fullName,
    termId: c.termId,
    termLabel: `${c.term.name} ${c.term.academicYear.year}`,
    year: c.term.academicYear.year,
    classId: c.classId,
    className: c.schoolClass.name,
    feeItemId: c.feeItemId,
    feeItemName: c.feeItem.name,
    isArrears: c.sourceChargeId !== null,
    // FR-1103: arrears show where the debt came from so its age stays visible.
    arrearsFrom: c.sourceCharge ? `${c.sourceCharge.feeItem.name}, ${c.sourceCharge.term.name} ${c.sourceCharge.term.academicYear.year}` : null,
    sourceChargeId: c.sourceChargeId,
    amountCharged: money(c.amountCharged),
    discount: money(b?.discount as never),
    pendingDiscount: money(b?.pendingDiscount as never),
    netDue: money(b?.netDue as never),
    totalPaid: money(b?.totalPaid as never),
    carriedForward: money(b?.carriedForward as never),
    balance: money(b?.balance as never),
    status: b?.status ?? 'UNPAID',
    dueDate: isoDate(c.dueDate),
    notes: c.notes,
    postClose: c.postClose,
    voided: c.voidedAt !== null,
    voidReason: c.voidReason,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export async function loadCharges(db: Db, ids: number[]) {
  const [charges, balances] = await Promise.all([
    db.charge.findMany({ where: { id: { in: ids } }, include: chargeInclude }),
    db.chargeBalance.findMany({ where: { chargeId: { in: ids } } }),
  ]);
  const bMap = new Map(balances.map((b) => [b.chargeId, b]));
  const cMap = new Map(charges.map((c) => [c.id, c]));
  return ids.filter((id) => cMap.has(id)).map((id) => serializeCharge(cMap.get(id)!, bMap.get(id)));
}

router.get(
  '/',
  requirePermission('charges.view'),
  handle(async (req) => {
    const { skip, take, page, pageSize } = pagination(req.query);
    const q = req.query;
    const num = (v: unknown) => (v ? Number(v) : undefined);
    const search = typeof q.search === 'string' ? q.search.trim() : '';
    let pupilIds: number[] | undefined;
    if (search) {
      const pupils = await prisma.pupil.findMany({
        where: { OR: [{ fullName: { contains: search, mode: 'insensitive' } }, { pupilCode: { contains: search, mode: 'insensitive' } }] },
        select: { id: true },
        take: 500,
      });
      pupilIds = pupils.map((p) => p.id);
    }
    const where: Prisma.ChargeBalanceWhereInput = {
      pupilId: num(q.pupilId) ?? (pupilIds ? { in: pupilIds } : undefined),
      termId: num(q.termId),
      academicYearId: num(q.academicYearId),
      classId: num(q.classId),
      feeItemId: num(q.feeItemId),
      status: typeof q.status === 'string' && q.status ? q.status : undefined,
      voided: q.includeVoid === 'true' ? undefined : false,
    };
    const [rows, total] = await Promise.all([
      prisma.chargeBalance.findMany({ where, orderBy: { chargeId: 'desc' }, skip, take, select: { chargeId: true } }),
      prisma.chargeBalance.count({ where }),
    ]);
    return { items: await loadCharges(prisma, rows.map((r) => r.chargeId)), total, page, pageSize };
  }),
);

router.get(
  '/:id',
  requirePermission('charges.view'),
  handle(async (req) => {
    const id = idParam(req);
    const [charge] = await loadCharges(prisma, [id]);
    if (!charge) throw notFound('Charge');
    const [discounts, lines, carriedTo] = await Promise.all([
      prisma.chargeDiscount.findMany({ where: { chargeId: id }, orderBy: { id: 'asc' } }),
      prisma.paymentLine.findMany({ where: { chargeId: id }, include: { receipt: true }, orderBy: { id: 'asc' } }),
      prisma.charge.findUnique({ where: { sourceChargeId: id }, include: { term: { include: { academicYear: true } } } }),
    ]);
    const users = await userNames([...discounts.map((d) => d.requestedById), ...discounts.map((d) => d.decidedById ?? 0)]);
    return {
      ...charge,
      carriedTo: carriedTo ? { id: carriedTo.id, chargeNo: carriedTo.chargeNo, termLabel: `${carriedTo.term.name} ${carriedTo.term.academicYear.year}` } : null,
      discounts: discounts.map((d) => ({
        id: d.id, amount: money(d.amount), reason: d.reason, status: d.status,
        requestedBy: users.get(d.requestedById) ?? null, requestedAt: d.requestedAt,
        decidedBy: d.decidedById ? users.get(d.decidedById) ?? null : null, decidedAt: d.decidedAt, decisionNote: d.decisionNote,
      })),
      payments: lines.map((l) => ({
        receiptId: l.receiptId, receiptNo: l.receipt.receiptNo, paymentDate: isoDate(l.receipt.paymentDate),
        amount: money(l.amount), method: l.receipt.method, reversed: l.receipt.reversedAt !== null,
      })),
    };
  }),
);

export async function userNames(ids: number[]) {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(ids)].filter(Boolean) } }, select: { id: true, fullName: true } });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

/** Raise one charge by hand, e.g. a uniform bought mid-term. Bulk billing is in /billing. */
router.post(
  '/',
  requirePermission('charges.manage'),
  handle(async (req) => {
    const body = parse(
      z.object({
        pupilId: z.number().int(),
        termId: z.number().int(),
        feeItemId: z.number().int(),
        amount: moneyInput,
        dueDate: z.string().nullable().optional(),
        notes: z.string().trim().max(500).nullable().optional(),
      }),
      req.body,
    );
    const user = currentUser(req);
    const [pupil, item] = await Promise.all([
      prisma.pupil.findUnique({ where: { id: body.pupilId } }),
      prisma.feeItem.findUnique({ where: { id: body.feeItemId } }),
    ]);
    if (!pupil) throw notFound('Pupil');
    if (!item || !item.active) throw badRequest('Choose an active fee item');
    if (item.isSystem) throw badRequest('Arrears B/F charges are raised by carry-forward');
    if (dec(body.amount).lte(0)) throw badRequest('Amount must be more than zero');
    const postClose = await checkTermOpen(prisma, user, body.termId);
    const existing = await prisma.charge.findFirst({ where: { pupilId: pupil.id, termId: body.termId, feeItemId: item.id, sourceChargeId: null, voidedAt: null } });
    if (existing) throw badRequest(`${pupil.fullName} already has a ${item.name} charge for this term (${existing.chargeNo})`);
    const charge = await prisma.$transaction(async (tx) => {
      const created = await tx.charge.create({
        data: {
          chargeNo: await nextChargeNo(tx), pupilId: pupil.id, termId: body.termId, classId: pupil.classId, feeItemId: item.id,
          amountCharged: dec(body.amount), dueDate: body.dueDate ? parseDate(body.dueDate, 'Due date') : null,
          notes: body.notes ?? null, postClose, createdById: user.id, updatedById: user.id,
        },
      });
      await audit(tx, user, 'charge.create', 'Charge', created.id, { after: created });
      return created;
    });
    return (await loadCharges(prisma, [charge.id]))[0];
  }),
);

/** A charge raised in error can be voided while nothing has been paid or carried against it. */
router.post(
  '/:id/void',
  requirePermission('charges.manage'),
  handle(async (req) => {
    const id = idParam(req);
    const body = parse(z.object({ reason: z.string().trim().min(5, 'Explain why the charge is being voided') }), req.body);
    const user = currentUser(req);
    const charge = await prisma.charge.findUnique({ where: { id } });
    if (!charge) throw notFound('Charge');
    if (charge.voidedAt) throw badRequest('This charge is already void');
    const bal = await prisma.chargeBalance.findUniqueOrThrow({ where: { chargeId: id } });
    const anyPayment = await prisma.paymentLine.count({ where: { chargeId: id, receipt: { reversedAt: null } } });
    if (anyPayment > 0) throw badRequest('This charge has payments. Reverse the payments first.');
    if (dec(bal.carriedForward).gt(0)) throw badRequest('This charge has been carried forward and cannot be voided');
    const postClose = await checkTermOpen(prisma, user, charge.termId);
    await prisma.$transaction(async (tx) => {
      await tx.charge.update({ where: { id }, data: { voidedAt: new Date(), voidedById: user.id, voidReason: body.reason, updatedById: user.id, postClose: charge.postClose || postClose } });
      await tx.chargeDiscount.updateMany({ where: { chargeId: id, status: 'PENDING' }, data: { status: 'REJECTED', decidedById: user.id, decidedAt: new Date(), decisionNote: 'Charge voided' } });
      await audit(tx, user, 'charge.void', 'Charge', id, { before: charge, reason: body.reason });
    });
    return { ok: true };
  }),
);

// ───────── Discounts and waivers (FR-502, WR-05, WR-06, D-05) ─────────

export async function requestDiscount(tx: Db, userId: number, chargeId: number, amount: string, reason: string) {
  const charge = await tx.charge.findUnique({ where: { id: chargeId }, include: { discounts: true } });
  if (!charge) throw notFound('Charge');
  if (charge.voidedAt) throw badRequest('This charge is void');
  if (charge.sourceChargeId) throw badRequest('Discounts belong on the original charge, not on Arrears B/F');
  if (dec(charge.carriedForwardAmount).gt(0)) throw badRequest('This charge has been carried forward; apply any discount to the Arrears B/F charge’s source before carrying');
  const counted = charge.discounts.filter((d) => d.status !== 'REJECTED').reduce((acc, d) => acc.plus(d.amount), dec(0));
  assertDiscountWithinCharge(dec(charge.amountCharged), counted, dec(amount));
  return tx.chargeDiscount.create({ data: { chargeId, amount: dec(amount), reason, requestedById: userId } });
}

router.post(
  '/:id/discounts',
  requirePermission('discounts.request'),
  handle(async (req) => {
    const id = idParam(req);
    const body = parse(z.object({ amount: moneyInput, reason: z.string().trim().min(3, 'Give a reason for the discount').max(300) }), req.body);
    const user = currentUser(req);
    if (dec(body.amount).lte(0)) throw badRequest('Discount must be more than zero');
    const charge = await prisma.charge.findUnique({ where: { id } });
    if (!charge) throw notFound('Charge');
    await checkTermOpen(prisma, user, charge.termId);
    const d = await prisma.$transaction(async (tx) => {
      const created = await requestDiscount(tx, user.id, id, body.amount, body.reason);
      await audit(tx, user, 'discount.request', 'ChargeDiscount', created.id, { after: created, reason: body.reason });
      return created;
    });
    return { id: d.id, status: d.status };
  }),
);

router.post(
  '/discounts/:id/decide',
  requirePermission('discounts.approve'),
  handle(async (req) => {
    const id = idParam(req);
    const body = parse(z.object({ approve: z.boolean(), note: z.string().trim().max(300).nullable().optional() }), req.body);
    const user = currentUser(req);
    const discount = await prisma.chargeDiscount.findUnique({ where: { id }, include: { charge: true } });
    if (!discount) throw notFound('Discount');
    if (discount.status !== 'PENDING') throw badRequest('This discount has already been decided');
    assertDifferentApprover(discount.requestedById, user.id);
    if (!body.approve && !body.note) throw badRequest('Give a reason for rejecting');
    await checkTermOpen(prisma, user, discount.charge.termId);
    if (body.approve && dec(discount.charge.carriedForwardAmount).gt(0)) {
      throw badRequest('The charge has since been carried forward, so this discount can no longer be applied to it');
    }
    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.chargeDiscount.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: body.approve ? 'APPROVED' : 'REJECTED', decidedById: user.id, decidedAt: new Date(), decisionNote: body.note ?? null },
      });
      if (updated.count !== 1) throw badRequest('This discount has already been decided');
      await audit(tx, user, body.approve ? 'discount.approve' : 'discount.reject', 'ChargeDiscount', id, { before: discount, reason: body.note });
      return tx.chargeDiscount.findUniqueOrThrow({ where: { id } });
    });
    return after;
  }),
);
