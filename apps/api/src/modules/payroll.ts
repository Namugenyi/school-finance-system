import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma, type Db } from '../db';
import { handle, idParam, parse } from '../lib/http';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { isoDate, parseDate } from '../lib/dates';
import { nextExpenseNo, nextStaffCode } from '../lib/ids';
import { dec, money, sum } from '../lib/money';
import { currentUser, requirePermission } from '../auth/session';
import { assertDifferentApprover, assertWithinApprovalLimit, payrollExpenseAmount, postingTermForMonth } from '../finance/policies';
import { checkTermOpen } from '../finance/periods';
import { computePayLine } from '../finance/payroll';
import { assertRefCode, getSettings, termLabel } from './setup';
import { moneyInput } from './fees';

export const router = Router();

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (year: number, month: number) => `${MONTHS[month - 1]} ${year}`;

// ───────── Staff register (FR-901, FR-902) ─────────

const staffBody = z.object({
  fullName: z.string().trim().min(2).max(120),
  jobRole: z.string().trim().min(2).max(80),
  department: z.string().trim().max(80).transform((v) => v || null).nullable().optional(),
  employmentType: z.string(),
  basicSalary: moneyInput,
  startDate: z.string(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  phone: z.string().trim().max(30).transform((v) => v || null).nullable().optional(),
  nssfNo: z.string().trim().max(40).transform((v) => v || null).nullable().optional(),
  tin: z.string().trim().max(40).transform((v) => v || null).nullable().optional(),
});

const serializeStaff = (s: Awaited<ReturnType<typeof prisma.staff.findFirstOrThrow>>) => ({
  ...s, basicSalary: money(s.basicSalary), startDate: isoDate(s.startDate),
});

// ───────── Cumulative pay per staff member ─────────
// Only approved (POSTED) runs count: a draft or rejected run has paid nobody.

type PayEntry = { basic: Prisma.Decimal; nssfEmployee: Prisma.Decimal; nssfEmployer: Prisma.Decimal; paye: Prisma.Decimal; otherDeductions: Prisma.Decimal; net: Prisma.Decimal };

/** Totals of a set of payroll entries: gross (basic), each deduction, net, and employer NSSF. */
export function payTotals(entries: PayEntry[]) {
  return {
    months: entries.length,
    basic: money(sum(entries.map((e) => e.basic))),
    nssfEmployee: money(sum(entries.map((e) => e.nssfEmployee))),
    paye: money(sum(entries.map((e) => e.paye))),
    otherDeductions: money(sum(entries.map((e) => e.otherDeductions))),
    net: money(sum(entries.map((e) => e.net))),
    nssfEmployer: money(sum(entries.map((e) => e.nssfEmployer))),
  };
}

const postedEntries = (where: Prisma.PayrollEntryWhereInput = {}) =>
  prisma.payrollEntry.findMany({ where: { ...where, run: { status: 'POSTED', ...(where.run as object) } }, include: { run: { select: { year: true, month: true, id: true } } } });

router.get(
  '/staff',
  requirePermission('payroll.view'),
  handle(async () => {
    const year = new Date().getFullYear();
    const [staff, entries] = await Promise.all([prisma.staff.findMany({ orderBy: { staffCode: 'asc' } }), postedEntries()]);
    return staff.map((s) => {
      const mine = entries.filter((e) => e.staffId === s.id);
      return { ...serializeStaff(s), payThisYear: payTotals(mine.filter((e) => e.run.year === year)), payToDate: payTotals(mine) };
    });
  }),
);

/** A staff member's pay month by month, with totals for the chosen year and since they started. */
router.get(
  '/staff/:id/earnings',
  requirePermission('payroll.view'),
  handle(async (req) => {
    const id = idParam(req);
    const staff = await prisma.staff.findUnique({ where: { id } });
    if (!staff) throw notFound('Staff member');
    const entries = (await postedEntries({ staffId: id })).sort((a, b) => a.run.year - b.run.year || a.run.month - b.run.month);
    const years = [...new Set(entries.map((e) => e.run.year))].sort((a, b) => b - a);
    const asked = Number(req.query.year);
    const year = Number.isInteger(asked) && asked > 1900 ? asked : years[0] ?? new Date().getFullYear();
    let running = new Prisma.Decimal(0);
    const months = entries.filter((e) => e.run.year === year).map((e) => {
      running = running.plus(e.net);
      return {
        runId: e.run.id, month: e.run.month, label: monthLabel(e.run.year, e.run.month),
        basic: money(e.basic), nssfEmployee: money(e.nssfEmployee), paye: money(e.paye), otherDeductions: money(e.otherDeductions), net: money(e.net), nssfEmployer: money(e.nssfEmployer),
        netYearToDate: money(running),
      };
    });
    return {
      staff: serializeStaff(staff), year, years,
      months, yearTotals: payTotals(entries.filter((e) => e.run.year === year)), toDate: payTotals(entries),
    };
  }),
);

router.post(
  '/staff',
  requirePermission('payroll.manage'),
  handle(async (req) => {
    const body = parse(staffBody, req.body);
    const user = currentUser(req);
    await assertRefCode(prisma, 'EMPLOYMENT_TYPE', body.employmentType, 'Employment type');
    const staff = await prisma.$transaction(async (tx) => {
      const s = await tx.staff.create({
        data: { ...body, staffCode: await nextStaffCode(tx), basicSalary: dec(body.basicSalary), startDate: parseDate(body.startDate, 'Start date'), status: body.status ?? 'ACTIVE' },
      });
      await audit(tx, user, 'staff.create', 'Staff', s.id, { after: s });
      return s;
    });
    return serializeStaff(staff);
  }),
);

router.patch(
  '/staff/:id',
  requirePermission('payroll.manage'),
  handle(async (req) => {
    const id = idParam(req);
    const body = parse(staffBody.partial(), req.body);
    const user = currentUser(req);
    const before = await prisma.staff.findUnique({ where: { id } });
    if (!before) throw notFound('Staff member');
    if (body.employmentType) await assertRefCode(prisma, 'EMPLOYMENT_TYPE', body.employmentType, 'Employment type');
    const after = await prisma.staff.update({
      where: { id },
      data: { ...body, basicSalary: body.basicSalary ? dec(body.basicSalary) : undefined, startDate: body.startDate ? parseDate(body.startDate, 'Start date') : undefined },
    });
    await audit(prisma, user, 'staff.update', 'Staff', id, { before, after });
    return serializeStaff(after);
  }),
);

// ───────── Statutory rates (FR-905, WR-17) ─────────

router.get(
  '/rates',
  requirePermission('payroll.view'),
  handle(async () => {
    const sets = await prisma.statutoryRateSet.findMany({ include: { bands: { orderBy: { lowerBound: 'asc' } } }, orderBy: { effectiveFrom: 'desc' } });
    return sets.map((s) => ({
      id: s.id, effectiveFrom: isoDate(s.effectiveFrom), nssfEmployeeRate: s.nssfEmployeeRate.toString(), nssfEmployerRate: s.nssfEmployerRate.toString(),
      notes: s.notes, validated: s.validated, validatedBy: s.validatedBy,
      bands: s.bands.map((b) => ({ lowerBound: money(b.lowerBound), upperBound: b.upperBound === null ? null : money(b.upperBound), rate: b.rate.toString() })),
    }));
  }),
);

const rate = z.union([z.string(), z.number()]).transform((v) => String(v)).refine((v) => /^(0(\.\d{1,4})?|1(\.0{1,4})?)$/.test(v), 'Rate must be between 0 and 1, e.g. 0.05');

router.post(
  '/rates',
  requirePermission('payroll.rates'),
  handle(async (req) => {
    const body = parse(
      z.object({
        effectiveFrom: z.string(),
        nssfEmployeeRate: rate,
        nssfEmployerRate: rate,
        notes: z.string().trim().max(500).nullable().optional(),
        bands: z.array(z.object({ lowerBound: moneyInput, upperBound: moneyInput.nullable(), rate })).min(1),
      }),
      req.body,
    );
    const user = currentUser(req);
    const bands = [...body.bands].sort((a, b) => dec(a.lowerBound).comparedTo(dec(b.lowerBound)));
    bands.forEach((b, i) => {
      if (b.upperBound !== null && dec(b.upperBound).lte(dec(b.lowerBound))) throw badRequest('Each band must end above where it starts');
      if (i > 0 && !dec(bands[i - 1].upperBound ?? -1).eq(dec(b.lowerBound))) throw badRequest('Bands must follow on from each other without gaps or overlaps');
      if (i < bands.length - 1 && b.upperBound === null) throw badRequest('Only the top band can be open-ended');
    });
    if (!dec(bands[0].lowerBound).eq(0)) throw badRequest('The first band must start at 0');
    const set = await prisma.statutoryRateSet.create({
      data: {
        effectiveFrom: parseDate(body.effectiveFrom, 'Effective from'),
        nssfEmployeeRate: dec(body.nssfEmployeeRate),
        nssfEmployerRate: dec(body.nssfEmployerRate),
        notes: body.notes ?? null,
        bands: { create: bands.map((b) => ({ lowerBound: dec(b.lowerBound), upperBound: b.upperBound === null ? null : dec(b.upperBound), rate: dec(b.rate) })) },
      },
    });
    await audit(prisma, user, 'payroll.rates_create', 'StatutoryRateSet', set.id, { after: body });
    return { id: set.id };
  }),
);

router.post(
  '/rates/:id/validate',
  requirePermission('payroll.rates'),
  handle(async (req) => {
    const id = idParam(req);
    const body = parse(z.object({ validatedBy: z.string().trim().min(3, 'Name the person or source that checked these rates').max(200) }), req.body);
    const user = currentUser(req);
    await prisma.statutoryRateSet.update({ where: { id }, data: { validated: true, validatedBy: body.validatedBy } });
    await audit(prisma, user, 'payroll.rates_validate', 'StatutoryRateSet', id, { reason: body.validatedBy });
    return { ok: true };
  }),
);

// ───────── Payroll runs (FR-907, FR-908, WR-16, D-07) ─────────

async function rateSetFor(db: Db, year: number, month: number) {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const set = await db.statutoryRateSet.findFirst({ where: { effectiveFrom: { lte: firstOfMonth } }, include: { bands: true }, orderBy: { effectiveFrom: 'desc' } });
  if (!set) throw badRequest(`No PAYE and NSSF rates are in effect for ${monthLabel(year, month)}. Add them under Payroll > Rates.`);
  return set;
}

async function buildEntries(db: Db, runId: number, year: number, month: number, keepOther = new Map<number, { amount: string; note: string | null }>()) {
  const set = await rateSetFor(db, year, month);
  const endOfMonth = new Date(Date.UTC(year, month, 0));
  const staff = await db.staff.findMany({ where: { status: 'ACTIVE', startDate: { lte: endOfMonth } }, orderBy: { staffCode: 'asc' } });
  if (staff.length === 0) throw badRequest('There are no active staff to pay for this month');
  await db.payrollEntry.deleteMany({ where: { runId } });
  const lines = staff.map((s) => {
    const other = keepOther.get(s.id);
    const line = computePayLine(s.basicSalary, set, other?.amount ?? 0, s.fullName);
    return { runId, staffId: s.id, ...line, otherNote: other?.note ?? null };
  });
  await db.payrollEntry.createMany({ data: lines });
  await db.payrollRun.update({
    where: { id: runId },
    data: {
      rateSetId: set.id,
      totalBasic: sum(lines.map((l) => l.basic)),
      totalNssfEmployee: sum(lines.map((l) => l.nssfEmployee)),
      totalNssfEmployer: sum(lines.map((l) => l.nssfEmployer)),
      totalPaye: sum(lines.map((l) => l.paye)),
      totalOther: sum(lines.map((l) => l.otherDeductions)),
      totalNet: sum(lines.map((l) => l.net)),
    },
  });
  return set;
}

async function loadRun(id: number) {
  const run = await prisma.payrollRun.findUnique({
    where: { id },
    include: { entries: { include: { staff: true }, orderBy: { staff: { staffCode: 'asc' } } }, term: { include: { academicYear: true } }, rateSet: true, expense: true },
  });
  if (!run) throw notFound('Payroll run');
  return run;
}

async function serializeRun(run: Awaited<ReturnType<typeof loadRun>>) {
  const users = await prisma.user.findMany({ where: { id: { in: [run.preparedById, run.approvedById ?? 0] } }, select: { id: true, fullName: true } });
  const name = (id: number | null) => users.find((u) => u.id === id)?.fullName ?? null;
  return {
    id: run.id, year: run.year, month: run.month, label: monthLabel(run.year, run.month), status: run.status,
    termId: run.termId, termLabel: termLabel(run.term),
    rateSet: { id: run.rateSet.id, effectiveFrom: isoDate(run.rateSet.effectiveFrom), validated: run.rateSet.validated },
    totals: {
      basic: money(run.totalBasic), nssfEmployee: money(run.totalNssfEmployee), nssfEmployer: money(run.totalNssfEmployer),
      paye: money(run.totalPaye), other: money(run.totalOther), net: money(run.totalNet), expenseAmount: money(payrollExpenseAmount(run)),
    },
    preparedById: run.preparedById, preparedBy: name(run.preparedById), preparedAt: run.preparedAt, submittedAt: run.submittedAt,
    approvedBy: name(run.approvedById), approvedAt: run.approvedAt, decisionNote: run.decisionNote,
    expense: run.expense ? { id: run.expense.id, expenseNo: run.expense.expenseNo, amount: money(run.expense.amount) } : null,
    entries: run.entries.map((e) => ({
      id: e.id, staffId: e.staffId, staffCode: e.staff.staffCode, fullName: e.staff.fullName, jobRole: e.staff.jobRole, department: e.staff.department,
      basic: money(e.basic), nssfEmployee: money(e.nssfEmployee), nssfEmployer: money(e.nssfEmployer), paye: money(e.paye),
      otherDeductions: money(e.otherDeductions), otherNote: e.otherNote, net: money(e.net),
    })),
  };
}

router.get(
  '/runs',
  requirePermission('payroll.view'),
  handle(async () => {
    const runs = await prisma.payrollRun.findMany({ include: { term: { include: { academicYear: true } } }, orderBy: [{ year: 'desc' }, { month: 'desc' }] });
    return runs.map((r) => ({
      id: r.id, year: r.year, month: r.month, label: monthLabel(r.year, r.month), status: r.status, termLabel: termLabel(r.term),
      totalBasic: money(r.totalBasic), totalNet: money(r.totalNet), expenseAmount: money(payrollExpenseAmount(r)),
    }));
  }),
);

router.get('/runs/:id', requirePermission('payroll.view'), handle(async (req) => serializeRun(await loadRun(idParam(req)))));

router.post(
  '/runs',
  requirePermission('payroll.manage'),
  handle(async (req) => {
    const body = parse(z.object({ year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12), termId: z.number().int().optional() }), req.body);
    const user = currentUser(req);
    if (await prisma.payrollRun.findUnique({ where: { year_month: { year: body.year, month: body.month } } })) {
      throw conflict(`A payroll run for ${monthLabel(body.year, body.month)} already exists`);
    }
    let termId = body.termId;
    if (!termId) {
      const term = postingTermForMonth(await prisma.academicTerm.findMany(), body.year, body.month);
      if (!term) throw badRequest('No term covers this month. Choose the term to post salaries to.');
      termId = term.id;
    }
    const run = await prisma.$transaction(async (tx) => {
      const set = await rateSetFor(tx, body.year, body.month);
      const created = await tx.payrollRun.create({ data: { year: body.year, month: body.month, termId: termId!, rateSetId: set.id, preparedById: user.id } });
      await buildEntries(tx, created.id, body.year, body.month);
      await audit(tx, user, 'payroll.run_create', 'PayrollRun', created.id, { after: body });
      return created;
    });
    return serializeRun(await loadRun(run.id));
  }),
);

async function editableRun(id: number) {
  const run = await prisma.payrollRun.findUnique({ where: { id } });
  if (!run) throw notFound('Payroll run');
  if (!['DRAFT', 'REJECTED'].includes(run.status)) throw badRequest('Only draft payroll runs can be changed');
  return run;
}

router.post(
  '/runs/:id/recalculate',
  requirePermission('payroll.manage'),
  handle(async (req) => {
    const run = await editableRun(idParam(req));
    const entries = await prisma.payrollEntry.findMany({ where: { runId: run.id } });
    const keep = new Map(entries.map((e) => [e.staffId, { amount: e.otherDeductions.toString(), note: e.otherNote }]));
    await prisma.$transaction(async (tx) => {
      await buildEntries(tx, run.id, run.year, run.month, keep);
      await tx.payrollRun.update({ where: { id: run.id }, data: { status: 'DRAFT' } });
    });
    return serializeRun(await loadRun(run.id));
  }),
);

router.patch(
  '/runs/:id',
  requirePermission('payroll.manage'),
  handle(async (req) => {
    const run = await editableRun(idParam(req));
    const body = parse(z.object({ termId: z.number().int() }), req.body);
    await prisma.payrollRun.update({ where: { id: run.id }, data: { termId: body.termId } });
    await audit(prisma, currentUser(req), 'payroll.run_term', 'PayrollRun', run.id, { before: { termId: run.termId }, after: body });
    return serializeRun(await loadRun(run.id));
  }),
);

router.patch(
  '/runs/:id/entries/:entryId',
  requirePermission('payroll.manage'),
  handle(async (req) => {
    const run = await editableRun(idParam(req));
    const entryId = idParam(req, 'entryId');
    const body = parse(z.object({ otherDeductions: moneyInput, otherNote: z.string().trim().max(200).nullable().optional() }), req.body);
    const entry = await prisma.payrollEntry.findFirst({ where: { id: entryId, runId: run.id }, include: { staff: true } });
    if (!entry) throw notFound('Payroll line');
    if (dec(body.otherDeductions).gt(0) && !body.otherNote) throw badRequest('Say what the other deduction is for');
    const entries = await prisma.payrollEntry.findMany({ where: { runId: run.id } });
    const keep = new Map(entries.map((e) => [e.staffId, { amount: e.otherDeductions.toString(), note: e.otherNote }]));
    keep.set(entry.staffId, { amount: body.otherDeductions, note: body.otherNote ?? null });
    await prisma.$transaction(async (tx) => {
      await buildEntries(tx, run.id, run.year, run.month, keep);
      await audit(tx, currentUser(req), 'payroll.entry_update', 'PayrollEntry', entryId, { before: entry, after: body });
    });
    return serializeRun(await loadRun(run.id));
  }),
);

router.delete(
  '/runs/:id',
  requirePermission('payroll.manage'),
  handle(async (req) => {
    const run = await editableRun(idParam(req));
    await prisma.$transaction([prisma.payrollEntry.deleteMany({ where: { runId: run.id } }), prisma.payrollRun.delete({ where: { id: run.id } })]);
    await audit(prisma, currentUser(req), 'payroll.run_delete', 'PayrollRun', run.id, { before: run });
    return { ok: true };
  }),
);

router.post(
  '/runs/:id/submit',
  requirePermission('payroll.manage'),
  handle(async (req) => {
    const run = await editableRun(idParam(req));
    await checkTermOpen(prisma, currentUser(req), run.termId);
    await prisma.payrollRun.update({ where: { id: run.id }, data: { status: 'SUBMITTED', submittedAt: new Date(), decisionNote: null } });
    await audit(prisma, currentUser(req), 'payroll.run_submit', 'PayrollRun', run.id);
    return serializeRun(await loadRun(run.id));
  }),
);

/** Approval posts one Salaries expense; the unique expense link makes double posting impossible. */
router.post(
  '/runs/:id/decide',
  requirePermission('payroll.approve'),
  handle(async (req) => {
    const id = idParam(req);
    const body = parse(z.object({ approve: z.boolean(), note: z.string().trim().max(300).nullable().optional() }), req.body);
    const user = currentUser(req);
    const run = await prisma.payrollRun.findUnique({ where: { id }, include: { rateSet: true } });
    if (!run) throw notFound('Payroll run');
    if (run.status !== 'SUBMITTED') throw badRequest(run.status === 'POSTED' ? 'This payroll run has already been posted' : 'Submit the payroll run before approving it');
    assertDifferentApprover(run.preparedById, user.id);
    assertWithinApprovalLimit(user, (await getSettings(prisma)).approvalLimit, payrollExpenseAmount(run));
    if (!body.approve) {
      if (!body.note) throw badRequest('Give a reason for rejecting');
      await prisma.payrollRun.update({ where: { id }, data: { status: 'REJECTED', decisionNote: body.note } });
      await audit(prisma, user, 'payroll.run_reject', 'PayrollRun', id, { reason: body.note });
      return serializeRun(await loadRun(id));
    }
    const settings = await getSettings(prisma);
    if (!settings.payrollEnabled) {
      throw forbidden('Payroll posting is switched off until the PAYE and NSSF rates are signed off. An administrator can switch it on in Setup.');
    }
    if (!run.rateSet.validated) throw forbidden('The PAYE and NSSF rates used by this run have not been signed off yet (Payroll > Rates).');
    const postClose = await checkTermOpen(prisma, user, run.termId);
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.payrollRun.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: 'POSTED' } });
      if (claimed.count !== 1) throw badRequest('This payroll run has already been posted');
      const expense = await tx.expense.create({
        data: {
          expenseNo: await nextExpenseNo(tx),
          expenseDate: new Date(Date.UTC(run.year, run.month, 0)),
          termId: run.termId,
          category: 'SALARIES',
          description: `Payroll ${monthLabel(run.year, run.month)}: basic pay plus employer NSSF`,
          amount: payrollExpenseAmount(run),
          method: 'BANK_TRANSFER',
          fundingSource: 'SCHOOL_FUNDS',
          status: 'APPROVED',
          enteredById: run.preparedById,
          approvedById: user.id,
          approvedByName: user.fullName,
          decidedAt: new Date(),
          postClose,
        },
      });
      await tx.payrollRun.update({ where: { id }, data: { approvedById: user.id, approvedAt: new Date(), decisionNote: body.note ?? null, expenseId: expense.id } });
      await audit(tx, user, 'payroll.run_post', 'PayrollRun', id, { after: { expenseId: expense.id, amount: expense.amount } });
    });
    return serializeRun(await loadRun(id));
  }),
);

/** WR-16: one staff member's payslip. */
router.get(
  '/runs/:id/payslips/:staffId',
  requirePermission('payroll.view'),
  handle(async (req) => {
    const run = await serializeRun(await loadRun(idParam(req)));
    const entry = run.entries.find((e) => e.staffId === idParam(req, 'staffId'));
    if (!entry) throw notFound('Payslip');
    const settings = await getSettings(prisma);
    // Year to date: approved months of the same year up to this one, plus this month even if not yet approved.
    const earlier = await postedEntries({ staffId: entry.staffId, run: { year: run.year, month: { lt: run.month } } });
    const self = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
    const yearToDate = payTotals([...earlier, self]);
    return { school: { name: settings.schoolName, address: settings.address }, period: run.label, status: run.status, entry, yearToDate };
  }),
);
