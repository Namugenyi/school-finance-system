/**
 * Data every installation needs: reference lists (FR-105), fee items (FR-404), roles and
 * permissions (WR-01), school settings (FR-107) and the PAYE/NSSF rates from FRS 6.2.
 * Safe to run repeatedly: existing values are left as they are.
 */
import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { FEE_ITEMS, REFERENCE_LISTS } from '../finance/reference';
import { DEFAULT_ROLES } from '../auth/permissions';
import { FRS_PAYE_BANDS } from '../finance/payroll';
import { dec } from '../lib/money';

export async function seedBase(db: PrismaClient, opts: { schoolName?: string; startYear?: number } = {}) {
  await db.schoolSettings.upsert({
    where: { id: 1 },
    create: { id: 1, schoolName: opts.schoolName ?? 'Supreme Tower Junior Academy', address: 'Kasangati, Wakiso District, Uganda', pupilIdStartYear: opts.startYear ?? new Date().getFullYear() },
    update: {},
  });

  for (const [i, list] of REFERENCE_LISTS.entries()) {
    const l = await db.referenceList.upsert({
      where: { code: list.code },
      create: { code: list.code, name: list.name, description: list.description, locked: list.locked, sortOrder: i },
      update: { locked: list.locked, description: list.description, sortOrder: i },
    });
    for (const [j, v] of list.values.entries()) {
      // A value someone already added by hand under the same label is kept as it is.
      const sameLabel = await db.referenceValue.findFirst({ where: { listId: l.id, code: { not: v.code }, label: { equals: v.label, mode: 'insensitive' } } });
      if (sameLabel) continue;
      await db.referenceValue.upsert({
        where: { listId_code: { listId: l.id, code: v.code } },
        create: { listId: l.id, code: v.code, label: v.label, sortOrder: j + 1, isSystem: v.system ?? false },
        update: { isSystem: v.system ?? false },
      });
    }
  }

  for (const [i, f] of FEE_ITEMS.entries()) {
    await db.feeItem.upsert({
      where: { code: f.code },
      create: { code: f.code, name: f.name, defaultMandatory: f.defaultMandatory, frequency: f.frequency, isSystem: f.isSystem ?? false, sortOrder: i + 1 },
      update: { isSystem: f.isSystem ?? false },
    });
  }

  for (const role of DEFAULT_ROLES) {
    const existing = await db.role.findUnique({ where: { code: role.code } });
    if (existing) continue;
    await db.role.create({
      data: { code: role.code, name: role.name, description: role.description, isSystem: true, permissions: { create: [...new Set(role.permissions)].map((permission) => ({ permission })) } },
    });
  }

  for (const s of [{ code: 'KG', name: 'Kindergarten', sortOrder: 1 }, { code: 'PRIMARY', name: 'Primary', sortOrder: 2 }]) {
    await db.section.upsert({ where: { code: s.code }, create: s, update: {} });
  }

  if ((await db.statutoryRateSet.count()) === 0) {
    await db.statutoryRateSet.create({
      data: {
        effectiveFrom: new Date(Date.UTC(2000, 0, 1)),
        nssfEmployeeRate: dec('0.05'),
        nssfEmployerRate: dec('0.10'),
        notes: 'Rates as written in FRS STJA-FRS-v12 section 6.2. Legacy values: must be checked by a payroll professional before live use (G-03).',
        validated: false,
        bands: { create: FRS_PAYE_BANDS.map((b) => ({ lowerBound: dec(b.lowerBound), upperBound: b.upperBound === null ? null : dec(b.upperBound), rate: dec(b.rate) })) },
      },
    });
  }
}

/** Create the first administrator if no users exist yet. */
export async function ensureAdmin(db: PrismaClient, username: string, password: string, fullName = 'System Administrator') {
  if ((await db.user.count()) > 0) return false;
  const admin = await db.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
  await db.user.create({
    data: { username, fullName, passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true, roles: { create: [{ roleId: admin.id }] } },
  });
  return true;
}
