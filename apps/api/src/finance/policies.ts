/**
 * The finance rules the FRS left open, kept in one file so a different decision is a contained
 * change. Each rule names its decision in docs/requirements/03-decisions-and-issues.md.
 * Tina accepted all seven recommendations on 13/10/2026, so these are confirmed decisions.
 */
import { badRequest, forbidden } from '../lib/errors';
import { Decimal } from '../lib/money';

/** D-03: three expense buckets. Total Expenses = school + owner + other (PC-05 amends BR-11). */
export type FundingBucket = 'SCHOOL' | 'OWNER' | 'OTHER';
export const FUNDING_BUCKET: Record<string, FundingBucket> = {
  SCHOOL_FUNDS: 'SCHOOL',
  OWNER_CONTRIBUTION: 'OWNER',
  OWNER_LOAN: 'OWNER',
  DONATION: 'OTHER',
  OTHER: 'OTHER',
};
export const fundingBucket = (source: string): FundingBucket => FUNDING_BUCKET[source] ?? 'OTHER';

/**
 * D-01 and D-02: "Total Billed" for a term is the net amount due (after approved discounts) on
 * that term's new charges. Arrears B/F charges are reported on their own line, not as billing.
 */
export const BILLED_INCLUDES_ARREARS_BF = false;

/** D-04: whether billing should skip a fee for a pupil because of its charge frequency. */
export function frequencySkipReason(
  frequency: string,
  history: { everCharged: boolean; chargedThisYear: boolean; chargedThisTerm: boolean },
): string | null {
  if (history.chargedThisTerm) return 'Already charged this term';
  if (frequency === 'ONCE' && history.everCharged) return 'Once-only fee already charged before';
  if (frequency === 'YEAR' && history.chargedThisYear) return 'Yearly fee already charged this year';
  return null;
}

/** D-05 / WR-02: nobody approves their own entry. */
export function assertDifferentApprover(enteredById: number, approverId: number) {
  if (enteredById === approverId) {
    throw forbidden('You cannot approve your own entry. Another authorised person must approve it.');
  }
}

/** D-06: receipts are numbered by the system per calendar year of the payment date. */
export const receiptYear = (paymentDate: Date) => paymentDate.getUTCFullYear();

/** D-07: the Salaries expense for a payroll run is the school's full cost: basic + employer NSSF. */
export function payrollExpenseAmount(run: { totalBasic: Decimal; totalNssfEmployer: Decimal }): Decimal {
  return new Decimal(run.totalBasic).plus(run.totalNssfEmployer);
}

/**
 * D-07: a payroll month posts to the term containing the middle of the month; a month that falls
 * in a holiday posts to the term that ended most recently before it.
 */
export function postingTermForMonth<T extends { startDate: Date; endDate: Date }>(terms: T[], year: number, month: number): T | null {
  const mid = new Date(Date.UTC(year, month - 1, 15));
  const containing = terms.find((t) => t.startDate <= mid && t.endDate >= mid);
  if (containing) return containing;
  const ended = terms.filter((t) => t.endDate < mid).sort((a, b) => b.endDate.getTime() - a.endDate.getTime());
  return ended[0] ?? null;
}

/** A-10 / WR-06: discounts may total up to 100% of the charge, never more. */
export function assertDiscountWithinCharge(amountCharged: Decimal, existingDiscounts: Decimal, newDiscount: Decimal) {
  if (existingDiscounts.plus(newDiscount).gt(amountCharged)) {
    throw badRequest('Discounts cannot add up to more than the amount charged');
  }
}
