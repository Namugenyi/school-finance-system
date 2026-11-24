import { badRequest } from './errors';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a calendar date "YYYY-MM-DD" into a UTC-midnight Date (how Prisma stores DATE columns). */
export function parseDate(value: string, field = 'date'): Date {
  const m = ISO_DATE.exec(value);
  if (!m) throw badRequest(`${field} must be a date in YYYY-MM-DD form`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    throw badRequest(`${field} is not a real calendar date`);
  }
  return d;
}

/** Format a DATE column value as "YYYY-MM-DD". */
export function isoDate(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

/** Today's calendar date in Africa/Kampala (UTC+3, no daylight saving), as UTC midnight. */
export function todayKampala(now = new Date()): Date {
  const kampala = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return new Date(Date.UTC(kampala.getUTCFullYear(), kampala.getUTCMonth(), kampala.getUTCDate()));
}

/** Display format required by FR-606 / NFR-10: DD/MM/YYYY. */
export function displayDate(value: Date | null | undefined): string {
  if (!value) return '';
  const d = String(value.getUTCDate()).padStart(2, '0');
  const m = String(value.getUTCMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${value.getUTCFullYear()}`;
}
