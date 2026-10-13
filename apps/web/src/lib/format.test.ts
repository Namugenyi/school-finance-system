import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatMoney, formatRate, parseDisplayDate } from './format';

describe('formatting (FR-405, FR-606, NFR-10)', () => {
  it('formats UGX with separators and two decimals', () => {
    expect(formatMoney('1250000')).toBe('1,250,000.00');
    expect(formatMoney(-5000)).toBe('-5,000.00');
    expect(formatMoney('0', { currency: true })).toBe('UGX 0.00');
  });
  it('shows dates as DD/MM/YYYY', () => {
    expect(formatDate('2026-03-05')).toBe('05/03/2026');
    expect(formatDateTime('2026-03-04T22:30:00Z')).toBe('05/03/2026 01:30');
  });
  it('parses typed DD/MM/YYYY and rejects impossible dates', () => {
    expect(parseDisplayDate('5/3/2026')).toBe('2026-03-05');
    expect(parseDisplayDate('31/02/2026')).toBeNull();
    expect(parseDisplayDate('2026-03-05')).toBeNull();
  });
  it('shows n/a for a missing collection rate', () => {
    expect(formatRate(null)).toBe('n/a');
    expect(formatRate('0.3413')).toBe('34.1%');
  });
});
