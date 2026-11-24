import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { handle, idParam, pagination, parse } from '../lib/http';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { displayDate, isoDate, parseDate, todayKampala } from '../lib/dates';
import { nextExpenseNo } from '../lib/ids';
import { dec, money } from '../lib/money';
import { sendCsv, wantsCsv } from '../lib/csv';
import { currentUser, hasPermission, requirePermission } from '../auth/session';
import { assertDifferentApprover, assertWithinApprovalLimit, fundingBucket, overApprovalLimit } from '../finance/policies';
import { checkTermOpen } from '../finance/periods';
import { assertRefCode, otherText, termLabel, getSettings } from './setup';
import { moneyInput } from './fees';

export const router = Router();

const text = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable().optional();

const expenseBody = z.object({
  expenseDate: z.string(),
  termId: z.number().int(),
  category: z.string(),
  description: z.string().trim().min(3, 'Describe the expense').max(500),
  amount: moneyInput,
  supplier: text(200),
  method: z.string(),
  invoiceRef: text(100),
  fundingSource: z.string(),
  fundingSourceOther: text(200),
});

type ExpenseRow = Prisma.ExpenseGetPayload<{ include: { term: { include: { academicYear: true } }; payrollRun: true; contribution: true } }>;

/** Whether this user may decide an expense of a given amount: the approve permission, within the approval limit unless they hold approvals.overLimit. */
async function approverCheck(user: Parameters<typeof hasPermission>[0]) {
  if (!hasPermission(user, 'expenses.approve')) return () => false;
  if (hasPermission(user, 'approvals.overLimit')) return () => true;
  const { approvalLimit } = await getSettings(prisma);
  return (amount: Prisma.Decimal) => !overApprovalLimit(approvalLimit, amount);
}

function serialize(e: ExpenseRow, names: Map<number, string>, userId?: number, canApprove: (amount: Prisma.Decimal) => boolean = () => false) {
  return {
    id: e.id,
    expenseNo: e.expenseNo,
    expenseDate: isoDate(e.expenseDate),
    termId: e.termId,
    termLabel: termLabel(e.term),
    category: e.category,
    description: e.description,
    amount: money(e.amount),
    supplier: e.supplier,
    method: e.method,
    invoiceRef: e.invoiceRef,
    fundingSource: e.fundingSource,
    fundingSourceOther: e.fundingSourceOther,
    fundingBucket: fundingBucket(e.fundingSource),
    status: e.status,
    enteredById: e.enteredById,
    enteredBy: names.get(e.enteredById) ?? null,
    enteredAt: e.enteredAt,
    approvedByName: e.approvedByName,
    decidedAt: e.decidedAt,
    decisionNote: e.decisionNote,
    postClose: e.postClose,
    payrollRunId: e.payrollRun?.id ?? null,
    contributionId: e.contribution?.id ?? null,
    canDecide: canApprove(e.amount) && e.status === 'PENDING' && e.enteredById !== userId,
  };
}

async function names(ids: number[]) {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, fullName: true } });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

const include = { term: { include: { academicYear: true } }, payrollRun: true, contribution: true } as const;

router.get(
  '/',
  requirePermission('expenses.view'),
  handle(async (req, res) => {
    const q = req.query;
    const { skip, take, page, pageSize } = pagination(q);
    const s = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
    const where: Prisma.ExpenseWhereInput = {
      termId: q.termId ? Number(q.termId) : undefined,
      term: q.academicYearId ? { academicYearId: Number(q.academicYearId) } : undefined,
      category: s(q.category),
      fundingSource: s(q.fundingSource),
      status: s(q.status),
      expenseDate: { gte: s(q.from) ? parseDate(s(q.from)!, 'From') : undefined, lte: s(q.to) ? parseDate(s(q.to)!, 'To') : undefined },
      OR: s(q.search)
        ? [
            { description: { contains: s(q.search), mode: 'insensitive' } },
            { supplier: { contains: s(q.search), mode: 'insensitive' } },
            { invoiceRef: { contains: s(q.search), mode: 'insensitive' } },
            { expenseNo: { contains: s(q.search), mode: 'insensitive' } },
          ]
        : undefined,
    };
    const csv = wantsCsv(q);
    const [items, total, approvedSum] = await Promise.all([
      prisma.expense.findMany({ where, include, orderBy: [{ expenseDate: 'desc' }, { id: 'desc' }], skip: csv ? undefined : skip, take: csv ? 20000 : take }),
      prisma.expense.count({ where }),
      prisma.expense.aggregate({ where: { ...where, status: 'APPROVED' }, _sum: { amount: true } }),
    ]);
    const nameMap = await names(items.map((i) => i.enteredById));
    const user = req.user;
    const approver = await approverCheck(user);
    const rows = items.map((e) => serialize(e, nameMap, user?.id, approver));
    if (csv) {
      sendCsv(res, 'expenses.csv', ['Expense ID', 'Date', 'Term', 'Category', 'Description', 'Amount', 'Supplier', 'Method', 'Invoice', 'Funding source', 'Status', 'Approved by'],
        rows.map((r) => [r.expenseNo, displayDate(new Date(r.expenseDate!)), r.termLabel, r.category, r.description, r.amount, r.supplier, r.method, r.invoiceRef, r.fundingSourceOther ? `${r.fundingSource}: ${r.fundingSourceOther}` : r.fundingSource, r.status, r.approvedByName]));
      return;
    }
    return { items: rows, total, page, pageSize, approvedTotal: money(approvedSum._sum.amount) };
  }),
);

router.get(
  '/:id',
  requirePermission('expenses.view'),
  handle(async (req) => {
    const e = await prisma.expense.findUnique({ where: { id: idParam(req) }, include });
    if (!e) throw notFound('Expense');
    return serialize(e, await names([e.enteredById]), req.user?.id, await approverCheck(req.user));
  }),
);

async function validate(body: z.infer<typeof expenseBody>) {
  await assertRefCode(prisma, 'EXPENSE_CATEGORY', body.category, 'Category');
  await assertRefCode(prisma, 'PAYMENT_METHOD', body.method, 'Payment method');
  // CTL-07: a funding source is mandatory on every expense.
  await assertRefCode(prisma, 'FUNDING_SOURCE', body.fundingSource, 'Funding source');
  const date = parseDate(body.expenseDate, 'Expense date');
  if (date > todayKampala()) throw badRequest('Expense date cannot be in the future');
  if (dec(body.amount).lte(0)) throw badRequest('Amount must be more than zero');
  const warnings: string[] = [];
  return { date, warnings };
}

async function duplicateInvoiceWarning(supplier: string | null | undefined, invoiceRef: string | null | undefined, excludeId?: number) {
  if (!invoiceRef) return null;
  const dup = await prisma.expense.findFirst({
    where: { invoiceRef: { equals: invoiceRef, mode: 'insensitive' }, supplier: supplier ? { equals: supplier, mode: 'insensitive' } : undefined, status: { not: 'REJECTED' }, id: excludeId ? { not: excludeId } : undefined },
  });
  return dup ? `Invoice ${invoiceRef}${supplier ? ` from ${supplier}` : ''} is already recorded as ${dup.expenseNo}. Check it is not entered twice.` : null;
}

/** FR-701, FR-702: expenses are entered as pending and count once approved (D-05). */
router.post(
  '/',
  requirePermission('expenses.manage'),
  handle(async (req) => {
    const body = parse(expenseBody, req.body);
    const user = currentUser(req);
    const { date, warnings } = await validate(body);
    const postClose = await checkTermOpen(prisma, user, body.termId);
    const dup = await duplicateInvoiceWarning(body.supplier, body.invoiceRef);
    if (dup) warnings.push(dup);
    if (body.category === 'SALARIES') warnings.push('Salaries are normally posted from a payroll run. Make sure this is not also in payroll.');
    const expense = await prisma.$transaction(async (tx) => {
      const e = await tx.expense.create({
        data: {
          expenseNo: await nextExpenseNo(tx), expenseDate: date, termId: body.termId, category: body.category, description: body.description,
          amount: dec(body.amount), supplier: body.supplier ?? null, method: body.method, invoiceRef: body.invoiceRef ?? null,
          fundingSource: body.fundingSource, fundingSourceOther: otherText(body.fundingSource, body.fundingSourceOther, 'Funding source'), enteredById: user.id, postClose,
        },
        include,
      });
      await audit(tx, user, 'expense.create', 'Expense', e.id, { after: e });
      return e;
    });
    return { ...serialize(expense, new Map([[user.id, user.fullName]])), warnings };
  }),
);

router.patch(
  '/:id',
  requirePermission('expenses.manage'),
  handle(async (req) => {
    const id = idParam(req);
    const body = parse(expenseBody, req.body);
    const user = currentUser(req);
    const before = await prisma.expense.findUnique({ where: { id }, include });
    if (!before) throw notFound('Expense');
    if (before.status !== 'PENDING') throw badRequest('Only expenses waiting for approval can be edited');
    if (before.payrollRun) throw badRequest('This expense was posted from payroll and cannot be edited');
    if (before.contribution && body.fundingSource !== before.fundingSource) throw badRequest('This expense is linked to an owner contribution, so its funding source cannot change');
    const { date, warnings } = await validate(body);
    await checkTermOpen(prisma, user, body.termId);
    const dup = await duplicateInvoiceWarning(body.supplier, body.invoiceRef, id);
    if (dup) warnings.push(dup);
    const after = await prisma.expense.update({
      where: { id },
      data: {
        expenseDate: date, termId: body.termId, category: body.category, description: body.description, amount: dec(body.amount),
        supplier: body.supplier ?? null, method: body.method, invoiceRef: body.invoiceRef ?? null, fundingSource: body.fundingSource,
        fundingSourceOther: otherText(body.fundingSource, body.fundingSourceOther, 'Funding source'),
      },
      include,
    });
    await audit(prisma, user, 'expense.update', 'Expense', id, { before, after });
    return { ...serialize(after, await names([after.enteredById])), warnings };
  }),
);

/** FR-706, CTL-08, D-05: approval by a different person; the approver's name is recorded. */
router.post(
  '/:id/decide',
  requirePermission('expenses.approve'),
  handle(async (req) => {
    const id = idParam(req);
    const body = parse(z.object({ approve: z.boolean(), note: z.string().trim().max(300).nullable().optional() }), req.body);
    const user = currentUser(req);
    const e = await prisma.expense.findUnique({ where: { id }, include });
    if (!e) throw notFound('Expense');
    if (e.status !== 'PENDING') throw badRequest('This expense has already been decided');
    if (e.payrollRun) throw forbidden('Payroll expenses are approved with their payroll run');
    assertDifferentApprover(e.enteredById, user.id);
    assertWithinApprovalLimit(user, (await getSettings(prisma)).approvalLimit, e.amount);
    if (!body.approve && !body.note) throw badRequest('Give a reason for rejecting');
    await checkTermOpen(prisma, user, e.termId);
    await prisma.$transaction(async (tx) => {
      const updated = await tx.expense.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: body.approve ? 'APPROVED' : 'REJECTED', approvedById: user.id, approvedByName: user.fullName, decidedAt: new Date(), decisionNote: body.note ?? null },
      });
      if (updated.count !== 1) throw badRequest('This expense has already been decided');
      await audit(tx, user, body.approve ? 'expense.approve' : 'expense.reject', 'Expense', id, { reason: body.note });
    });
    return { ok: true };
  }),
);
