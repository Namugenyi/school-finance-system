/**
 * Payroll arithmetic (FR-903 to FR-906, BR-08 to BR-10, FRS 6.2). Rates and bands come from an
 * effective-dated rate set (WR-17). The FRS bands are legacy values: payroll stays off for live
 * use until a payroll professional signs them off (G-03).
 */
import { badRequest } from '../lib/errors';
import type { Prisma } from '@prisma/client';
import { dec, round2, type Decimal } from '../lib/money';

type Value = Prisma.Decimal.Value;

export interface Band {
  lowerBound: Value;
  upperBound: Value | null;
  rate: Value;
}

/** Progressive PAYE: each band taxes only the part of monthly income inside it. */
export function computePaye(monthlyIncome: Value, bands: Band[]): Decimal {
  const income = dec(monthlyIncome);
  let tax = dec(0);
  for (const b of [...bands].sort((x, y) => dec(x.lowerBound).comparedTo(dec(y.lowerBound)))) {
    const lower = dec(b.lowerBound);
    if (income.lte(lower)) continue;
    const top = b.upperBound === null ? income : minOf(income, dec(b.upperBound));
    tax = tax.plus(top.minus(lower).times(dec(b.rate)));
  }
  return round2(tax);
}

function minOf(a: Decimal, b: Decimal) {
  return a.lt(b) ? a : b;
}

export interface PayLine {
  basic: Decimal;
  nssfEmployee: Decimal;
  nssfEmployer: Decimal;
  paye: Decimal;
  otherDeductions: Decimal;
  net: Decimal;
}

export function computePayLine(
  basicSalary: Value,
  rates: { nssfEmployeeRate: Value; nssfEmployerRate: Value; bands: Band[] },
  otherDeductions: Value = 0,
  staffName = 'this staff member',
): PayLine {
  const basic = dec(basicSalary);
  const nssfEmployee = round2(basic.times(dec(rates.nssfEmployeeRate)));
  const nssfEmployer = round2(basic.times(dec(rates.nssfEmployerRate)));
  const paye = computePaye(basic, rates.bands);
  const other = dec(otherDeductions);
  const net = basic.minus(nssfEmployee).minus(paye).minus(other);
  // A-19: a negative net pay is rejected rather than silently recorded.
  if (net.lt(0)) throw badRequest(`Deductions for ${staffName} are more than their pay. Reduce the other deductions.`);
  return { basic, nssfEmployee, nssfEmployer, paye, otherDeductions: other, net };
}

/** The FRS 6.2 bands, used to seed the first rate set. */
export const FRS_PAYE_BANDS: Band[] = [
  { lowerBound: 0, upperBound: 235000, rate: 0 },
  { lowerBound: 235000, upperBound: 335000, rate: 0.1 },
  { lowerBound: 335000, upperBound: 410000, rate: 0.2 },
  { lowerBound: 410000, upperBound: null, rate: 0.3 },
];
