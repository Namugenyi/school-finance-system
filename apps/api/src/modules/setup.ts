import { Router } from 'express';
import { z } from 'zod';
import { prisma, type Db } from '../db';
import { handle, idParam, parse } from '../lib/http';
import { badRequest, conflict, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { isoDate, parseDate, todayKampala } from '../lib/dates';
import { currentUser, requireAuth, requirePermission } from '../auth/session';

export const router = Router();

// ───────── Shared helpers used by other modules ─────────

/** CTL-01 / BR-24: a coded field must hold an active value from its own reference list. */
export async function assertRefCode(db: Db, listCode: string, code: string, field: string) {
  const value = await db.referenceValue.findFirst({ where: { code, list: { code: listCode } } });
  if (!value || !value.active) throw badRequest(`${field} must be one of the values set up in ${listCode.replace(/_/g, ' ').toLowerCase()}`);
  return value;
}

/** Value code that asks for typed details instead of a list entry. */
export const OTHER_CODE = 'OTHER';

/** The typed text kept when "Other" is chosen; required then, dropped for any other choice. */
export function otherText(code: string | null | undefined, text: string | null | undefined, field: string): string | null {
  if (code !== OTHER_CODE) return null;
  const t = text?.trim();
  if (!t) throw badRequest(`${field}: you chose "Other", so type what it is`);
  if (t.length > 120) throw badRequest(`${field}: keep the "Other" details under 120 characters`);
  return t;
}

export async function getSettings(db: Db) {
  const s = await db.schoolSettings.findUnique({ where: { id: 1 } });
  if (!s) throw new Error('School settings are missing. Run the database seed.');
  return s;
}

export async function getTerm(db: Db, id: number) {
  const term = await db.academicTerm.findUnique({ where: { id }, include: { academicYear: true } });
  if (!term) throw notFound('Term');
  return term;
}

export function termLabel(term: { name: string; academicYear: { year: number } }) {
  return `${term.name} ${term.academicYear.year}`;
}

export function serializeTerm(t: {
  id: number; number: number; name: string; startDate: Date; endDate: Date; status: string; academicYearId: number;
  academicYear?: { year: number };
}) {
  return {
    id: t.id,
    academicYearId: t.academicYearId,
    year: t.academicYear?.year,
    number: t.number,
    name: t.name,
    label: t.academicYear ? `${t.name} ${t.academicYear.year}` : t.name,
    startDate: isoDate(t.startDate),
    endDate: isoDate(t.endDate),
    status: t.status,
  };
}

// ───────── Lookups: every dropdown's values in one call (FR-102, FR-103) ─────────

router.get(
  '/lookups',
  requireAuth,
  handle(async () => {
    const [lists, years, sections, classes, feeItems, settings] = await Promise.all([
      prisma.referenceList.findMany({ include: { values: { orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] } }, orderBy: { sortOrder: 'asc' } }),
      prisma.academicYear.findMany({ include: { terms: { orderBy: { number: 'asc' } } }, orderBy: { year: 'desc' } }),
      prisma.section.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.schoolClass.findMany({ include: { section: true }, orderBy: [{ section: { sortOrder: 'asc' } }, { sortOrder: 'asc' }] }),
      prisma.feeItem.findMany({ orderBy: { sortOrder: 'asc' } }),
      getSettings(prisma),
    ]);
    const today = todayKampala();
    const terms = years.flatMap((y) => y.terms.map((t) => ({ ...t, academicYear: { year: y.year } })));
    const current = terms.find((t) => t.startDate <= today && t.endDate >= today) ?? null;
    return {
      lists: Object.fromEntries(
        lists.map((l) => [l.code, l.values.map((v) => ({ id: v.id, code: v.code, label: v.label, active: v.active, isSystem: v.isSystem }))]),
      ),
      years: years.map((y) => ({ id: y.id, year: y.year, terms: y.terms.map((t) => serializeTerm({ ...t, academicYear: { year: y.year } })) })),
      terms: terms.map(serializeTerm),
      currentTermId: current?.id ?? null,
      sections: sections.map((s) => ({ id: s.id, code: s.code, name: s.name, active: s.active })),
      classes: classes.map((c) => ({ id: c.id, name: c.name, sectionId: c.sectionId, sectionName: c.section.name, active: c.active, sortOrder: c.sortOrder })),
      feeItems: feeItems.map((f) => ({ id: f.id, code: f.code, name: f.name, defaultMandatory: f.defaultMandatory, frequency: f.frequency, isSystem: f.isSystem, active: f.active })),
      school: { name: settings.schoolName, payrollEnabled: settings.payrollEnabled },
    };
  }),
);

// ───────── School settings (FR-107) ─────────

router.get('/settings', requirePermission('setup.view'), handle(async () => getSettings(prisma)));

router.patch(
  '/settings',
  requirePermission('setup.manage'),
  handle(async (req) => {
    const body = parse(
      z.object({
        schoolName: z.string().trim().min(2).max(200).optional(),
        address: z.string().trim().max(300).nullable().optional(),
        phone: z.string().trim().max(60).nullable().optional(),
        email: z.string().trim().email().max(200).nullable().optional().or(z.literal('').transform(() => null)),
        registrationNo: z.string().trim().max(100).nullable().optional(),
        receiptFooter: z.string().trim().max(300).nullable().optional(),
        adminContactName: z.string().trim().max(120).nullable().optional(),
        adminContactPhone: z.string().trim().max(60).nullable().optional(),
        adminContactEmail: z.string().trim().email().max(200).nullable().optional().or(z.literal('').transform(() => null)),
        pupilIdStartYear: z.number().int().min(2000).max(2100).optional(),
        payrollEnabled: z.boolean().optional(),
      }),
      req.body,
    );
    const before = await getSettings(prisma);
    const after = await prisma.schoolSettings.update({ where: { id: 1 }, data: body });
    await audit(prisma, currentUser(req), 'settings.update', 'SchoolSettings', 1, { before, after });
    return after;
  }),
);

// ───────── Reference lists (FR-101 to FR-105, A-07) ─────────

router.get(
  '/reference-lists',
  requirePermission('setup.view'),
  handle(async () =>
    prisma.referenceList.findMany({
      include: { values: { orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] } },
      orderBy: { sortOrder: 'asc' },
    }),
  ),
);

const toCode = (label: string) =>
  label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'VALUE';

router.post(
  '/reference-lists/:code/values',
  requirePermission('setup.manage'),
  handle(async (req) => {
    const body = parse(z.object({ label: z.string().trim().min(1).max(100), sortOrder: z.number().int().optional() }), req.body);
    const list = await prisma.referenceList.findUnique({ where: { code: req.params.code }, include: { values: true } });
    if (!list) throw notFound('Reference list');
    if (list.locked) throw badRequest(`${list.name} is fixed by the FRS. You can rename its values but not add new ones.`);
    if (list.values.some((v) => v.label.toLowerCase() === body.label.toLowerCase())) {
      throw conflict(`"${body.label}" is already in ${list.name}`);
    }
    let code = toCode(body.label);
    while (list.values.some((v) => v.code === code)) code = `${code}_${Math.floor(Math.random() * 1000)}`;
    const value = await prisma.referenceValue.create({
      data: { listId: list.id, code, label: body.label, sortOrder: body.sortOrder ?? list.values.length + 1 },
    });
    await audit(prisma, currentUser(req), 'reference.add', 'ReferenceValue', value.id, { after: value });
    return value;
  }),
);

router.patch(
  '/reference-values/:id',
  requirePermission('setup.manage'),
  handle(async (req) => {
    const id = idParam(req);
    const body = parse(
      z.object({ label: z.string().trim().min(1).max(100).optional(), sortOrder: z.number().int().optional(), active: z.boolean().optional() }),
      req.body,
    );
    const before = await prisma.referenceValue.findUnique({ where: { id }, include: { list: { include: { values: true } } } });
    if (!before) throw notFound('Reference value');
    if (body.active === false && before.isSystem) throw badRequest('This value is used by the system and cannot be deactivated. You can rename it.');
    if (body.label && before.list.values.some((v) => v.id !== id && v.label.toLowerCase() === body.label!.toLowerCase())) {
      throw conflict(`"${body.label}" is already in ${before.list.name}`);
    }
    const after = await prisma.referenceValue.update({ where: { id }, data: body });
    await audit(prisma, currentUser(req), 'reference.update', 'ReferenceValue', id, { before, after });
    return after;
  }),
);

// ───────── Academic years and terms (FR-106) ─────────

router.post(
  '/years',
  requirePermission('setup.manage'),
  handle(async (req) => {
    const body = parse(z.object({ year: z.number().int().min(2000).max(2100) }), req.body);
    if (await prisma.academicYear.findUnique({ where: { year: body.year } })) throw conflict(`Academic year ${body.year} already exists`);
    const year = await prisma.academicYear.create({ data: { year: body.year } });
    await audit(prisma, currentUser(req), 'year.create', 'AcademicYear', year.id, { after: year });
    return year;
  }),
);

const termBody = z.object({
  academicYearId: z.number().int(),
  number: z.number().int().min(1).max(3),
  name: z.string().trim().min(1).max(40).optional(),
  startDate: z.string(),
  endDate: z.string(),
});

async function assertNoOverlap(start: Date, end: Date, excludeId?: number) {
  if (end < start) throw badRequest('Term end date must be on or after its start date');
  const overlap = await prisma.academicTerm.findFirst({
    where: { id: excludeId ? { not: excludeId } : undefined, startDate: { lte: end }, endDate: { gte: start } },
    include: { academicYear: true },
  });
  if (overlap) throw conflict(`These dates overlap ${termLabel(overlap)}`);
}

router.post(
  '/terms',
  requirePermission('setup.manage'),
  handle(async (req) => {
    const body = parse(termBody, req.body);
    const year = await prisma.academicYear.findUnique({ where: { id: body.academicYearId } });
    if (!year) throw notFound('Academic year');
    const start = parseDate(body.startDate, 'Start date');
    const end = parseDate(body.endDate, 'End date');
    await assertNoOverlap(start, end);
    if (await prisma.academicTerm.findFirst({ where: { academicYearId: year.id, number: body.number } })) {
      throw conflict(`Term ${body.number} of ${year.year} already exists`);
    }
    const term = await prisma.academicTerm.create({
      data: { academicYearId: year.id, number: body.number, name: body.name ?? `Term ${body.number}`, startDate: start, endDate: end },
      include: { academicYear: true },
    });
    await audit(prisma, currentUser(req), 'term.create', 'AcademicTerm', term.id, { after: term });
    return serializeTerm(term);
  }),
);

router.patch(
  '/terms/:id',
  requirePermission('setup.manage'),
  handle(async (req) => {
    const id = idParam(req);
    const body = parse(z.object({ name: z.string().trim().min(1).max(40).optional(), startDate: z.string().optional(), endDate: z.string().optional() }), req.body);
    const before = await getTerm(prisma, id);
    if (before.status === 'CLOSED') throw badRequest('A closed term cannot be changed');
    const start = body.startDate ? parseDate(body.startDate, 'Start date') : before.startDate;
    const end = body.endDate ? parseDate(body.endDate, 'End date') : before.endDate;
    await assertNoOverlap(start, end, id);
    const after = await prisma.academicTerm.update({
      where: { id },
      data: { name: body.name, startDate: start, endDate: end },
      include: { academicYear: true },
    });
    await audit(prisma, currentUser(req), 'term.update', 'AcademicTerm', id, { before, after });
    return serializeTerm(after);
  }),
);

// ───────── Sections and classes (C-08: a class belongs to one section) ─────────

router.post(
  '/sections',
  requirePermission('setup.manage'),
  handle(async (req) => {
    const body = parse(z.object({ name: z.string().trim().min(1).max(60), sortOrder: z.number().int().optional() }), req.body);
    const section = await prisma.section.create({ data: { name: body.name, code: toCode(body.name), sortOrder: body.sortOrder ?? 0 } });
    await audit(prisma, currentUser(req), 'section.create', 'Section', section.id, { after: section });
    return section;
  }),
);

router.patch(
  '/sections/:id',
  requirePermission('setup.manage'),
  handle(async (req) => {
    const id = idParam(req);
    const body = parse(z.object({ name: z.string().trim().min(1).max(60).optional(), sortOrder: z.number().int().optional(), active: z.boolean().optional() }), req.body);
    const before = await prisma.section.findUnique({ where: { id } });
    if (!before) throw notFound('Section');
    const after = await prisma.section.update({ where: { id }, data: body });
    await audit(prisma, currentUser(req), 'section.update', 'Section', id, { before, after });
    return after;
  }),
);

router.post(
  '/classes',
  requirePermission('setup.manage'),
  handle(async (req) => {
    const body = parse(z.object({ name: z.string().trim().min(1).max(60), sectionId: z.number().int(), sortOrder: z.number().int().optional() }), req.body);
    if (!(await prisma.section.findUnique({ where: { id: body.sectionId } }))) throw notFound('Section');
    const cls = await prisma.schoolClass.create({ data: { name: body.name, sectionId: body.sectionId, sortOrder: body.sortOrder ?? 0 } });
    await audit(prisma, currentUser(req), 'class.create', 'SchoolClass', cls.id, { after: cls });
    return cls;
  }),
);

router.patch(
  '/classes/:id',
  requirePermission('setup.manage'),
  handle(async (req) => {
    const id = idParam(req);
    const body = parse(
      z.object({ name: z.string().trim().min(1).max(60).optional(), sectionId: z.number().int().optional(), sortOrder: z.number().int().optional(), active: z.boolean().optional() }),
      req.body,
    );
    const before = await prisma.schoolClass.findUnique({ where: { id } });
    if (!before) throw notFound('Class');
    if (body.sectionId && body.sectionId !== before.sectionId && (await prisma.pupil.count({ where: { classId: id } })) > 0) {
      throw badRequest('This class has pupils, so it cannot move to another section');
    }
    const after = await prisma.schoolClass.update({ where: { id }, data: body });
    await audit(prisma, currentUser(req), 'class.update', 'SchoolClass', id, { before, after });
    return after;
  }),
);

// ───────── Fee items (FR-402 to FR-404) ─────────

router.post(
  '/fee-items',
  requirePermission('setup.manage'),
  handle(async (req) => {
    const body = parse(
      z.object({ name: z.string().trim().min(1).max(80), defaultMandatory: z.boolean(), frequency: z.enum(['ONCE', 'TERM', 'YEAR']), sortOrder: z.number().int().optional() }),
      req.body,
    );
    if (await prisma.feeItem.findFirst({ where: { name: { equals: body.name, mode: 'insensitive' } } })) throw conflict(`Fee item "${body.name}" already exists`);
    const item = await prisma.feeItem.create({ data: { ...body, code: toCode(body.name), sortOrder: body.sortOrder ?? 50 } });
    await audit(prisma, currentUser(req), 'feeitem.create', 'FeeItem', item.id, { after: item });
    return item;
  }),
);

router.patch(
  '/fee-items/:id',
  requirePermission('setup.manage'),
  handle(async (req) => {
    const id = idParam(req);
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(80).optional(),
        defaultMandatory: z.boolean().optional(),
        frequency: z.enum(['ONCE', 'TERM', 'YEAR']).optional(),
        sortOrder: z.number().int().optional(),
        active: z.boolean().optional(),
      }),
      req.body,
    );
    const before = await prisma.feeItem.findUnique({ where: { id } });
    if (!before) throw notFound('Fee item');
    if (before.isSystem && (body.active === false || body.frequency)) throw badRequest('Arrears B/F is used by carry-forward and cannot be deactivated or changed');
    if (body.name && (await prisma.feeItem.findFirst({ where: { id: { not: id }, name: { equals: body.name, mode: 'insensitive' } } }))) throw conflict(`Fee item "${body.name}" already exists`);
    const after = await prisma.feeItem.update({ where: { id }, data: body });
    await audit(prisma, currentUser(req), 'feeitem.update', 'FeeItem', id, { before, after });
    return after;
  }),
);
