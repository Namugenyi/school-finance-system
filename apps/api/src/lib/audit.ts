import type { Db } from '../db';
import type { AuthUser } from '../auth/session';

/** Make Decimal and Date values JSON-safe for the audit log. */
function plain(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

/** WR-04: record who did what, to which record, when, why, and the before/after state. */
export async function audit(
  db: Db,
  user: AuthUser | null,
  action: string,
  entityType: string,
  entityId: string | number | null,
  opts: { before?: unknown; after?: unknown; reason?: string | null; ip?: string | null } = {},
) {
  await db.auditLog.create({
    data: {
      userId: user?.id ?? null,
      username: user?.username ?? null,
      action,
      entityType,
      entityId: entityId === null ? null : String(entityId),
      reason: opts.reason ?? null,
      before: plain(opts.before) as never,
      after: plain(opts.after) as never,
      ip: opts.ip ?? null,
    },
  });
}
