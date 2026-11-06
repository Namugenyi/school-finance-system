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

/** Pupil fields that need pupils.contacts on the normal screens (matches serializePupil). */
const CONTACT_FIELDS = ['phonePrimary', 'phoneAlt', 'address', 'emergencyName', 'emergencyRelationship', 'emergencyRelationshipOther', 'emergencyPhone'];
/** Audit entries about staff and payroll hold salaries and tax numbers, which need payroll.view. */
const PAYROLL_ENTITIES = new Set(['Staff', 'PayrollRun', 'PayrollEntry']);
const HIDDEN = '(hidden: you do not have access to this information)';

function withoutContacts(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const copy: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const k of CONTACT_FIELDS) if (k in copy) copy[k] = HIDDEN;
  return copy;
}

/**
 * The audit log keeps full before/after values, so a viewer sees only what their role could see on
 * the record itself: pupil contact details need pupils.contacts and staff or payroll details need payroll.view.
 */
export function redactAuditEntry<T extends { entityType: string; before: unknown; after: unknown }>(entry: T, permissions: Set<string>): T {
  if (PAYROLL_ENTITIES.has(entry.entityType) && !permissions.has('payroll.view')) {
    return { ...entry, before: entry.before == null ? entry.before : HIDDEN, after: entry.after == null ? entry.after : HIDDEN };
  }
  if ((entry.entityType === 'Pupil' || entry.entityType === 'PupilHistory') && !permissions.has('pupils.contacts')) {
    return { ...entry, before: withoutContacts(entry.before), after: withoutContacts(entry.after) };
  }
  return entry;
}
