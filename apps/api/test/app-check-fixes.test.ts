/**
 * Fixes for the High findings of the full app check (27/10/2026), and the self-approval rule tested
 * with a role that really holds both the "enter" and "approve" permissions.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { bill, chargesOf, createPupil, key, login, pay, resetDb, setFees, type Client, type World } from './helpers';
import { prisma } from '../src/db';

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

async function grant(roleCode: string, ...permissions: string[]) {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  await prisma.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId: role.id, permission })), skipDuplicates: true });
}

const carry = () => bursar.post('/api/carry-forward/post', { sourceTermId: w.terms.t1, destTermId: w.terms.t2, idempotencyKey: key(), confirm: true });

describe('D-01: an Arrears B/F charge cannot be voided', () => {
  it('refuses to void Arrears B/F, so a carried debt is never written off by one person', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '500000', mandatory: true }]);
    const p = await createPupil(bursar, w, 'Carried Pupil');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const t1 = (await chargesOf(bursar, p.id, w.terms.t1))[0];
    expect((await pay(bursar, p.id, [{ chargeId: t1.id, amount: '200000' }])).status).toBe(200);
    expect((await carry()).status).toBe(200);
    const arrears = (await chargesOf(bursar, p.id, w.terms.t2))[0];
    expect(arrears.isArrears).toBe(true);

    const res = await bursar.post(`/api/charges/${arrears.id}/void`, { reason: 'Entered in error' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Arrears B\/F charge cannot be voided/);
    const statement = (await head.get(`/api/collections/statements/${p.id}`)).body;
    expect(statement.totals.outstanding).toBe('300000.00');
  });
});

describe('One set of figures: outstanding never nets a credit against a debt', () => {
  it('arrears list, statement, pupil page and receipt agree with the dashboard and show the credit separately', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [
      { feeItemId: w.items.SCHOOL_FEES, amount: '100000', mandatory: true },
      { feeItemId: w.items.REQUIREMENTS, amount: '50000', mandatory: true },
    ]);
    const p = await createPupil(bursar, w, 'Credit And Debt');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const cs = await chargesOf(bursar, p.id);
    const req = cs.find((c) => c.feeItemName !== 'School Fees')!;
    const receipt = await pay(bursar, p.id, [{ chargeId: req.id, amount: '70000' }], { acknowledgeOverpayment: true });
    expect(receipt.status).toBe(200);

    const dash = (await head.get(`/api/reports/summary?termId=${w.terms.t1}`)).body;
    expect(dash.outstanding).toBe('100000.00');

    const arrears = (await head.get(`/api/collections/arrears?termId=${w.terms.t1}`)).body;
    const row = arrears.rows.find((r: { pupilId: number }) => r.pupilId === p.id);
    expect(row).toMatchObject({ outstanding: '100000.00', credit: '20000.00' });
    expect(arrears.totals.outstanding).toBe(dash.outstanding);

    const statement = (await head.get(`/api/collections/statements/${p.id}`)).body;
    expect(statement.totals).toMatchObject({ outstanding: '100000.00', credit: '20000.00' });

    const pupil = (await head.get(`/api/pupils/${p.id}`)).body;
    expect(pupil.totals).toMatchObject({ balance: '100000.00', credit: '20000.00' });

    const printed = (await head.get(`/api/payments/receipts/${receipt.body.receiptNo}`)).body;
    expect(printed).toMatchObject({ pupilOutstanding: '100000.00', pupilCredit: '20000.00' });
  });

  it('a pupil with a credit on one item still appears on the arrears list for the debt on another', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [
      { feeItemId: w.items.SCHOOL_FEES, amount: '100000', mandatory: true },
      { feeItemId: w.items.REQUIREMENTS, amount: '50000', mandatory: true },
    ]);
    const p = await createPupil(bursar, w, 'Big Credit');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const req = (await chargesOf(bursar, p.id)).find((c) => c.feeItemName !== 'School Fees')!;
    await pay(bursar, p.id, [{ chargeId: req.id, amount: '200000' }], { acknowledgeOverpayment: true });
    const arrears = (await head.get(`/api/collections/arrears?termId=${w.terms.t1}`)).body;
    expect(arrears.rows.map((r: { pupilId: number }) => r.pupilId)).toContain(p.id);
  });
});

describe('WR-04: the audit log only shows what the viewer may see', () => {
  it('hides guardian contacts from a role without pupils.contacts and salaries from a role without payroll.view', async () => {
    await createPupil(bursar, w, 'Private Pupil');
    expect((await bursar.post('/api/payroll/staff', { fullName: 'Paid Teacher', jobRole: 'Teacher', employmentType: 'PERMANENT', basicSalary: '750000', startDate: '2025-01-01' })).status).toBe(200);

    const auditor = await login('auditor');
    const pupilEntries = (await auditor.get('/api/audit?entityType=Pupil')).body.items;
    expect(pupilEntries.length).toBeGreaterThan(0);
    expect(JSON.stringify(pupilEntries)).not.toContain('0772123456');
    expect(JSON.stringify(pupilEntries)).not.toContain('Kasangati, Wakiso');
    expect(pupilEntries[0].after.fullName).toBe('Private Pupil');

    const staffForAdmin = (await admin.get('/api/audit?entityType=Staff')).body.items;
    expect(staffForAdmin.length).toBeGreaterThan(0);
    expect(JSON.stringify(staffForAdmin)).not.toContain('750000');

    // A role that may see the details still sees them in full.
    await grant('AUDITOR', 'pupils.contacts', 'payroll.view');
    const auditor2 = await login('auditor');
    expect(JSON.stringify((await auditor2.get('/api/audit?entityType=Pupil')).body.items)).toContain('0772123456');
    expect(JSON.stringify((await auditor2.get('/api/audit?entityType=Staff')).body.items)).toContain('750000');
  });
});

describe('WR-19: a term can be re-closed after a revision is rejected', () => {
  it('prepares a new revision after the previous one was rejected', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '300000', mandatory: true }]);
    const p = await createPupil(bursar, w, 'Reclose Pupil');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const v1 = (await bursar.post(`/api/term-close/${w.terms.t1}/prepare`, { confirm: true })).body;
    expect((await head.post(`/api/term-close/snapshots/${v1.id}/decide`, { approve: true })).status).toBe(200);

    const sf = (await chargesOf(bursar, p.id))[0];
    await grant('BURSAR', 'term.postClosed');
    expect((await pay(await login('bursar'), p.id, [{ chargeId: sf.id, amount: '50000' }])).status).toBe(200); // post-close exception
    const v2 = (await bursar.post(`/api/term-close/${w.terms.t1}/prepare`, { confirm: true })).body;
    expect(v2).toMatchObject({ version: 2, supersedesId: v1.id });
    expect((await head.post(`/api/term-close/snapshots/${v2.id}/decide`, { approve: false, note: 'Check the late receipt first' })).status).toBe(200);

    const v3 = await bursar.post(`/api/term-close/${w.terms.t1}/prepare`, { confirm: true });
    expect(v3.status, JSON.stringify(v3.body)).toBe(200);
    expect(v3.body).toMatchObject({ version: 3, supersedesId: v1.id, totalCollected: '50000.00' });
    expect((await head.post(`/api/term-close/snapshots/${v3.body.id}/decide`, { approve: true })).status).toBe(200);
    // The rejected revision is kept, marked rejected.
    expect((await head.get(`/api/term-close/snapshots/${v2.id}`)).body.status).toBe('REJECTED');
  });
});

describe('D-05: nobody approves their own entry, even with approval rights', () => {
  // The bursar role is given the approve permissions, so the refusal comes from the self-approval rule
  // itself and not from a missing permission.
  let both: Client;
  beforeEach(async () => {
    await grant('BURSAR', 'expenses.approve', 'discounts.approve', 'payments.reverse.approve', 'termclose.approve');
    both = await login('bursar');
  });
  const own = /cannot approve your own entry/;

  it('D-05: refuses to approve your own expense, and another person can', async () => {
    const e = await both.post('/api/expenses', { expenseDate: '2026-03-10', termId: w.terms.t1, category: 'ELECTRICITY', description: 'Power', amount: '20000', supplier: 'Shop', method: 'CASH', invoiceRef: 'OWN-1', fundingSource: 'SCHOOL_FUNDS' });
    expect(e.status, JSON.stringify(e.body)).toBe(200);
    const mine = await both.post(`/api/expenses/${e.body.id}/decide`, { approve: true });
    expect(mine.status).toBe(403);
    expect(mine.body.error.message).toMatch(own);
    expect((await head.post(`/api/expenses/${e.body.id}/decide`, { approve: true })).status).toBe(200);
  });

  it('D-05: refuses to approve your own discount request', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '100000', mandatory: true }]);
    const p = await createPupil(bursar, w, 'Own Discount');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const c = (await chargesOf(bursar, p.id))[0];
    expect((await both.post(`/api/charges/${c.id}/discounts`, { amount: '10000', reason: 'Sibling discount' })).status).toBe(200);
    const d = (await both.get(`/api/charges/${c.id}`)).body.discounts[0];
    const mine = await both.post(`/api/charges/discounts/${d.id}/decide`, { approve: true });
    expect(mine.status).toBe(403);
    expect(mine.body.error.message).toMatch(own);
  });

  it('D-05: refuses to approve your own payment reversal', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '100000', mandatory: true }]);
    const p = await createPupil(bursar, w, 'Own Reversal');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const c = (await chargesOf(bursar, p.id))[0];
    const r = await pay(both, p.id, [{ chargeId: c.id, amount: '40000' }]);
    const rev = await both.post(`/api/payments/${r.body.id}/reversal`, { reason: 'Cheque bounced' });
    const mine = await both.post(`/api/payments/reversals/${rev.body.id}/decide`, { approve: true });
    expect(mine.status).toBe(403);
    expect(mine.body.error.message).toMatch(own);
  });

  it('D-05: refuses to approve your own term close', async () => {
    const s = await both.post(`/api/term-close/${w.terms.t1}/prepare`, { confirm: true });
    const mine = await both.post(`/api/term-close/snapshots/${s.body.id}/decide`, { approve: true });
    expect(mine.status).toBe(403);
    expect(mine.body.error.message).toMatch(own);
  });
});
