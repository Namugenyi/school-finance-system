/** UGX with thousands separators and two decimals (FR-405, NFR-10): 1,250,000.00 */
export function formatMoney(value: string | number | null | undefined, opts: { currency?: boolean } = {}): string {
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return String(value);
  const s = new Intl.NumberFormat('en-UG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
  const signed = n < 0 ? `-${s}` : s;
  return opts.currency ? `UGX ${signed}` : signed;
}

/** DD/MM/YYYY from "YYYY-MM-DD" or an ISO timestamp (FR-606). */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const iso = value.length > 10 ? kampalaDate(value) : value;
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** DD/MM/YYYY HH:MM in Kampala time for timestamps. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const k = new Date(new Date(value).getTime() + 3 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(k.getUTCDate())}/${p(k.getUTCMonth() + 1)}/${k.getUTCFullYear()} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

function kampalaDate(ts: string): string {
  return new Date(new Date(ts).getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}

/** Today in Africa/Kampala as YYYY-MM-DD. */
export function todayIso(): string {
  return kampalaDate(new Date().toISOString());
}

/** Parse DD/MM/YYYY typed by a user into YYYY-MM-DD, or null if invalid. */
export function parseDisplayDate(text: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function formatRate(rate: string | null | undefined): string {
  if (rate === null || rate === undefined) return 'n/a';
  return `${(Number(rate) * 100).toFixed(1)}%`;
}

/** Strip thousands separators from a typed amount. */
export const cleanAmount = (s: string) => s.replace(/,/g, '').trim();

export const sumMoney = (values: Array<string | number>) => values.reduce<number>((s, v) => s + Number(v || 0), 0);
