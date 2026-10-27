import { Router } from 'express';
import { prisma, type Db } from '../db';
import { handle } from '../lib/http';
import { badRequest } from '../lib/errors';
import { isoDate, parseDate } from '../lib/dates';
import { dec, money, ZERO } from '../lib/money';
import { sendCsv, wantsCsv } from '../lib/csv';
import { requirePermission } from '../auth/session';
import { balanceWhere, collectionRate, computeFigures, serializeFigures, type Scope } from '../finance/figures';
import { fundingBucket, payrollExpenseAmount } from '../finance/policies';
import { termLabel } from './setup';
import { monthLabel } from './payroll';

export const router = Router();
export const dashboardRouter = Router();

export function scopeFromQuery(q: Record<string, unknown>): Scope {
  return { termId: q.termId ? Number(q.termId) : undefined, academicYearId: q.academicYearId ? Number(q.academicYearId) : undefined };
}

const rate = (r: ReturnType<typeof collectionRate>) => (r === null ? null : r.toFixed(4));

/** v14 dashboard status word per class: No Data, All Paid, Partial or None Paid. */
export function classStatus(billed: ReturnType<typeof dec>, outstanding: ReturnType<typeof dec>, collected: ReturnType<typeof dec>) {
  if (billed.lte(0)) return 'NO_DATA';
  if (outstanding.lte(0)) return 'ALL_PAID';
  return collected.gt(0) ? 'PARTIAL' : 'NONE_PAID';
}

/** FR-1602: outstanding by class, using the class on the charge (A-18). */
export async function outstandingByClass(db: Db, scope: Scope) {
  const [groups, positive, classes] = await Promise.all([
    db.chargeBalance.groupBy({ by: ['classId', 'isArrears'], where: balanceWhere(scope), _sum: { netDue: true, totalPaid: true } }),
    db.chargeBalance.groupBy({ by: ['classId'], where: { ...balanceWhere(scope), balance: { gt: 0 } }, _sum: { balance: true }, _count: { pupilId: true } }),
    db.schoolClass.findMany({ include: { section: true }, orderBy: [{ section: { sortOrder: 'asc' } }, { sortOrder: 'asc' }] }),
  ]);
  return classes
    .map((c) => {
      const billed = dec(groups.find((g) => g.classId === c.id && !g.isArrears)?._sum.netDue);
      const arrearsBf = dec(groups.find((g) => g.classId === c.id && g.isArrears)?._sum.netDue);
      const collected = groups.filter((g) => g.classId === c.id).reduce((s, g) => s.plus(dec(g._sum.totalPaid)), ZERO);
      const collectedCurrent = dec(groups.find((g) => g.classId === c.id && !g.isArrears)?._sum.totalPaid);
      const out = positive.find((p) => p.classId === c.id);
      return {
        classId: c.id, className: c.name, sectionName: c.section.name, totalBilled: money(billed), arrearsBroughtForward: money(arrearsBf),
        totalCollected: money(collected), outstanding: money(out?._sum.balance), chargesWithBalance: out?._count.pupilId ?? 0,
        collectionRate: rate(collectionRate(collectedCurrent, billed)),
        status: classStatus(billed.plus(arrearsBf), dec(out?._sum.balance), collected),
      };
    })
    .filter((r) => dec(r.totalBilled).gt(0) || dec(r.outstanding).gt(0) || dec(r.arrearsBroughtForward).gt(0));
}

/** FR-1603: every item in the fee vocabulary, including those with nothing billed. */
export async function revenueByItem(db: Db, scope: Scope) {
  const [groups, positive, items] = await Promise.all([
    db.chargeBalance.groupBy({ by: ['feeItemId'], where: balanceWhere(scope), _sum: { amountCharged: true, discount: true, netDue: true, totalPaid: true } }),
    db.chargeBalance.groupBy({ by: ['feeItemId'], where: { ...balanceWhere(scope), balance: { gt: 0 } }, _sum: { balance: true } }),
    db.feeItem.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);
  return items.map((i) => {
    const g = groups.find((x) => x.feeItemId === i.id);
    return {
      feeItemId: i.id, feeItemName: i.name, isArrears: i.isSystem, grossBilled: money(g?._sum.amountCharged), discounts: money(g?._sum.discount),
      netBilled: money(g?._sum.netDue), collected: money(g?._sum.totalPaid), outstanding: money(positive.find((p) => p.feeItemId === i.id)?._sum.balance),
    };
  });
}

/** FR-1604, D-03: expenditure by category, split school / owner / other funded. */
export async function expensesByCategory(db: Db, scope: Scope) {
  const [groups, categories] = await Promise.all([
    db.expense.groupBy({
      by: ['category', 'fundingSource'],
      where: { status: 'APPROVED', termId: scope.termId, term: scope.academicYearId ? { academicYearId: scope.academicYearId } : undefined },
      _sum: { amount: true },
    }),
    db.referenceValue.findMany({ where: { list: { code: 'EXPENSE_CATEGORY' } }, orderBy: { sortOrder: 'asc' } }),
  ]);
  const grand = groups.reduce((sum, g) => sum.plus(dec(g._sum.amount)), ZERO);
  return categories
    .map((c) => {
      const t = { SCHOOL: ZERO, OWNER: ZERO, OTHER: ZERO };
      for (const g of groups.filter((x) => x.category === c.code)) {
        const b = fundingBucket(g.fundingSource);
        t[b] = t[b].plus(dec(g._sum.amount));
      }
      const total = t.SCHOOL.plus(t.OWNER).plus(t.OTHER);
      // v14: each category's share of all expenses in the period.
      const share = grand.gt(0) ? total.div(grand).toFixed(4) : null;
      return { category: c.code, categoryLabel: c.label, schoolFunded: money(t.SCHOOL), ownerFunded: money(t.OWNER), otherFunded: money(t.OTHER), total: money(total), share };
    })
    .filter((r) => c_active(r));
}
const c_active = (r: { total: string }) => dec(r.total).gt(0);

/** WR-15: owner contributions, loans received and owner-funded expenditure. */
export async function ownerFunds(db: Db, scope: Scope) {
  const termFilter = { termId: scope.termId, term: scope.academicYearId ? { academicYearId: scope.academicYearId } : undefined };
  const [byType, ownerExp, loansAll] = await Promise.all([
    db.ownerContribution.groupBy({ by: ['type'], where: termFilter, _sum: { amount: true }, _count: { _all: true } }),
    db.expense.groupBy({ by: ['fundingSource'], where: { ...termFilter, status: 'APPROVED', fundingSource: { in: ['OWNER_CONTRIBUTION', 'OWNER_LOAN'] } }, _sum: { amount: true } }),
    db.ownerContribution.aggregate({ where: { type: 'LOAN' }, _sum: { amount: true } }),
  ]);
  const t = (type: string) => money(byType.find((b) => b.type === type)?._sum.amount);
  return {
    cashContributions: t('CASH'),
    expensesPaidDirectly: t('EXPENSE_PAID_DIRECTLY'),
    loansReceived: t('LOAN'),
    ownerFundedExpenses: money(ownerExp.reduce((s, e) => s.plus(dec(e._sum.amount)), ZERO)),
    ownerFundedByContribution: money(ownerExp.find((e) => e.fundingSource === 'OWNER_CONTRIBUTION')?._sum.amount),
    ownerFundedByLoan: money(ownerExp.find((e) => e.fundingSource === 'OWNER_LOAN')?._sum.amount),
    // A-15: repayments are not tracked yet, so this is loans received to date.
    loansOutstandingAllTime: money(loansAll._sum.amount),
  };
}

/** FR-1605: cash-basis income and expenses statement. Owner money is shown below the line, not as income. */
export async function incomeStatement(db: Db, scope: Scope) {
  const figures = await computeFigures(db, scope);
  const [items, expenses, owner] = await Promise.all([revenueByItem(db, scope), expensesByCategory(db, scope), ownerFunds(db, scope)]);
  return {
    basis: 'Cash basis (BR-23). Fee income is counted in the term of the charge it pays (A-20). This is not a general ledger.',
    income: items.filter((i) => dec(i.collected).gt(0)).map((i) => ({ label: i.feeItemName, amount: i.collected })),
    totalIncome: money(figures.totalCollected),
    expenses: expenses.map((e) => ({ label: e.categoryLabel, amount: e.total, schoolFunded: e.schoolFunded, ownerFunded: e.ownerFunded, otherFunded: e.otherFunded })),
    totalExpenses: money(figures.totalExpenses),
    schoolFundedExpenses: money(figures.schoolFundedExpenses),
    ownerFundedExpenses: money(figures.ownerFundedExpenses),
    otherFundedExpenses: money(figures.otherFundedExpenses),
    netResult: money(figures.netResult),
    belowTheLine: owner,
  };
}

router.get('/summary', requirePermission('reports.view'), handle(async (req) => serializeFigures(await computeFigures(prisma, scopeFromQuery(req.query)))));

/** FR-1601: billed, collected, outstanding and collection rate per term. */
router.get(
  '/collection-by-term',
  requirePermission('reports.view'),
  handle(async (req) => {
    const terms = await prisma.academicTerm.findMany({
      where: { academicYearId: req.query.academicYearId ? Number(req.query.academicYearId) : undefined },
      include: { academicYear: true },
      orderBy: [{ academicYear: { year: 'asc' } }, { number: 'asc' }],
    });
    const rows = [];
    for (const t of terms) {
      const f = await computeFigures(prisma, { termId: t.id });
      rows.push({ termId: t.id, termLabel: termLabel(t), status: t.status, ...serializeFigures(f) });
    }
    return rows;
  }),
);

const reportRoute = (path: string, fn: (db: Db, scope: Scope) => Promise<unknown>) =>
  router.get(path, requirePermission('reports.view'), handle(async (req, res) => {
    const data = await fn(prisma, scopeFromQuery(req.query));
    if (wantsCsv(req.query) && Array.isArray(data) && data.length) {
      const headers = Object.keys(data[0] as object);
      sendCsv(res, `${path.slice(1)}.csv`, headers, data.map((r) => headers.map((h) => (r as Record<string, unknown>)[h])));
      return;
    }
    return data;
  }));

reportRoute('/outstanding-by-class', outstandingByClass);
reportRoute('/revenue-by-item', revenueByItem);
reportRoute('/expenses-by-category', expensesByCategory);
reportRoute('/income-statement', incomeStatement);
reportRoute('/owner-funds', ownerFunds);

/** WR-32: payroll totals per month. Salary detail stays behind payroll.view. */
router.get(
  '/payroll-summary',
  requirePermission('payroll.view'),
  handle(async (req) => {
    const runs = await prisma.payrollRun.findMany({
      where: { year: req.query.year ? Number(req.query.year) : undefined },
      include: { _count: { select: { entries: true } } },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });
    return runs.map((r) => ({
      runId: r.id, period: monthLabel(r.year, r.month), status: r.status, staff: r._count.entries, basic: money(r.totalBasic),
      nssfEmployee: money(r.totalNssfEmployee), nssfEmployer: money(r.totalNssfEmployer), paye: money(r.totalPaye),
      other: money(r.totalOther), net: money(r.totalNet), schoolCost: money(payrollExpenseAmount(r)),
    }));
  }),
);

/** A-20: cash actually received between two dates, by method and by day. */
router.get(
  '/cash-received',
  requirePermission('reports.view'),
  handle(async (req) => {
    if (typeof req.query.from !== 'string' || typeof req.query.to !== 'string') throw badRequest('Choose a date range');
    const from = parseDate(req.query.from, 'From');
    const to = parseDate(req.query.to, 'To');
    if (to < from) throw badRequest('The end date is before the start date');
    const where = { paymentDate: { gte: from, lte: to }, reversedAt: null };
    const [byMethod, byDay, total] = await Promise.all([
      prisma.receipt.groupBy({ by: ['method'], where, _sum: { total: true }, _count: { _all: true } }),
      prisma.receipt.groupBy({ by: ['paymentDate'], where, _sum: { total: true }, _count: { _all: true }, orderBy: { paymentDate: 'asc' } }),
      prisma.receipt.aggregate({ where, _sum: { total: true }, _count: { _all: true } }),
    ]);
    return {
      total: money(total._sum.total),
      receipts: total._count._all,
      byMethod: byMethod.map((m) => ({ method: m.method, amount: money(m._sum.total), receipts: m._count._all })),
      byDay: byDay.map((d) => ({ date: isoDate(d.paymentDate), amount: money(d._sum.total), receipts: d._count._all })),
    };
  }),
);

// ───────── Dashboard (FR-1606 to FR-1608, WR-22) ─────────

dashboardRouter.get(
  '/',
  requirePermission('dashboard.view'),
  handle(async (req) => {
    // One term, or the whole year (v14 "All Terms").
    const termId = Number(req.query.termId) || undefined;
    const yearId = Number(req.query.academicYearId) || undefined;
    if (!termId && !yearId) throw badRequest('Choose an academic year and term');
    const term = termId ? await prisma.academicTerm.findUnique({ where: { id: termId }, include: { academicYear: true } }) : null;
    if (termId && !term) throw badRequest('Unknown term');
    const year = await prisma.academicYear.findUnique({ where: { id: term?.academicYearId ?? yearId } });
    if (!year) throw badRequest('Unknown academic year');
    const scope = termId ? { termId } : { academicYearId: year.id };
    const inScope = (c: { termId: number }, yearTermIds: number[]) => (termId ? c.termId === termId : yearTermIds.includes(c.termId));
    const yearTerms = await prisma.academicTerm.findMany({ where: { academicYearId: year.id }, include: { academicYear: true }, orderBy: { number: 'asc' } });
    const yearTermIds = yearTerms.map((t) => t.id);
    const [figures, byClass, expenses, receipts, pending] = await Promise.all([
      computeFigures(prisma, scope),
      outstandingByClass(prisma, scope),
      expensesByCategory(prisma, scope),
      prisma.receipt.findMany({ where: { reversedAt: null, lines: { some: { charge: { termId: termId ?? { in: yearTermIds } } } } }, include: { lines: { include: { charge: true } } } }),
      Promise.all([
        prisma.chargeDiscount.count({ where: { status: 'PENDING' } }),
        prisma.expense.count({ where: { status: 'PENDING' } }),
        prisma.paymentReversal.count({ where: { status: 'PENDING' } }),
        prisma.payrollRun.count({ where: { status: 'SUBMITTED' } }),
        prisma.termSnapshot.count({ where: { status: 'PENDING' } }),
      ]),
    ]);
    // Weekly cash collected against this term's charges, for the trend chart.
    const weekly = new Map<string, ReturnType<typeof dec>>();
    for (const r of receipts) {
      const d = new Date(r.paymentDate);
      const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
      const key = isoDate(monday)!;
      const amount = r.lines.filter((l) => inScope(l.charge, yearTermIds)).reduce((s, l) => s.plus(l.amount), ZERO);
      weekly.set(key, (weekly.get(key) ?? ZERO).plus(amount));
    }
    const termsTrend = [];
    for (const t of yearTerms) {
      const f = await computeFigures(prisma, { termId: t.id });
      termsTrend.push({ termLabel: termLabel(t), totalBilled: money(f.totalBilled), totalCollected: money(f.totalCollected), outstanding: money(f.outstanding) });
    }
    return {
      term: term ? { id: term.id, label: termLabel(term), status: term.status } : { id: null, label: `All terms ${year.year}`, status: null },
      year: { id: year.id, year: year.year },
      figures: serializeFigures(figures),
      byClass,
      expensesByCategory: expenses,
      weeklyCollections: [...weekly.entries()].sort().map(([week, amount]) => ({ week, amount: money(amount) })),
      termsTrend,
      pendingApprovals: { discounts: pending[0], expenses: pending[1], reversals: pending[2], payroll: pending[3], termClose: pending[4] },
    };
  }),
);
