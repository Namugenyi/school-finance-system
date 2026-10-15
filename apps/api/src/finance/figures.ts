/**
 * The one place financial totals are calculated. Reports, the dashboard, term snapshots, the
 * arrears list and statements all call these functions, so their figures always agree.
 */
import type { Prisma } from '@prisma/client';
import type { Db } from '../db';
import { dec, money, round2, ZERO, type Decimal } from '../lib/money';
import { activePupilCountForTerm } from '../modules/pupils';
import { fundingBucket } from './policies';

export interface Scope {
  termId?: number;
  academicYearId?: number;
}

export function balanceWhere(scope: Scope): Prisma.ChargeBalanceWhereInput {
  return { voided: false, termId: scope.termId, academicYearId: scope.academicYearId };
}

function expenseWhere(scope: Scope): Prisma.ExpenseWhereInput {
  return { status: 'APPROVED', termId: scope.termId, term: scope.academicYearId ? { academicYearId: scope.academicYearId } : undefined };
}

/** BR-07 / WR-20: collected ÷ billed, or null ("n/a") when nothing was billed. */
export function collectionRate(collected: Decimal, billed: Decimal): Decimal | null {
  if (billed.lte(0)) return null;
  return collected.div(billed).toDecimalPlaces(4);
}

export interface Figures {
  activePupils: number | null;
  grossBilled: Decimal;
  totalDiscounts: Decimal;
  /** D-02: net of approved discounts. D-01: excludes Arrears B/F. */
  totalBilled: Decimal;
  arrearsBroughtForward: Decimal;
  collectedOnCurrent: Decimal;
  collectedOnArrears: Decimal;
  totalCollected: Decimal;
  carriedForwardOut: Decimal;
  /** Sum of positive balances (arrears owed). */
  outstanding: Decimal;
  /** Sum of negative balances, shown as a positive number (FR-507). */
  credits: Decimal;
  schoolFundedExpenses: Decimal;
  ownerFundedExpenses: Decimal;
  otherFundedExpenses: Decimal;
  totalExpenses: Decimal;
  /** BR-12: total collected − total expenses (owner loans and contributions are not income, BR-21, C-09). */
  netResult: Decimal;
  collectionRate: Decimal | null;
}

export async function computeFigures(db: Db, scope: Scope): Promise<Figures> {
  const where = balanceWhere(scope);
  const [current, arrears, positive, negative, expenses] = await Promise.all([
    db.chargeBalance.aggregate({ where: { ...where, isArrears: false }, _sum: { amountCharged: true, discount: true, netDue: true, totalPaid: true, carriedForward: true } }),
    db.chargeBalance.aggregate({ where: { ...where, isArrears: true }, _sum: { netDue: true, totalPaid: true, carriedForward: true } }),
    db.chargeBalance.aggregate({ where: { ...where, balance: { gt: 0 } }, _sum: { balance: true } }),
    db.chargeBalance.aggregate({ where: { ...where, balance: { lt: 0 } }, _sum: { balance: true } }),
    db.expense.groupBy({ by: ['fundingSource'], where: expenseWhere(scope), _sum: { amount: true } }),
  ]);
  const bucket = { SCHOOL: ZERO, OWNER: ZERO, OTHER: ZERO };
  for (const e of expenses) {
    const b = fundingBucket(e.fundingSource);
    bucket[b] = bucket[b].plus(dec(e._sum.amount));
  }
  const totalBilled = dec(current._sum.netDue);
  const collectedOnCurrent = dec(current._sum.totalPaid);
  const collectedOnArrears = dec(arrears._sum.totalPaid);
  const totalCollected = collectedOnCurrent.plus(collectedOnArrears);
  const totalExpenses = bucket.SCHOOL.plus(bucket.OWNER).plus(bucket.OTHER);

  let activePupils: number | null = null;
  if (scope.termId) {
    const term = await db.academicTerm.findUniqueOrThrow({ where: { id: scope.termId } });
    activePupils = await activePupilCountForTerm(db, term);
  } else if (scope.academicYearId) {
    const terms = await db.academicTerm.findMany({ where: { academicYearId: scope.academicYearId } });
    if (terms.length) {
      activePupils = await activePupilCountForTerm(db, {
        startDate: new Date(Math.min(...terms.map((t) => t.startDate.getTime()))),
        endDate: new Date(Math.max(...terms.map((t) => t.endDate.getTime()))),
      });
    }
  }

  return {
    activePupils,
    grossBilled: dec(current._sum.amountCharged),
    totalDiscounts: dec(current._sum.discount),
    totalBilled,
    arrearsBroughtForward: dec(arrears._sum.netDue),
    collectedOnCurrent,
    collectedOnArrears,
    totalCollected,
    carriedForwardOut: dec(current._sum.carriedForward).plus(dec(arrears._sum.carriedForward)),
    outstanding: dec(positive._sum.balance),
    credits: dec(negative._sum.balance).abs(),
    schoolFundedExpenses: bucket.SCHOOL,
    ownerFundedExpenses: bucket.OWNER,
    otherFundedExpenses: bucket.OTHER,
    totalExpenses,
    netResult: totalCollected.minus(totalExpenses),
    // Collection rate compares like with like: this period's billing and what was paid against it.
    collectionRate: collectionRate(collectedOnCurrent, totalBilled),
  };
}

export function serializeFigures(f: Figures) {
  const out: Record<string, string | number | null> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === null || typeof v === 'number') out[k] = v;
    else if (k === 'collectionRate') out[k] = v.toFixed(4);
    else out[k] = money(round2(v as Decimal));
  }
  return out;
}

/** Per-pupil totals used by the arrears list (FR-1301) and statements (FR-1405). */
export function pupilOverallStatus(outstanding: Decimal, paid: Decimal): 'PAID_IN_FULL' | 'PARTIAL' | 'UNPAID' {
  if (outstanding.lte(0)) return 'PAID_IN_FULL';
  if (paid.gt(0)) return 'PARTIAL';
  return 'UNPAID';
}
