import { describe, expect, it } from 'vitest';
import { computePayLine, computePaye, FRS_PAYE_BANDS } from '../src/finance/payroll';
import { frequencySkipReason, fundingBucket, payrollExpenseAmount, postingTermForMonth } from '../src/finance/policies';
import { collectionRate, pupilOverallStatus } from '../src/finance/figures';
import { displayDate, parseDate, todayKampala } from '../src/lib/dates';
import { dec } from '../src/lib/money';

describe('PAYE (FRS 6.2)', () => {
  it.each([
    ['200000', '0.00'],
    ['235000', '0.00'],
    ['300000', '6500.00'], // 65,000 × 10%
    ['335000', '10000.00'],
    ['400000', '23000.00'], // 10,000 + 65,000 × 20%
    ['410000', '25000.00'],
    ['500000', '52000.00'], // 25,000 + 90,000 × 30%
  ])('monthly income %s gives PAYE %s', (income, tax) => {
    expect(computePaye(income, FRS_PAYE_BANDS).toFixed(2)).toBe(tax);
  });
});

describe('pay line (BR-08 to BR-10)', () => {
  const rates = { nssfEmployeeRate: '0.05', nssfEmployerRate: '0.10', bands: FRS_PAYE_BANDS };
  it('computes NSSF, PAYE and net pay', () => {
    const line = computePayLine('500000', rates, '10000');
    expect(line.nssfEmployee.toFixed(2)).toBe('25000.00');
    expect(line.nssfEmployer.toFixed(2)).toBe('50000.00');
    expect(line.paye.toFixed(2)).toBe('52000.00');
    expect(line.net.toFixed(2)).toBe('413000.00');
  });
  it('rejects negative net pay (A-19)', () => {
    expect(() => computePayLine('300000', rates, '400000', 'Jane')).toThrow(/Jane/);
  });
  it('posts basic plus employer NSSF (D-07)', () => {
    expect(payrollExpenseAmount({ totalBasic: dec('1000000'), totalNssfEmployer: dec('100000') }).toFixed(2)).toBe('1100000.00');
  });
});

describe('charge frequency (D-04)', () => {
  const none = { everCharged: false, chargedThisYear: false, chargedThisTerm: false };
  it('charges a once-only fee the first time only', () => {
    expect(frequencySkipReason('ONCE', none)).toBeNull();
    expect(frequencySkipReason('ONCE', { ...none, everCharged: true })).toMatch(/Once-only/);
  });
  it('charges a yearly fee once per year', () => {
    expect(frequencySkipReason('YEAR', { ...none, everCharged: true })).toBeNull();
    expect(frequencySkipReason('YEAR', { everCharged: true, chargedThisYear: true, chargedThisTerm: false })).toMatch(/Yearly/);
  });
  it('charges a termly fee every term but never twice in a term', () => {
    expect(frequencySkipReason('TERM', { everCharged: true, chargedThisYear: true, chargedThisTerm: false })).toBeNull();
    expect(frequencySkipReason('TERM', { everCharged: true, chargedThisYear: true, chargedThisTerm: true })).toMatch(/this term/);
  });
});

describe('payroll posting term (D-07)', () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const terms = [
    { id: 1, startDate: d('2026-02-02'), endDate: d('2026-04-30') },
    { id: 2, startDate: d('2026-05-25'), endDate: d('2026-08-14') },
  ];
  it('uses the term containing the month', () => expect(postingTermForMonth(terms, 2026, 3)?.id).toBe(1));
  it('uses the term just ended for a holiday month', () => expect(postingTermForMonth(terms, 2026, 9)?.id).toBe(2));
  it('returns null before any term', () => expect(postingTermForMonth(terms, 2026, 1)).toBeNull());
});

describe('reporting rules', () => {
  it('maps funding sources to three buckets (D-03)', () => {
    expect(fundingBucket('SCHOOL_FUNDS')).toBe('SCHOOL');
    expect(fundingBucket('OWNER_LOAN')).toBe('OWNER');
    expect(fundingBucket('OWNER_CONTRIBUTION')).toBe('OWNER');
    expect(fundingBucket('DONATION')).toBe('OTHER');
    expect(fundingBucket('OTHER')).toBe('OTHER');
  });
  it('gives n/a collection rate when nothing is billed (WR-20)', () => {
    expect(collectionRate(dec(100), dec(0))).toBeNull();
    expect(collectionRate(dec(50), dec(200))?.toFixed(4)).toBe('0.2500');
  });
  it('derives a pupil overall status (FR-1405)', () => {
    expect(pupilOverallStatus(dec(0), dec(100))).toBe('PAID_IN_FULL');
    expect(pupilOverallStatus(dec(-5), dec(100))).toBe('PAID_IN_FULL');
    expect(pupilOverallStatus(dec(10), dec(100))).toBe('PARTIAL');
    expect(pupilOverallStatus(dec(10), dec(0))).toBe('UNPAID');
  });
});

describe('dates (FR-606, A-03)', () => {
  it('formats DD/MM/YYYY', () => expect(displayDate(parseDate('2026-03-05'))).toBe('05/03/2026'));
  it('rejects impossible dates', () => expect(() => parseDate('2026-02-30')).toThrow());
  it('uses Kampala time for today', () => {
    expect(displayDate(todayKampala(new Date('2026-03-04T22:30:00Z')))).toBe('05/03/2026');
  });
});
