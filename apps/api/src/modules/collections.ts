import { Router } from 'express';
import { prisma } from '../db';
import { handle, idParam } from '../lib/http';
import { notFound } from '../lib/errors';
import { isoDate } from '../lib/dates';
import { dec, money } from '../lib/money';
import { sendCsv, wantsCsv } from '../lib/csv';
import { hasPermission, requirePermission } from '../auth/session';
import { balanceWhere, pupilOverallStatus } from '../finance/figures';
import { getSettings } from './setup';
import { loadCharges } from './charges';

export const router = Router();

const STATUS_LABEL = { PAID_IN_FULL: 'Paid in Full', PARTIAL: 'Partial', UNPAID: 'Unpaid' } as const;

/**
 * FR-1301 to FR-1305, WR-12: one row per pupil with billed, paid, outstanding and unpaid items,
 * for a term, a year or all terms. Billed follows D-01/D-02 (net, excluding Arrears B/F).
 */
router.get(
  '/arrears',
  requirePermission('arrears.view'),
  handle(async (req, res) => {
    const q = req.query;
    const scope = { termId: q.termId ? Number(q.termId) : undefined, academicYearId: q.academicYearId ? Number(q.academicYearId) : undefined };
    const classId = q.classId ? Number(q.classId) : undefined;
    const minBalance = q.minBalance ? dec(String(q.minBalance)) : null;
    const onlyOutstanding = q.onlyOutstanding !== 'false';
    // The class filter uses the class each charge was billed in, so it matches "Outstanding by class" on the dashboard.
    const balances = await prisma.chargeBalance.findMany({
      where: { ...balanceWhere(scope), classId },
      select: { pupilId: true, netDue: true, totalPaid: true, balance: true, isArrears: true },
    });
    const byPupil = new Map<number, { billed: ReturnType<typeof dec>; paid: ReturnType<typeof dec>; outstanding: ReturnType<typeof dec>; unpaidItems: number }>();
    for (const b of balances) {
      const row = byPupil.get(b.pupilId) ?? { billed: dec(0), paid: dec(0), outstanding: dec(0), unpaidItems: 0 };
      if (!b.isArrears) row.billed = row.billed.plus(b.netDue);
      row.paid = row.paid.plus(b.totalPaid);
      row.outstanding = row.outstanding.plus(b.balance);
      // A-14: unpaid items = charges with a balance above zero (Unpaid + Partial).
      if (dec(b.balance).gt(0)) row.unpaidItems += 1;
      byPupil.set(b.pupilId, row);
    }
    const pupils = await prisma.pupil.findMany({
      where: { id: { in: [...byPupil.keys()] } },
      include: { schoolClass: true },
    });
    const showContacts = hasPermission(req.user, 'pupils.contacts');
    let rows = pupils.map((p) => {
      const t = byPupil.get(p.id)!;
      const status = pupilOverallStatus(t.outstanding, t.paid);
      return {
        pupilId: p.id,
        pupilCode: p.pupilCode,
        pupilName: p.fullName,
        className: p.schoolClass.name,
        pupilStatus: p.status,
        guardianName: p.guardianName,
        phonePrimary: showContacts ? p.phonePrimary : null,
        phoneAlt: showContacts ? p.phoneAlt : null,
        totalBilled: money(t.billed),
        totalPaid: money(t.paid),
        outstanding: money(t.outstanding),
        unpaidItems: t.unpaidItems,
        status,
        statusLabel: STATUS_LABEL[status],
      };
    });
    if (onlyOutstanding) rows = rows.filter((r) => dec(r.outstanding).gt(0));
    if (minBalance) rows = rows.filter((r) => dec(r.outstanding).gte(minBalance));
    rows.sort((a, b) => dec(b.outstanding).comparedTo(dec(a.outstanding)) || a.pupilName.localeCompare(b.pupilName));
    const totals = {
      pupils: rows.length,
      totalBilled: money(rows.reduce((s, r) => s.plus(r.totalBilled), dec(0))),
      totalPaid: money(rows.reduce((s, r) => s.plus(r.totalPaid), dec(0))),
      outstanding: money(rows.reduce((s, r) => s.plus(r.outstanding), dec(0))),
    };
    if (wantsCsv(q)) {
      sendCsv(
        res,
        'arrears.csv',
        ['Pupil ID', 'Pupil', 'Class', 'Parent/Guardian', 'Phone', 'Alt phone', 'Total billed', 'Total paid', 'Outstanding', 'Unpaid items', 'Status'],
        rows.map((r) => [r.pupilCode, r.pupilName, r.className, r.guardianName, r.phonePrimary, r.phoneAlt, r.totalBilled, r.totalPaid, r.outstanding, r.unpaidItems, r.statusLabel]),
      );
      return;
    }
    return { rows, totals, contactsHidden: !showContacts };
  }),
);

/** FR-1401 to FR-1405, WR-13: a full statement of account across all years. */
router.get(
  '/statements/:pupilId',
  requirePermission('statements.view'),
  handle(async (req) => {
    const pupilId = idParam(req, 'pupilId');
    const pupil = await prisma.pupil.findUnique({ where: { id: pupilId }, include: { schoolClass: { include: { section: true } } } });
    if (!pupil) throw notFound('Pupil');
    const settings = await getSettings(prisma);
    const balances = await prisma.chargeBalance.findMany({ where: { pupilId, voided: false }, select: { chargeId: true } });
    const charges = (await loadCharges(prisma, balances.map((b) => b.chargeId))).sort(
      (a, b) => a.year - b.year || a.termLabel.localeCompare(b.termLabel) || (a.isArrears ? -1 : 1) - (b.isArrears ? -1 : 1) || a.feeItemName.localeCompare(b.feeItemName),
    );
    const receipts = await prisma.receipt.findMany({
      where: { pupilId },
      include: { lines: { include: { charge: { include: { feeItem: true, term: { include: { academicYear: true } } } } } } },
      orderBy: [{ paymentDate: 'desc' }, { id: 'desc' }],
    });
    const billed = charges.filter((c) => !c.isArrears).reduce((s, c) => s.plus(c.netDue), dec(0));
    const paid = charges.reduce((s, c) => s.plus(c.totalPaid), dec(0));
    const outstanding = charges.reduce((s, c) => s.plus(c.balance), dec(0));
    const status = pupilOverallStatus(outstanding, paid);
    const showContacts = hasPermission(req.user, 'pupils.contacts');
    return {
      school: { name: settings.schoolName, address: settings.address, phone: settings.phone, email: settings.email },
      pupil: {
        id: pupil.id, pupilCode: pupil.pupilCode, fullName: pupil.fullName, className: pupil.schoolClass.name,
        sectionName: pupil.schoolClass.section.name, status: pupil.status, guardianName: pupil.guardianName,
        phonePrimary: showContacts ? pupil.phonePrimary : null, address: showContacts ? pupil.address : null,
      },
      charges,
      // A-16: all payments, newest first.
      payments: receipts.flatMap((r) =>
        r.lines.map((l) => ({
          receiptNo: r.receiptNo, paymentDate: isoDate(r.paymentDate), feeItemName: l.charge.feeItem.name,
          termLabel: `${l.charge.term.name} ${l.charge.term.academicYear.year}`, amount: money(l.amount),
          method: r.method, reference: r.reference, reversed: r.reversedAt !== null,
        })),
      ),
      totals: { totalBilled: money(billed), totalPaid: money(paid), outstanding: money(outstanding), status, statusLabel: STATUS_LABEL[status] },
      generatedAt: new Date().toISOString(),
    };
  }),
);
