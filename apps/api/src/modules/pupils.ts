import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma, type Db } from '../db';
import { handle, idParam, pagination, parse } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { isoDate, parseDate, todayKampala } from '../lib/dates';
import { nextPupilCode } from '../lib/ids';
import { money } from '../lib/money';
import { currentUser, hasPermission, requirePermission } from '../auth/session';
import { assertRefCode, getSettings, otherText } from './setup';

export const router = Router();

const LEAVING_STATUSES = ['ALUMNI'];

/** A-12: Ugandan phone numbers, +256 or 0 followed by 9 digits. Spaces and dashes are ignored. */
const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => v === '' || /^(\+256|0)\d{9}$/.test(v), 'Phone must be +256 or 0 followed by 9 digits')
  .transform((v) => v || null)
  .nullable()
  .optional();

const optionalText = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable().optional();

const pupilFields = {
  fullName: z.string().trim().min(2, 'Full name is required').max(120),
  sex: z.string().min(1, 'Sex is required'),
  dateOfBirth: z.string().nullable().optional(),
  guardianName: optionalText(120),
  guardianRelationship: optionalText(40),
  guardianRelationshipOther: optionalText(200),
  phonePrimary: phone,
  phoneAlt: phone,
  address: optionalText(300),
  emergencyName: optionalText(120),
  emergencyRelationship: optionalText(40),
  emergencyRelationshipOther: optionalText(200),
  emergencyPhone: phone,
  notes: optionalText(1000),
};

/**
 * The parent or guardian's name, relationship, primary telephone and address are required (alternative phone is not),
 * and so are the emergency contact's name, relationship and telephone.
 */
const GUARDIAN_REQUIRED = [
  ['guardianName', 'Parent / guardian name'],
  ['guardianRelationship', "Guardian's relationship to pupil"],
  ['phonePrimary', 'Primary telephone'],
  ['address', 'Physical address'],
  ['emergencyName', 'Emergency contact name'],
  ['emergencyRelationship', "Emergency contact's relationship to pupil"],
  ['emergencyPhone', 'Emergency contact telephone'],
] as const;

/**
 * On registration every required guardian field must be filled. On an edit, only the fields sent are checked,
 * so a required field can't be blanked; older records missing them are completed the next time they're edited in full.
 */
function assertGuardianDetails(body: Partial<Record<(typeof GUARDIAN_REQUIRED)[number][0], string | null | undefined>>, creating: boolean) {
  const missing = GUARDIAN_REQUIRED.filter(([k]) => (creating || k in body) && !body[k]?.toString().trim()).map(([, label]) => label);
  if (missing.length) throw badRequest(`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required`);
}

/** Relationship codes must come from the RELATIONSHIP reference list (BR-24). */
async function assertRelationships(db: Db, body: { guardianRelationship?: string | null; emergencyRelationship?: string | null }) {
  if (body.guardianRelationship) await assertRefCode(db, 'RELATIONSHIP', body.guardianRelationship, 'Relationship of the parent / guardian');
  if (body.emergencyRelationship) await assertRefCode(db, 'RELATIONSHIP', body.emergencyRelationship, 'Relationship of the emergency contact');
}

/** Term whose dates contain the given day, if any. */
export async function termForDate(db: Db, date: Date) {
  return db.academicTerm.findFirst({ where: { startDate: { lte: date }, endDate: { gte: date } } });
}

function serializePupil(p: Prisma.PupilGetPayload<{ include: { schoolClass: { include: { section: true } } } }>, showContacts: boolean) {
  return {
    id: p.id,
    pupilCode: p.pupilCode,
    fullName: p.fullName,
    sex: p.sex,
    dateOfBirth: isoDate(p.dateOfBirth),
    dateJoined: isoDate(p.dateJoined),
    classId: p.classId,
    className: p.schoolClass.name,
    sectionId: p.schoolClass.sectionId,
    sectionName: p.schoolClass.section.name,
    status: p.status,
    dateLeft: isoDate(p.dateLeft),
    leavingReason: p.leavingReason,
    leavingReasonOther: p.leavingReasonOther,
    notes: p.notes,
    ...(showContacts
      ? {
          guardianName: p.guardianName, guardianRelationship: p.guardianRelationship, guardianRelationshipOther: p.guardianRelationshipOther, phonePrimary: p.phonePrimary, phoneAlt: p.phoneAlt, address: p.address,
          emergencyName: p.emergencyName, emergencyRelationship: p.emergencyRelationship, emergencyRelationshipOther: p.emergencyRelationshipOther, emergencyPhone: p.emergencyPhone,
        }
      : { guardianName: p.guardianName, guardianRelationship: p.guardianRelationship, guardianRelationshipOther: p.guardianRelationshipOther, contactsHidden: true }),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

const pupilInclude = { schoolClass: { include: { section: true } } } as const;

router.get(
  '/',
  requirePermission('pupils.view'),
  handle(async (req) => {
    const { skip, take, page, pageSize } = pagination(req.query);
    const q = req.query;
    const search = typeof q.search === 'string' ? q.search.trim() : '';
    const where: Prisma.PupilWhereInput = {
      status: typeof q.status === 'string' && q.status ? q.status : undefined,
      classId: q.classId ? Number(q.classId) : undefined,
      schoolClass: q.sectionId ? { sectionId: Number(q.sectionId) } : undefined,
      OR: search
        ? [
            { fullName: { contains: search, mode: 'insensitive' } },
            { pupilCode: { contains: search, mode: 'insensitive' } },
            { guardianName: { contains: search, mode: 'insensitive' } },
            { phonePrimary: { contains: search } },
          ]
        : undefined,
    };
    const [items, total] = await Promise.all([
      prisma.pupil.findMany({ where, include: pupilInclude, orderBy: [{ fullName: 'asc' }], skip, take }),
      prisma.pupil.count({ where }),
    ]);
    const showContacts = hasPermission(req.user, 'pupils.contacts');
    return { items: items.map((p) => serializePupil(p, showContacts)), total, page, pageSize };
  }),
);

router.get(
  '/:id',
  requirePermission('pupils.view'),
  handle(async (req) => {
    const id = idParam(req);
    const pupil = await prisma.pupil.findUnique({ where: { id }, include: pupilInclude });
    if (!pupil) throw notFound('Pupil');
    const [history, balances] = await Promise.all([
      prisma.pupilHistory.findMany({
        where: { pupilId: id },
        include: { schoolClass: { include: { section: true } }, term: { include: { academicYear: true } } },
        orderBy: [{ effectiveDate: 'desc' }, { id: 'desc' }],
      }),
      prisma.chargeBalance.aggregate({ where: { pupilId: id, voided: false }, _sum: { netDue: true, totalPaid: true, balance: true } }),
    ]);
    return {
      ...serializePupil(pupil, hasPermission(req.user, 'pupils.contacts')),
      totals: { netDue: money(balances._sum.netDue), totalPaid: money(balances._sum.totalPaid), balance: money(balances._sum.balance) },
      history: history.map((h) => ({
        id: h.id,
        eventType: h.eventType,
        effectiveDate: isoDate(h.effectiveDate),
        termLabel: h.term ? `${h.term.name} ${h.term.academicYear.year}` : null,
        classId: h.classId,
        className: h.schoolClass.name,
        sectionName: h.schoolClass.section.name,
        status: h.status,
        leavingReason: h.leavingReason,
        leavingReasonOther: h.leavingReasonOther,
        note: h.note,
        createdAt: h.createdAt,
        correctedAt: h.correctedAt,
      })),
    };
  }),
);

router.post(
  '/',
  requirePermission('pupils.manage'),
  handle(async (req) => {
    const body = parse(z.object({ ...pupilFields, classId: z.number().int(), dateJoined: z.string() }), req.body);
    const user = currentUser(req);
    await assertRefCode(prisma, 'SEX', body.sex, 'Sex');
    assertGuardianDetails(body, true);
    await assertRelationships(prisma, body);
    const cls = await prisma.schoolClass.findUnique({ where: { id: body.classId } });
    if (!cls || !cls.active) throw badRequest('Choose an active class');
    const dateJoined = parseDate(body.dateJoined, 'Date joined');
    const dateOfBirth = body.dateOfBirth ? parseDate(body.dateOfBirth, 'Date of birth') : null;
    if (dateOfBirth && dateOfBirth >= dateJoined) throw badRequest('Date of birth must be before the date joined');
    if (dateJoined > todayKampala()) throw badRequest('Date joined cannot be in the future');

    const pupil = await prisma.$transaction(async (tx) => {
      const settings = await getSettings(tx);
      // FR-202, FR-203: the ID comes from the start-year parameter and a sequence, never from a date.
      const pupilCode = await nextPupilCode(tx, settings.pupilIdStartYear);
      const created = await tx.pupil.create({
        data: {
          pupilCode,
          fullName: body.fullName,
          sex: body.sex,
          dateOfBirth,
          dateJoined,
          classId: cls.id,
          status: 'ACTIVE',
          guardianName: body.guardianName ?? null,
          guardianRelationship: body.guardianRelationship ?? null,
          guardianRelationshipOther: otherText(body.guardianRelationship, body.guardianRelationshipOther, "Guardian's relationship"),
          phonePrimary: body.phonePrimary ?? null,
          phoneAlt: body.phoneAlt ?? null,
          address: body.address ?? null,
          emergencyName: body.emergencyName ?? null,
          emergencyRelationship: body.emergencyRelationship ?? null,
          emergencyRelationshipOther: otherText(body.emergencyRelationship, body.emergencyRelationshipOther, "Emergency contact's relationship"),
          emergencyPhone: body.emergencyPhone ?? null,
          notes: body.notes ?? null,
          createdById: user.id,
          updatedById: user.id,
        },
        include: pupilInclude,
      });
      // A-05: history is written automatically.
      const term = await termForDate(tx, dateJoined);
      await tx.pupilHistory.create({
        data: { pupilId: created.id, eventType: 'ENROLLED', effectiveDate: dateJoined, termId: term?.id ?? null, classId: cls.id, status: 'ACTIVE', createdById: user.id },
      });
      await audit(tx, user, 'pupil.create', 'Pupil', created.id, { after: created });
      return created;
    });
    return serializePupil(pupil, true);
  }),
);

router.patch(
  '/:id',
  requirePermission('pupils.manage'),
  handle(async (req) => {
    const id = idParam(req);
    if ('pupilCode' in (req.body ?? {})) throw badRequest('A pupil ID can never be changed');
    if ('status' in (req.body ?? {}) || 'classId' in (req.body ?? {})) {
      throw badRequest('Use "Change status" or "Change class" so the change is recorded in the pupil history');
    }
    const body = parse(z.object({ ...pupilFields, dateJoined: z.string().optional() }).partial(), req.body);
    const user = currentUser(req);
    const before = await prisma.pupil.findUnique({ where: { id } });
    if (!before) throw notFound('Pupil');
    if (body.sex) await assertRefCode(prisma, 'SEX', body.sex, 'Sex');
    assertGuardianDetails(body, false);
    await assertRelationships(prisma, body);
    const dateJoined = body.dateJoined ? parseDate(body.dateJoined, 'Date joined') : undefined;
    const dateOfBirth = body.dateOfBirth === undefined ? undefined : body.dateOfBirth ? parseDate(body.dateOfBirth, 'Date of birth') : null;
    // "Other" details follow the relationship they explain: kept, required or cleared.
    const others: Prisma.PupilUpdateInput = {};
    if (body.guardianRelationship !== undefined || body.guardianRelationshipOther !== undefined) {
      others.guardianRelationshipOther = otherText(
        body.guardianRelationship !== undefined ? body.guardianRelationship : before.guardianRelationship,
        body.guardianRelationshipOther !== undefined ? body.guardianRelationshipOther : before.guardianRelationshipOther, "Guardian's relationship");
    }
    if (body.emergencyRelationship !== undefined || body.emergencyRelationshipOther !== undefined) {
      others.emergencyRelationshipOther = otherText(
        body.emergencyRelationship !== undefined ? body.emergencyRelationship : before.emergencyRelationship,
        body.emergencyRelationshipOther !== undefined ? body.emergencyRelationshipOther : before.emergencyRelationshipOther, "Emergency contact's relationship");
    }
    const after = await prisma.pupil.update({
      where: { id },
      data: { ...body, ...others, dateJoined, dateOfBirth, updatedById: user.id },
      include: pupilInclude,
    });
    await audit(prisma, user, 'pupil.update', 'Pupil', id, { before, after });
    return serializePupil(after, true);
  }),
);

router.post(
  '/:id/status',
  requirePermission('pupils.manage'),
  handle(async (req) => {
    const id = idParam(req);
    const body = parse(
      z.object({
        status: z.string(),
        effectiveDate: z.string(),
        leavingReason: z.string().nullable().optional(),
        leavingReasonOther: optionalText(200),
        note: optionalText(500),
        confirm: z.literal(true, { errorMap: () => ({ message: 'Confirm the status change' }) }),
      }),
      req.body,
    );
    const user = currentUser(req);
    await assertRefCode(prisma, 'PUPIL_STATUS', body.status, 'Status');
    const pupil = await prisma.pupil.findUnique({ where: { id } });
    if (!pupil) throw notFound('Pupil');
    if (pupil.status === body.status) throw badRequest('The pupil already has this status');
    const effectiveDate = parseDate(body.effectiveDate, 'Effective date');
    if (effectiveDate < pupil.dateJoined) throw badRequest('The effective date cannot be before the pupil joined');
    const leaving = LEAVING_STATUSES.includes(body.status);
    if (leaving && !body.leavingReason) throw badRequest('Give a reason for leaving');
    if (leaving && body.leavingReason) await assertRefCode(prisma, 'LEAVING_REASON', body.leavingReason, 'Reason for leaving');
    const leavingReasonOther = leaving ? otherText(body.leavingReason, body.leavingReasonOther, 'Reason for leaving') : null;

    return prisma.$transaction(async (tx) => {
      const term = await termForDate(tx, effectiveDate);
      const after = await tx.pupil.update({
        where: { id },
        data: {
          status: body.status,
          dateLeft: leaving ? effectiveDate : null,
          leavingReason: leaving ? body.leavingReason : null,
          leavingReasonOther,
          updatedById: user.id,
        },
      });
      await tx.pupilHistory.create({
        data: {
          pupilId: id, eventType: 'STATUS_CHANGE', effectiveDate, termId: term?.id ?? null, classId: pupil.classId,
          status: body.status, leavingReason: leaving ? body.leavingReason : null, leavingReasonOther, note: body.note ?? null, createdById: user.id,
        },
      });
      await audit(tx, user, 'pupil.status', 'Pupil', id, { before: { status: pupil.status }, after: { status: after.status, effectiveDate: body.effectiveDate }, reason: body.note });
      return { ok: true };
    });
  }),
);

async function changeClass(tx: Db, userId: number, pupilId: number, classId: number, effectiveDate: Date, eventType: string, note: string | null) {
  const pupil = await tx.pupil.findUnique({ where: { id: pupilId } });
  if (!pupil) throw notFound('Pupil');
  if (pupil.classId === classId) throw badRequest(`${pupil.fullName} is already in this class`);
  if (effectiveDate < pupil.dateJoined) throw badRequest('The effective date cannot be before the pupil joined');
  const term = await termForDate(tx, effectiveDate);
  await tx.pupil.update({ where: { id: pupilId }, data: { classId, updatedById: userId } });
  // FR-303: a new history row; earlier placements are never overwritten.
  await tx.pupilHistory.create({
    data: { pupilId, eventType, effectiveDate, termId: term?.id ?? null, classId, status: pupil.status, note, createdById: userId },
  });
  return pupil;
}

router.post(
  '/:id/class',
  requirePermission('pupils.manage'),
  handle(async (req) => {
    const id = idParam(req);
    const body = parse(
      z.object({ classId: z.number().int(), effectiveDate: z.string(), eventType: z.enum(['PROMOTED', 'CLASS_CHANGE']), note: optionalText(500) }),
      req.body,
    );
    const user = currentUser(req);
    const cls = await prisma.schoolClass.findUnique({ where: { id: body.classId } });
    if (!cls || !cls.active) throw badRequest('Choose an active class');
    const effectiveDate = parseDate(body.effectiveDate, 'Effective date');
    await prisma.$transaction(async (tx) => {
      const before = await changeClass(tx, user.id, id, cls.id, effectiveDate, body.eventType, body.note ?? null);
      await audit(tx, user, 'pupil.class', 'Pupil', id, { before: { classId: before.classId }, after: { classId: cls.id, eventType: body.eventType } });
    });
    return { ok: true };
  }),
);

/** Promote a whole class at term opening (SOP-1.2, SOP-1.3). */
router.post(
  '/promote',
  requirePermission('pupils.manage'),
  handle(async (req) => {
    const body = parse(
      z.object({ fromClassId: z.number().int(), toClassId: z.number().int(), effectiveDate: z.string(), pupilIds: z.array(z.number().int()).min(1) }),
      req.body,
    );
    const user = currentUser(req);
    if (body.fromClassId === body.toClassId) throw badRequest('Choose a different class to promote to');
    const to = await prisma.schoolClass.findUnique({ where: { id: body.toClassId } });
    if (!to || !to.active) throw badRequest('Choose an active class to promote to');
    const effectiveDate = parseDate(body.effectiveDate, 'Effective date');
    const pupils = await prisma.pupil.findMany({ where: { id: { in: body.pupilIds }, classId: body.fromClassId, status: 'ACTIVE' } });
    if (pupils.length !== body.pupilIds.length) throw badRequest('Some selected pupils are not active pupils of the class being promoted');
    await prisma.$transaction(async (tx) => {
      for (const p of pupils) await changeClass(tx, user.id, p.id, to.id, effectiveDate, 'PROMOTED', null);
      await audit(tx, user, 'pupil.promote_bulk', 'SchoolClass', body.fromClassId, { after: { toClassId: to.id, pupilIds: body.pupilIds } });
    });
    return { promoted: pupils.length };
  }),
);

/** WR-29: correcting a history entry needs a reason and is audited with before and after. */
router.patch(
  '/:id/history/:historyId',
  requirePermission('pupils.manage'),
  handle(async (req) => {
    const id = idParam(req);
    const historyId = idParam(req, 'historyId');
    const body = parse(
      z.object({ effectiveDate: z.string().optional(), note: optionalText(500), leavingReason: z.string().nullable().optional(), leavingReasonOther: optionalText(200), reason: z.string().trim().min(5, 'Explain why this history entry is being corrected') }),
      req.body,
    );
    const user = currentUser(req);
    const before = await prisma.pupilHistory.findFirst({ where: { id: historyId, pupilId: id } });
    if (!before) throw notFound('History entry');
    const effectiveDate = body.effectiveDate ? parseDate(body.effectiveDate, 'Effective date') : before.effectiveDate;
    if (body.leavingReason) await assertRefCode(prisma, 'LEAVING_REASON', body.leavingReason, 'Reason for leaving');
    const after = await prisma.$transaction(async (tx) => {
      const term = await termForDate(tx, effectiveDate);
      const updated = await tx.pupilHistory.update({
        where: { id: historyId },
        data: {
          effectiveDate,
          termId: term?.id ?? null,
          note: body.note === undefined ? before.note : body.note,
          leavingReason: body.leavingReason === undefined ? before.leavingReason : body.leavingReason,
          leavingReasonOther: body.leavingReason === undefined && body.leavingReasonOther === undefined
            ? before.leavingReasonOther
            : otherText(body.leavingReason === undefined ? before.leavingReason : body.leavingReason,
              body.leavingReasonOther === undefined ? before.leavingReasonOther : body.leavingReasonOther, 'Reason for leaving'),
          correctedAt: new Date(),
          correctedById: user.id,
        },
      });
      await audit(tx, user, 'pupil.history_correct', 'PupilHistory', historyId, { before, after: updated, reason: body.reason });
      return updated;
    });
    return after;
  }),
);

/**
 * A-17: pupils who were Active at some point in a term, read from their history so a past
 * term's count does not drift when statuses change later.
 */
export async function activePupilCountForTerm(db: Db, term: { startDate: Date; endDate: Date }): Promise<number> {
  const rows = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS "count" FROM "Pupil" p
    WHERE p."dateJoined" <= ${term.endDate}
      AND (
        COALESCE((
          SELECT h."status" FROM "PupilHistory" h
          WHERE h."pupilId" = p."id" AND h."effectiveDate" <= ${term.startDate}
          ORDER BY h."effectiveDate" DESC, h."id" DESC LIMIT 1
        ), '') = 'ACTIVE'
        OR EXISTS (
          SELECT 1 FROM "PupilHistory" h
          WHERE h."pupilId" = p."id" AND h."status" = 'ACTIVE'
            AND h."effectiveDate" BETWEEN ${term.startDate} AND ${term.endDate}
        )
      )`;
  return Number(rows[0].count);
}
