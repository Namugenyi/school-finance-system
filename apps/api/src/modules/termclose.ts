import { Router } from 'express';
import { z } from 'zod';
import type { TermSnapshot } from '@prisma/client';
import { prisma, type Db } from '../db';
import { handle, idParam, parse } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { isoDate } from '../lib/dates';
import { dec, money, ugx } from '../lib/money';
import { currentUser, requirePermission } from '../auth/session';
import { assertDifferentApprover } from '../finance/policies';
import { computeFigures, serializeFigures, type Figures } from '../finance/figures';
import { getTerm, termLabel } from './setup';
import { expensesByCategory, outstandingByClass, revenueByItem } from './reports';
import { monthLabel } from './payroll';

export const router = Router();

/** WR-19: what must be settled before a term can close, plus information worth checking. */
export async function readiness(db: Db, termId: number) {
  const term = await getTerm(db, termId);
  const months: Array<{ year: number; month: number }> = [];
  for (let d = new Date(Date.UTC(term.startDate.getUTCFullYear(), term.startDate.getUTCMonth(), 1)); d <= term.endDate; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    months.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  }
  const [pendingDiscounts, pendingExpenses, pendingReversals, runs, laterTerm, postCloseCharges, postCloseReceipts, postCloseExpenses, pendingSnapshot] = await Promise.all([
    db.chargeDiscount.count({ where: { status: 'PENDING', charge: { termId } } }),
    db.expense.count({ where: { status: 'PENDING', termId } }),
    db.paymentReversal.count({ where: { status: 'PENDING', receipt: { lines: { some: { charge: { termId } } } } } }),
    db.payrollRun.findMany({ where: { OR: months } }),
    db.academicTerm.findFirst({ where: { startDate: { gt: term.startDate } }, orderBy: { startDate: 'asc' }, include: { academicYear: true } }),
    db.charge.findMany({ where: { termId, postClose: true }, select: { chargeNo: true, createdAt: true } }),
    db.receipt.findMany({ where: { postClose: true, lines: { some: { charge: { termId } } } }, select: { receiptNo: true, createdAt: true } }),
    db.expense.findMany({ where: { termId, postClose: true }, select: { expenseNo: true, enteredAt: true } }),
    db.termSnapshot.findFirst({ where: { termId, status: 'PENDING' } }),
  ]);
  const blockers: string[] = [];
  if (pendingDiscounts) blockers.push(`${pendingDiscounts} discount request(s) for this term are waiting for approval.`);
  if (pendingExpenses) blockers.push(`${pendingExpenses} expense(s) for this term are waiting for approval.`);
  if (pendingReversals) blockers.push(`${pendingReversals} payment reversal(s) touching this term are waiting for approval.`);
  if (pendingSnapshot) blockers.push('A term-close snapshot is already waiting for approval.');
  const warnings: string[] = [];
  for (const m of months) {
    const run = runs.find((r) => r.year === m.year && r.month === m.month);
    if (!run) warnings.push(`No payroll run for ${monthLabel(m.year, m.month)} (SOP-4.2).`);
    else if (run.status !== 'POSTED') warnings.push(`Payroll for ${monthLabel(m.year, m.month)} is ${run.status.toLowerCase()}, not posted.`);
  }
  const figures = await computeFigures(db, { termId });
  if (figures.outstanding.gt(0)) {
    warnings.push(
      laterTerm
        ? `${ugx(figures.outstanding)} is still owed. After closing, carry it forward to ${termLabel(laterTerm)} (SOP-4.7).`
        : `${ugx(figures.outstanding)} is still owed. Create the next term so it can be carried forward.`,
    );
  }
  return {
    term: { id: term.id, label: termLabel(term), status: term.status, startDate: isoDate(term.startDate), endDate: isoDate(term.endDate) },
    blockers,
    warnings,
    figures: serializeFigures(figures),
    postCloseExceptions: [
      ...postCloseCharges.map((c) => ({ type: 'Charge', ref: c.chargeNo, at: c.createdAt })),
      ...postCloseReceipts.map((r) => ({ type: 'Receipt', ref: r.receiptNo, at: r.createdAt })),
      ...postCloseExpenses.map((e) => ({ type: 'Expense', ref: e.expenseNo, at: e.enteredAt })),
    ],
  };
}

router.get('/:termId/readiness', requirePermission('termclose.prepare', 'termclose.approve', 'snapshots.view'), handle(async (req) => readiness(prisma, idParam(req, 'termId'))));

function figureColumns(f: Figures) {
  return {
    activePupils: f.activePupils ?? 0,
    totalBilled: f.totalBilled,
    totalDiscounts: f.totalDiscounts,
    arrearsBroughtForward: f.arrearsBroughtForward,
    totalCollected: f.totalCollected,
    carriedForwardOut: f.carriedForwardOut,
    outstanding: f.outstanding,
    schoolFundedExpenses: f.schoolFundedExpenses,
    ownerFundedExpenses: f.ownerFundedExpenses,
    otherFundedExpenses: f.otherFundedExpenses,
    totalExpenses: f.totalExpenses,
    netResult: f.netResult,
    collectionRate: f.collectionRate,
  };
}

/** FR-1501 to FR-1503: prepare a snapshot of the live figures for the Head Teacher to approve. */
router.post(
  '/:termId/prepare',
  requirePermission('termclose.prepare'),
  handle(async (req) => {
    const termId = idParam(req, 'termId');
    const body = parse(z.object({ notes: z.string().trim().max(1000).nullable().optional(), confirm: z.literal(true, { errorMap: () => ({ message: 'Confirm you have checked the figures' }) }) }), req.body);
    const user = currentUser(req);
    const ready = await readiness(prisma, termId);
    if (ready.blockers.length) throw badRequest(ready.blockers.join(' '));
    const snapshot = await prisma.$transaction(async (tx) => {
      const figures = await computeFigures(tx, { termId });
      const latest = await tx.termSnapshot.findFirst({ where: { termId }, orderBy: { version: 'desc' } });
      const latestApproved = await tx.termSnapshot.findFirst({ where: { termId, status: 'APPROVED' }, orderBy: { version: 'desc' } });
      const created = await tx.termSnapshot.create({
        data: {
          termId,
          version: (latest?.version ?? 0) + 1,
          supersedesId: latestApproved?.id ?? null,
          ...figureColumns(figures),
          detail: {
            byClass: await outstandingByClass(tx, { termId }),
            byFeeItem: await revenueByItem(tx, { termId }),
            expensesByCategory: await expensesByCategory(tx, { termId }),
            credits: money(figures.credits),
            collectedOnArrears: money(figures.collectedOnArrears),
            warnings: ready.warnings,
            postCloseExceptions: ready.postCloseExceptions,
          },
          notes: body.notes ?? null,
          recordedById: user.id,
          recordedByName: user.fullName,
        },
      });
      await audit(tx, user, 'termclose.prepare', 'TermSnapshot', created.id, { after: created });
      return created;
    });
    return serializeSnapshot(snapshot);
  }),
);

/**
 * D-05, A-24: approving closes the term. The figures are checked again; if anything changed since
 * the snapshot was prepared, it must be prepared again so the archive matches the records.
 */
router.post(
  '/snapshots/:id/decide',
  requirePermission('termclose.approve'),
  handle(async (req) => {
    const id = idParam(req);
    const body = parse(z.object({ approve: z.boolean(), note: z.string().trim().max(500).nullable().optional() }), req.body);
    const user = currentUser(req);
    const snap = await prisma.termSnapshot.findUnique({ where: { id } });
    if (!snap) throw notFound('Snapshot');
    if (snap.status !== 'PENDING') throw badRequest('This snapshot has already been decided');
    assertDifferentApprover(snap.recordedById, user.id);
    if (!body.approve) {
      if (!body.note) throw badRequest('Give a reason for rejecting');
      await prisma.termSnapshot.update({ where: { id }, data: { status: 'REJECTED', approvedById: user.id, approvedByName: user.fullName, decidedAt: new Date(), decisionNote: body.note } });
      await audit(prisma, user, 'termclose.reject', 'TermSnapshot', id, { reason: body.note });
      return { ok: true };
    }
    await prisma.$transaction(async (tx) => {
      const live = figureColumns(await computeFigures(tx, { termId: snap.termId }));
      const same = (a: unknown, b: unknown) => (a === null || b === null ? a === b : dec(a as string).eq(dec(b as string)));
      const changed = (Object.keys(live) as Array<keyof typeof live>).filter((k) => !same(live[k] ?? null, (snap as TermSnapshot)[k] ?? null));
      if (changed.length) {
        throw badRequest('Transactions for this term changed after the snapshot was prepared. Reject it and prepare a new one.', { changed });
      }
      await tx.termSnapshot.update({ where: { id }, data: { status: 'APPROVED', approvedById: user.id, approvedByName: user.fullName, decidedAt: new Date(), decisionNote: body.note ?? null } });
      await tx.academicTerm.update({ where: { id: snap.termId }, data: { status: 'CLOSED', closedAt: new Date() } });
      await audit(tx, user, 'termclose.approve', 'TermSnapshot', id, { after: { termId: snap.termId, version: snap.version } });
    });
    return { ok: true };
  }),
);

export function serializeSnapshot(s: TermSnapshot & { term?: { name: string; academicYear: { year: number } } }) {
  return {
    id: s.id,
    termId: s.termId,
    termLabel: s.term ? termLabel(s.term) : undefined,
    version: s.version,
    supersedesId: s.supersedesId,
    status: s.status,
    activePupils: s.activePupils,
    totalBilled: money(s.totalBilled),
    totalDiscounts: money(s.totalDiscounts),
    arrearsBroughtForward: money(s.arrearsBroughtForward),
    totalCollected: money(s.totalCollected),
    carriedForwardOut: money(s.carriedForwardOut),
    outstanding: money(s.outstanding),
    schoolFundedExpenses: money(s.schoolFundedExpenses),
    ownerFundedExpenses: money(s.ownerFundedExpenses),
    otherFundedExpenses: money(s.otherFundedExpenses),
    totalExpenses: money(s.totalExpenses),
    netResult: money(s.netResult),
    collectionRate: s.collectionRate === null ? null : s.collectionRate.toFixed(4),
    detail: s.detail,
    notes: s.notes,
    recordedById: s.recordedById,
    recordedByName: s.recordedByName,
    recordedAt: s.recordedAt,
    approvedByName: s.approvedByName,
    decidedAt: s.decidedAt,
    decisionNote: s.decisionNote,
  };
}

router.get(
  '/snapshots',
  requirePermission('snapshots.view', 'termclose.prepare', 'termclose.approve'),
  handle(async (req) => {
    const snaps = await prisma.termSnapshot.findMany({
      where: { termId: req.query.termId ? Number(req.query.termId) : undefined, status: typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined },
      include: { term: { include: { academicYear: true } } },
      orderBy: [{ term: { startDate: 'desc' } }, { version: 'desc' }],
    });
    return snaps.map(serializeSnapshot);
  }),
);

router.get(
  '/snapshots/:id',
  requirePermission('snapshots.view', 'termclose.prepare', 'termclose.approve'),
  handle(async (req) => {
    const s = await prisma.termSnapshot.findUnique({ where: { id: idParam(req) }, include: { term: { include: { academicYear: true } } } });
    if (!s) throw notFound('Snapshot');
    return serializeSnapshot(s);
  }),
);
