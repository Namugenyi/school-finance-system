import { Prisma } from '@prisma/client';

export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

export const ZERO = new Decimal(0);

export function dec(value: Prisma.Decimal.Value | null | undefined): Decimal {
  if (value === null || value === undefined) return new Decimal(0);
  return new Decimal(value);
}

export function sum(values: Array<Prisma.Decimal.Value | null | undefined>): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), new Decimal(0));
}

/** Money as a fixed two-decimal string for JSON responses, e.g. "1250000.00". */
export function money(value: Prisma.Decimal.Value | null | undefined): string {
  return dec(value).toFixed(2);
}

/** Money for messages people read, e.g. "UGX 1,250,000.00" (NFR-10). */
export function ugx(value: Prisma.Decimal.Value | null | undefined): string {
  const [whole, cents] = dec(value).toFixed(2).split('.');
  return `UGX ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}

/** Round to whole shillings' cents (2 dp), half up. */
export function round2(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
