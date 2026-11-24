import type { Db } from '../db';

/**
 * Atomically take the next number from a named sequence. The row lock taken by the upsert makes
 * this safe under concurrent requests (WR-23); numbers are never reused, even if the surrounding
 * transaction later fails and a gap appears.
 */
export async function nextSequence(db: Db, key: string): Promise<number> {
  const rows = await db.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "IdSequence" ("key", "nextValue") VALUES (${key}, 2)
    ON CONFLICT ("key") DO UPDATE SET "nextValue" = "IdSequence"."nextValue" + 1
    RETURNING ("nextValue" - 1) AS "value"`;
  return Number(rows[0].value);
}

export const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** BR-13: "STJA-" + StartYear + "-" + Sequence, sequence per start year (A-04). */
export async function nextPupilCode(db: Db, startYear: number): Promise<string> {
  const n = await nextSequence(db, `PUPIL:${startYear}`);
  if (n > 9999) throw new Error(`Pupil number range for ${startYear} is exhausted`);
  return `STJA-${startYear}-${pad(n, 4)}`;
}

/** BR-14: "STF-" + Sequence. */
export async function nextStaffCode(db: Db): Promise<string> {
  return `STF-${pad(await nextSequence(db, 'STAFF'), 3)}`;
}

export async function nextReceiptNo(db: Db, year: number): Promise<string> {
  return `RCT-${year}-${pad(await nextSequence(db, `RECEIPT:${year}`), 5)}`;
}

export async function nextChargeNo(db: Db): Promise<string> {
  return `CHG-${pad(await nextSequence(db, 'CHARGE'), 6)}`;
}

export async function nextExpenseNo(db: Db): Promise<string> {
  return `EXP-${pad(await nextSequence(db, 'EXPENSE'), 6)}`;
}

export async function nextContributionNo(db: Db): Promise<string> {
  return `OWN-${pad(await nextSequence(db, 'OWNER'), 6)}`;
}
