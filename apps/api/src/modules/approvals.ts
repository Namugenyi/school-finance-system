import { Router } from 'express';
import { prisma } from '../db';
import { handle } from '../lib/http';
import { displayDate } from '../lib/dates';
import { money } from '../lib/money';
import { currentUser, requirePermission } from '../auth/session';
import { termLabel } from './setup';
import { monthLabel } from './payroll';
import { payrollExpenseAmount } from '../finance/policies';

export const router = Router();

/** One inbox for everything waiting on a second person (D-05). Items you entered yourself are marked. */
router.get(
  '/',
  requirePermission('approvals.view'),
  handle(async (req) => {
    const user = currentUser(req);
    const can = (p: string) => user.permissions.has(p);
    const [discounts, expenses, reversals, runs, snapshots, users] = await Promise.all([
      prisma.chargeDiscount.findMany({ where: { status: 'PENDING' }, include: { charge: { include: { pupil: true, feeItem: true, term: { include: { academicYear: true } } } } }, orderBy: { id: 'asc' } }),
      prisma.expense.findMany({ where: { status: 'PENDING' }, include: { term: { include: { academicYear: true } } }, orderBy: { id: 'asc' } }),
      prisma.paymentReversal.findMany({ where: { status: 'PENDING' }, include: { receipt: { include: { pupil: true } } }, orderBy: { id: 'asc' } }),
      prisma.payrollRun.findMany({ where: { status: 'SUBMITTED' }, orderBy: { id: 'asc' } }),
      prisma.termSnapshot.findMany({ where: { status: 'PENDING' }, include: { term: { include: { academicYear: true } } }, orderBy: { id: 'asc' } }),
      prisma.user.findMany({ select: { id: true, fullName: true } }),
    ]);
    const name = (id: number) => users.find((u) => u.id === id)?.fullName ?? 'Unknown';
    const item = (type: string, id: number, title: string, detail: string, amount: string | null, requestedById: number, requestedAt: Date, permission: string, link: string) => ({
      type, id, title, detail, amount, requestedBy: name(requestedById), requestedAt, link,
      ownEntry: requestedById === user.id,
      canDecide: can(permission) && requestedById !== user.id,
    });
    return [
      ...discounts.map((d) => item('DISCOUNT', d.id, `Discount for ${d.charge.pupil.fullName}`, `${d.charge.feeItem.name}, ${termLabel(d.charge.term)}: ${d.reason}`, money(d.amount), d.requestedById, d.requestedAt, 'discounts.approve', `/charges/${d.chargeId}`)),
      ...expenses.map((e) => item('EXPENSE', e.id, `Expense ${e.expenseNo}`, `${e.description} (${termLabel(e.term)}, ${displayDate(e.expenseDate)})`, money(e.amount), e.enteredById, e.enteredAt, 'expenses.approve', `/expenses/${e.id}`)),
      ...reversals.map((r) => item('REVERSAL', r.id, `Reverse receipt ${r.receipt.receiptNo}`, `${r.receipt.pupil.fullName}: ${r.reason}`, money(r.receipt.total), r.requestedById, r.requestedAt, 'payments.reverse.approve', `/receipts/${r.receipt.receiptNo}`)),
      ...runs.map((r) => item('PAYROLL', r.id, `Payroll ${monthLabel(r.year, r.month)}`, 'Post salaries (basic pay plus employer NSSF) to expenses', money(payrollExpenseAmount(r)), r.preparedById, r.submittedAt ?? r.preparedAt, 'payroll.approve', `/payroll/runs/${r.id}`)),
      ...snapshots.map((s) => item('TERM_CLOSE', s.id, `Close ${termLabel(s.term)}`, `Snapshot version ${s.version}`, null, s.recordedById, s.recordedAt, 'termclose.approve', `/term-close?termId=${s.termId}`)),
    ];
  }),
);
