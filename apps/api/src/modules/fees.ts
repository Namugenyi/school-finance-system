import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { handle, parse } from '../lib/http';
import { badRequest, conflict } from '../lib/errors';
import { audit } from '../lib/audit';
import { dec, money } from '../lib/money';
import { currentUser, requirePermission } from '../auth/session';
import { getTerm } from './setup';

export const router = Router();

const amount = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const s = String(v).replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount must be a positive number with at most 2 decimals' });
    return z.NEVER;
  }
  return s;
});
export const moneyInput = amount;

/** FR-401: fee lines for one term and class (the section comes from the class, C-08). */
router.get(
  '/',
  requirePermission('fees.view'),
  handle(async (req) => {
    const termId = Number(req.query.termId);
    if (!termId) throw badRequest('Choose a term');
    const classId = req.query.classId ? Number(req.query.classId) : undefined;
    const lines = await prisma.feeStructure.findMany({
      where: { termId, classId },
      include: { feeItem: true, schoolClass: { include: { section: true } } },
      orderBy: [{ schoolClass: { sortOrder: 'asc' } }, { feeItem: { sortOrder: 'asc' } }],
    });
    return lines.map((l) => ({
      id: l.id,
      termId: l.termId,
      classId: l.classId,
      className: l.schoolClass.name,
      sectionName: l.schoolClass.section.name,
      feeItemId: l.feeItemId,
      feeItemName: l.feeItem.name,
      frequency: l.feeItem.frequency,
      mandatory: l.mandatory,
      amount: money(l.amount),
    }));
  }),
);

/** Replace the fee lines for one term and class. Duplicate combinations are impossible (unique key). */
router.put(
  '/',
  requirePermission('fees.manage'),
  handle(async (req) => {
    const body = parse(
      z.object({
        termId: z.number().int(),
        classId: z.number().int(),
        lines: z.array(z.object({ feeItemId: z.number().int(), amount, mandatory: z.boolean() })),
      }),
      req.body,
    );
    const user = currentUser(req);
    const term = await getTerm(prisma, body.termId);
    if (term.status === 'CLOSED') throw badRequest('This term is closed, so its fee structure cannot change');
    const ids = body.lines.map((l) => l.feeItemId);
    if (new Set(ids).size !== ids.length) throw conflict('Each fee item can appear only once for a class and term');
    const items = await prisma.feeItem.findMany({ where: { id: { in: ids } } });
    if (items.length !== ids.length) throw badRequest('Unknown fee item');
    if (items.some((i) => i.isSystem)) throw badRequest('Arrears B/F is raised by carry-forward, not by the fee structure');
    if (items.some((i) => !i.active)) throw badRequest('One of the fee items is no longer active');
    const before = await prisma.feeStructure.findMany({ where: { termId: body.termId, classId: body.classId } });
    await prisma.$transaction(async (tx) => {
      await tx.feeStructure.deleteMany({ where: { termId: body.termId, classId: body.classId, feeItemId: { notIn: ids } } });
      for (const l of body.lines) {
        await tx.feeStructure.upsert({
          where: { termId_classId_feeItemId: { termId: body.termId, classId: body.classId, feeItemId: l.feeItemId } },
          create: { termId: body.termId, classId: body.classId, feeItemId: l.feeItemId, amount: dec(l.amount), mandatory: l.mandatory, createdById: user.id, updatedById: user.id },
          update: { amount: dec(l.amount), mandatory: l.mandatory, updatedById: user.id },
        });
      }
      await audit(tx, user, 'fees.update', 'FeeStructure', `${body.termId}:${body.classId}`, { before, after: body.lines });
    });
    return { ok: true, lines: body.lines.length };
  }),
);

/** A-23: copy last term's fees as a starting point. Existing lines in the target are left alone. */
router.post(
  '/copy',
  requirePermission('fees.manage'),
  handle(async (req) => {
    const body = parse(z.object({ fromTermId: z.number().int(), toTermId: z.number().int() }), req.body);
    const user = currentUser(req);
    if (body.fromTermId === body.toTermId) throw badRequest('Choose two different terms');
    const target = await getTerm(prisma, body.toTermId);
    if (target.status === 'CLOSED') throw badRequest('The target term is closed');
    const source = await prisma.feeStructure.findMany({ where: { termId: body.fromTermId }, include: { feeItem: true } });
    if (source.length === 0) throw badRequest('The source term has no fee structure to copy');
    const existing = await prisma.feeStructure.findMany({ where: { termId: body.toTermId } });
    const have = new Set(existing.map((e) => `${e.classId}:${e.feeItemId}`));
    const toCreate = source.filter((s) => s.feeItem.active && !have.has(`${s.classId}:${s.feeItemId}`));
    await prisma.feeStructure.createMany({
      data: toCreate.map((s) => ({ termId: body.toTermId, classId: s.classId, feeItemId: s.feeItemId, amount: s.amount, mandatory: s.mandatory, createdById: user.id, updatedById: user.id })),
    });
    await audit(prisma, user, 'fees.copy', 'AcademicTerm', body.toTermId, { after: { fromTermId: body.fromTermId, copied: toCreate.length } });
    return { copied: toCreate.length, skipped: source.length - toCreate.length };
  }),
);
