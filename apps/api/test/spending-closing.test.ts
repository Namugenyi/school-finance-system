import { beforeEach, describe, expect, it } from 'vitest';
import { bill, chargesOf, createPupil, key, login, pay, resetDb, setFees, type Client, type World } from './helpers';
import { prisma } from '../src/db';
import { dec } from '../src/lib/money';

let w: World;
let bursar: Client;
let head: Client;
let admin: Client;

beforeEach(async () => {
  w = await resetDb();
  bursar = await login('bursar');
  head = await login('head');
  admin = await login('admin');
});

const expense = (over: object = {}) => ({
  expenseDate: '2026-03-10', termId: w.terms.t1, category: 'ELECTRICITY', description: 'UMEME bill March', amount: '250000',
  supplier: 'UMEME', method: 'MOBILE_MONEY', invoiceRef: 'INV-77', fundingSource: 'SCHOOL_FUNDS', ...over,
});

async function approvedExpense(over: object = {}) {
  const e = await bursar.post('/api/expenses', expense(over));
  await head.post(`/api/expenses/${e.body.id}/decide`, { approve: true });
  return e.body;
}

describe('expenses and funding sources (FR-701 to FR-706, D-03, D-05)', () => {
  it('needs approval from someone else and records the approver (FR-706, CTL-08)', async () => {
    const e = await bursar.post('/api/expenses', expense());
    expect(e.body.status).toBe('PENDING');
    expect((await bursar.post(`/api/expenses/${e.body.id}/decide`, { approve: true })).status).toBe(403);
    expect((await head.post(`/api/expenses/${e.body.id}/decide`, { approve: false })).status).toBe(400); // reason needed
    expect((await head.post(`/api/expenses/${e.body.id}/decide`, { approve: true })).status).toBe(200);
    const after = (await bursar.get(`/api/expenses/${e.body.id}`)).body;
    expect(after).toMatchObject({ status: 'APPROVED', approvedByName: 'Head User' });
  });

  it('warns about a duplicate invoice (WR-14)', async () => {
    await bursar.post('/api/expenses', expense());
    const again = await bursar.post('/api/expenses', expense());
    expect(again.body.warnings.join(' ')).toMatch(/already recorded/);
  });

  it('requires a funding source from the list (CTL-07)', async () => {
    expect((await bursar.post('/api/expenses', expense({ fundingSource: '' }))).status).toBe(400);
  });

  it('reports school, owner and other funded spending separately (FR-703, AC-12, E2E-10)', async () => {
    await approvedExpense({ amount: '100000', fundingSource: 'SCHOOL_FUNDS', invoiceRef: 'A' });
    await approvedExpense({ amount: '200000', fundingSource: 'OWNER_CONTRIBUTION', invoiceRef: 'B' });
    await approvedExpense({ amount: '300000', fundingSource: 'OWNER_LOAN', invoiceRef: 'C' });
    await approvedExpense({ amount: '50000', fundingSource: 'DONATION', invoiceRef: 'D' });
    await bursar.post('/api/expenses', expense({ amount: '999999', invoiceRef: 'PENDING' })); // pending: not counted
    const s = (await head.get(`/api/reports/summary?termId=${w.terms.t1}`)).body;
    expect(s).toMatchObject({ schoolFundedExpenses: '100000.00', ownerFundedExpenses: '500000.00', otherFundedExpenses: '50000.00', totalExpenses: '650000.00' });
    const byCat = (await head.get(`/api/reports/expenses-by-category?termId=${w.terms.t1}`)).body;
    expect(byCat[0]).toMatchObject({ categoryLabel: 'Electricity', schoolFunded: '100000.00', ownerFunded: '500000.00', otherFunded: '50000.00' });
  });
});

describe('owner contributions and loans (FR-801 to FR-803, BR-21, E2E-11)', () => {
  it('never treats a loan or cash contribution as income', async () => {
    await bursar.post('/api/owner-funds', { date: '2026-03-01', termId: w.terms.t1, type: 'LOAN', amount: '5000000', ownerName: 'Proprietor' });
    await bursar.post('/api/owner-funds', { date: '2026-03-01', termId: w.terms.t1, type: 'CASH', amount: '1000000', ownerName: 'Proprietor' });
    const s = (await head.get(`/api/reports/summary?termId=${w.terms.t1}`)).body;
    expect(s).toMatchObject({ totalCollected: '0.00', netResult: '0.00' });
    const owner = (await head.get(`/api/reports/owner-funds?termId=${w.terms.t1}`)).body;
    expect(owner).toMatchObject({ loansReceived: '5000000.00', cashContributions: '1000000.00' });
  });

  it('links an Expense Paid Directly to its owner-funded expense, counted once (FR-802, WR-14)', async () => {
    const e = await approvedExpense({ amount: '400000', fundingSource: 'OWNER_CONTRIBUTION', category: 'REPAIRS_AND_MAINTENANCE', invoiceRef: 'R1' });
    const mismatch = await bursar.post('/api/owner-funds', { date: '2026-03-01', termId: w.terms.t1, type: 'EXPENSE_PAID_DIRECTLY', amount: '1', ownerName: 'Proprietor', expenseId: e.id });
    expect(mismatch.status).toBe(400);
    const ok = await bursar.post('/api/owner-funds', { date: '2026-03-01', termId: w.terms.t1, type: 'EXPENSE_PAID_DIRECTLY', amount: '400000', ownerName: 'Proprietor', expenseId: e.id });
    expect(ok.status).toBe(200);
    const twice = await bursar.post('/api/owner-funds', { date: '2026-03-01', termId: w.terms.t1, type: 'EXPENSE_PAID_DIRECTLY', amount: '400000', ownerName: 'Proprietor', expenseId: e.id });
    expect(twice.status).toBe(400);
    const s = (await head.get(`/api/reports/summary?termId=${w.terms.t1}`)).body;
    expect(s.totalExpenses).toBe('400000.00');
  });
});

describe('payroll (FR-901 to FR-908, WR-16, WR-17, D-07, E2E-12/13)', () => {
  async function staffAndRun() {
    await bursar.post('/api/payroll/staff', { fullName: 'Teacher One', jobRole: 'Class teacher', employmentType: 'PERMANENT', basicSalary: '500000', startDate: '2025-01-01' });
    await bursar.post('/api/payroll/staff', { fullName: 'Cook Two', jobRole: 'Cook', employmentType: 'CONTRACT', basicSalary: '300000', startDate: '2025-01-01' });
    const run = await bursar.post('/api/payroll/runs', { year: 2026, month: 3 });
    expect(run.status).toBe(200);
    return run.body;
  }

  it('numbers staff STF-NNN (FR-902) and computes the run', async () => {
    const run = await staffAndRun();
    expect(run.entries.map((e: { staffCode: string }) => e.staffCode)).toEqual(['STF-001', 'STF-002']);
    expect(run.totals).toMatchObject({ basic: '800000.00', nssfEmployee: '40000.00', nssfEmployer: '80000.00', paye: '58500.00', net: '701500.00', expenseAmount: '880000.00' });
    expect(run.termLabel).toBe('Term 1 2026');
  });

  it('stays switched off until rates are signed off and payroll is enabled (G-03)', async () => {
    const run = await staffAndRun();
    await bursar.post(`/api/payroll/runs/${run.id}/submit`);
    const blocked = await head.post(`/api/payroll/runs/${run.id}/decide`, { approve: true });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toMatch(/switched off/);
  });

  it('posts once only, as basic plus employer NSSF under Salaries (FR-908, D-07)', async () => {
    const run = await staffAndRun();
    const set = await prisma.statutoryRateSet.findFirstOrThrow();
    await prisma.statutoryRateSet.update({ where: { id: set.id }, data: { validated: true, validatedBy: 'Test' } });
    await admin.patch('/api/setup/settings', { payrollEnabled: true });
    await bursar.post(`/api/payroll/runs/${run.id}/submit`);
    expect((await bursar.post(`/api/payroll/runs/${run.id}/decide`, { approve: true })).status).toBe(403); // preparer cannot approve
    const owner = await login('owner');
    const [a, b] = await Promise.all([
      head.post(`/api/payroll/runs/${run.id}/decide`, { approve: true }),
      owner.post(`/api/payroll/runs/${run.id}/decide`, { approve: true }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    const salaries = await prisma.expense.findMany({ where: { category: 'SALARIES' } });
    expect(salaries).toHaveLength(1);
    expect(salaries[0].amount.toFixed(2)).toBe('880000.00');
    expect(salaries[0].status).toBe('APPROVED');
    expect((await bursar.post('/api/payroll/runs', { year: 2026, month: 3 })).status).toBe(409);
  });

  it('rejects other deductions that make net pay negative (A-19)', async () => {
    const run = await staffAndRun();
    const entry = run.entries[1];
    const res = await bursar.patch(`/api/payroll/runs/${run.id}/entries/${entry.id}`, { otherDeductions: '400000', otherNote: 'Advance' });
    expect(res.status).toBe(400);
  });
});

describe('carry forward (FR-1101 to FR-1105, D-01, WR-18, E2E-09)', () => {
  async function billedPupil() {
    await setFees(bursar, w.terms.t1, w.classes.p1, [
      { feeItemId: w.items.SCHOOL_FEES, amount: '450000', mandatory: true },
      { feeItemId: w.items.SWIMMING, amount: '30000', mandatory: false },
    ]);
    const p = await createPupil(bursar, w, 'Debtor Pupil');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const charges = await chargesOf(bursar, p.id, w.terms.t1);
    const sf = charges.find((c) => c.feeItemName === 'School Fees')!;
    const sw = charges.find((c) => c.feeItemName === 'Swimming')!;
    await pay(bursar, p.id, [{ chargeId: sf.id, amount: '300000' }, { chargeId: sw.id, amount: '30000' }]);
    return { p, sf, sw };
  }

  it('distinguishes "no charges" from "all settled" (FR-1105)', async () => {
    const none = await bursar.post('/api/carry-forward/preview', { sourceTermId: w.terms.t1, destTermId: w.terms.t2 });
    expect(none.body.diagnostics[0]).toMatch(/no charges/);
    const { p, sf } = await billedPupil();
    await pay(bursar, p.id, [{ chargeId: sf.id, amount: '150000' }]);
    const settled = await bursar.post('/api/carry-forward/preview', { sourceTermId: w.terms.t1, destTermId: w.terms.t2 });
    expect(settled.body.diagnostics[0]).toMatch(/fully settled/);
  });

  it('moves the debt once, closes the source and links both charges (D-01, BR-20, WR-18)', async () => {
    const { p, sf } = await billedPupil();
    const preview = (await bursar.post('/api/carry-forward/preview', { sourceTermId: w.terms.t1, destTermId: w.terms.t2 })).body;
    expect(preview.counts).toMatchObject({ examined: 2, withBalance: 1 });
    expect(preview.totalArrears).toBe('150000.00');
    const k = key();
    const post = await bursar.post('/api/carry-forward/post', { sourceTermId: w.terms.t1, destTermId: w.terms.t2, idempotencyKey: k, confirm: true });
    expect(post.body).toMatchObject({ carried: 1, totalAmount: '150000.00' });
    // Same request again: no second carry.
    expect((await bursar.post('/api/carry-forward/post', { sourceTermId: w.terms.t1, destTermId: w.terms.t2, idempotencyKey: k, confirm: true })).body.repeated).toBe(true);
    expect((await bursar.post('/api/carry-forward/post', { sourceTermId: w.terms.t1, destTermId: w.terms.t2, idempotencyKey: key(), confirm: true })).status).toBe(400);

    const src = (await bursar.get(`/api/charges/${sf.id}`)).body;
    expect(src).toMatchObject({ status: 'CARRIED_FORWARD', balance: '0.00', carriedForward: '150000.00' });
    const t2 = await chargesOf(bursar, p.id, w.terms.t2);
    expect(t2).toHaveLength(1);
    expect(t2[0]).toMatchObject({ feeItemName: 'Arrears B/F', isArrears: true, amountCharged: '150000.00', sourceChargeId: sf.id, arrearsFrom: 'School Fees, Term 1 2026' });

    // The debt shows once across all terms (D-01).
    const all = (await bursar.get('/api/collections/arrears')).body;
    expect(all.rows[0].outstanding).toBe('150000.00');
    expect(all.rows[0].totalBilled).toBe('480000.00');
    // Paying old charge is refused; paying the Arrears B/F clears it.
    expect((await pay(bursar, p.id, [{ chargeId: sf.id, amount: '10' }])).status).toBe(400);
    await pay(bursar, p.id, [{ chargeId: t2[0].id, amount: '150000' }]);
    const st = (await bursar.get(`/api/collections/statements/${p.id}`)).body;
    expect(st.totals).toMatchObject({ totalBilled: '480000.00', totalPaid: '480000.00', outstanding: '0.00', statusLabel: 'Paid in Full' });
  });

  it('only carries forward to a later term', async () => {
    expect((await bursar.post('/api/carry-forward/preview', { sourceTermId: w.terms.t2, destTermId: w.terms.t1 })).status).toBe(400);
  });
});

describe('reports reconcile (FR-1601 to FR-1607, E2E-14)', () => {
  it('billed + arrears in − collected − carried out = outstanding − credits, per term', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '450000', mandatory: true }, { feeItemId: w.items.SWIMMING, amount: '30000', mandatory: false }]);
    await setFees(bursar, w.terms.t2, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '450000', mandatory: true }]);
    const pupils = [];
    for (let i = 0; i < 4; i++) pupils.push(await createPupil(bursar, w, `Recon ${i}`));
    await bill(bursar, w.terms.t1, w.classes.p1, [{ key: `${pupils[0].id}:${w.items.SCHOOL_FEES}`, discount: '45000', discountReason: 'Sibling' }]);
    const d = (await prisma.chargeDiscount.findFirstOrThrow()).id;
    await head.post(`/api/charges/discounts/${d}/decide`, { approve: true });
    for (const [i, p] of pupils.entries()) {
      const cs = await chargesOf(bursar, p.id, w.terms.t1);
      const sf = cs.find((c) => c.feeItemName === 'School Fees')!;
      if (i < 3) await pay(bursar, p.id, [{ chargeId: sf.id, amount: String(100000 * (i + 1)) }]);
    }
    const sw = (await chargesOf(bursar, pupils[3].id, w.terms.t1)).find((c) => c.feeItemName === 'Swimming')!;
    await pay(bursar, pupils[3].id, [{ chargeId: sw.id, amount: '40000' }], { acknowledgeOverpayment: true });
    await bursar.post('/api/carry-forward/post', { sourceTermId: w.terms.t1, destTermId: w.terms.t2, idempotencyKey: key(), confirm: true });
    await bill(bursar, w.terms.t2, w.classes.p1);
    const someArrears = (await chargesOf(bursar, pupils[1].id, w.terms.t2)).find((c) => c.isArrears)!;
    await pay(bursar, pupils[1].id, [{ chargeId: someArrears.id, amount: '50000' }]);
    await approvedExpense({ amount: '123456' });

    for (const termId of [w.terms.t1, w.terms.t2]) {
      const s = (await head.get(`/api/reports/summary?termId=${termId}`)).body;
      const lhs = dec(s.totalBilled).plus(s.arrearsBroughtForward).minus(s.totalCollected).minus(s.carriedForwardOut);
      const rhs = dec(s.outstanding).minus(s.credits);
      expect(lhs.toFixed(2), `term ${termId}`).toBe(rhs.toFixed(2));
      expect(dec(s.netResult).toFixed(2)).toBe(dec(s.totalCollected).minus(s.totalExpenses).toFixed(2));
    }
    const t1 = (await head.get(`/api/reports/summary?termId=${w.terms.t1}`)).body;
    expect(t1).toMatchObject({ totalBilled: '1875000.00', totalDiscounts: '45000.00', totalCollected: '640000.00', credits: '10000.00', outstanding: '0.00', activePupils: 4 });
    expect(t1.collectionRate).toBe('0.3413');

    // Dashboard and reports agree (WR-22).
    const dash = (await head.get(`/api/dashboard?termId=${w.terms.t2}`)).body;
    const t2 = (await head.get(`/api/reports/summary?termId=${w.terms.t2}`)).body;
    expect(dash.figures).toEqual(t2);
    const byClass = (await head.get(`/api/reports/outstanding-by-class?termId=${w.terms.t2}`)).body;
    expect(byClass.reduce((s: ReturnType<typeof dec>, r: { outstanding: string }) => s.plus(r.outstanding), dec(0)).toFixed(2)).toBe(t2.outstanding);
    const items = (await head.get(`/api/reports/revenue-by-item?termId=${w.terms.t2}`)).body;
    expect(items).toHaveLength(12); // every item in the vocabulary (FR-1603)
    expect(items.reduce((s: ReturnType<typeof dec>, r: { collected: string }) => s.plus(r.collected), dec(0)).toFixed(2)).toBe(t2.totalCollected);
  });

  it('shows n/a collection rate with nothing billed (WR-20)', async () => {
    const s = (await head.get(`/api/reports/summary?termId=${w.terms.t3}`)).body;
    expect(s.collectionRate).toBeNull();
  });
});

describe('term close and snapshots (FR-1501 to FR-1504, WR-19, E2E-15)', () => {
  it('archives approved figures that never change afterwards', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '450000', mandatory: true }]);
    const p = await createPupil(bursar, w, 'Close Pupil');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const sf = (await chargesOf(bursar, p.id))[0];
    await pay(bursar, p.id, [{ chargeId: sf.id, amount: '200000' }]);
    const pending = await bursar.post('/api/expenses', expense());

    const blocked = await bursar.post(`/api/term-close/${w.terms.t1}/prepare`, { confirm: true });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.message).toMatch(/waiting for approval/);
    await head.post(`/api/expenses/${pending.body.id}/decide`, { approve: true });

    const snap = await bursar.post(`/api/term-close/${w.terms.t1}/prepare`, { confirm: true, notes: 'End of term 1' });
    expect(snap.body).toMatchObject({ status: 'PENDING', version: 1, totalBilled: '450000.00', totalCollected: '200000.00', totalExpenses: '250000.00', netResult: '-50000.00', recordedByName: 'Bursar User' });
    expect((await bursar.post(`/api/term-close/snapshots/${snap.body.id}/decide`, { approve: true })).status).toBe(403);
    expect((await head.post(`/api/term-close/snapshots/${snap.body.id}/decide`, { approve: true })).status).toBe(200);

    // Closed term: bursar can no longer post to it; the head teacher can, as a flagged exception (A-24).
    expect((await pay(bursar, p.id, [{ chargeId: sf.id, amount: '50000' }])).status).toBe(403);
    const late = await (await login('head')).post('/api/expenses', expense({ invoiceRef: 'LATE' }));
    expect(late.status).toBe(403); // head has no expenses.manage
    await prisma.rolePermission.create({ data: { roleId: (await prisma.role.findUniqueOrThrow({ where: { code: 'BURSAR' } })).id, permission: 'term.postClosed' } });
    const bursarWithException = await login('bursar');
    expect((await pay(bursarWithException, p.id, [{ chargeId: sf.id, amount: '50000' }])).status).toBe(200);

    // FR-1504: the archived snapshot is unchanged; the live figures moved.
    const archived = (await head.get(`/api/term-close/snapshots/${snap.body.id}`)).body;
    expect(archived.totalCollected).toBe('200000.00');
    const live = (await head.get(`/api/reports/summary?termId=${w.terms.t1}`)).body;
    expect(live.totalCollected).toBe('250000.00');
    // The database itself refuses to alter an approved snapshot (BR-22).
    await expect(prisma.termSnapshot.update({ where: { id: snap.body.id }, data: { totalCollected: 1 } })).rejects.toThrow(/cannot be changed/);
    await expect(prisma.termSnapshot.delete({ where: { id: snap.body.id } })).rejects.toThrow(/cannot be deleted/);

    // Re-close creates version 2 that supersedes, keeping version 1 (WR-19).
    const ready = (await head.get(`/api/term-close/${w.terms.t1}/readiness`)).body;
    expect(ready.postCloseExceptions.map((e: { type: string }) => e.type)).toContain('Receipt');
    const v2 = await bursar.post(`/api/term-close/${w.terms.t1}/prepare`, { confirm: true });
    expect(v2.body).toMatchObject({ version: 2, supersedesId: snap.body.id, totalCollected: '250000.00' });
  });

  it('refuses to approve a snapshot when figures changed after it was prepared', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '450000', mandatory: true }]);
    const p = await createPupil(bursar, w, 'Drift Pupil');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const snap = await bursar.post(`/api/term-close/${w.terms.t1}/prepare`, { confirm: true });
    const sf = (await chargesOf(bursar, p.id))[0];
    await pay(bursar, p.id, [{ chargeId: sf.id, amount: '1000' }]);
    const res = await head.post(`/api/term-close/snapshots/${snap.body.id}/decide`, { approve: true });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/changed after/);
  });
});
