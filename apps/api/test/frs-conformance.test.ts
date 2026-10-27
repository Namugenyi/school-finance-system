/**
 * Independent FRS STJA-FRS-v12 conformance suite (testing thread, not part of the build).
 * Each test name starts with the FRS / decision IDs it checks.
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

const labels = (xs: Array<{ label?: string; name?: string }>) => xs.map((x) => x.label ?? x.name);

async function approvedExpense(over: object = {}) {
  const e = await bursar.post('/api/expenses', {
    expenseDate: '2026-03-10', termId: w.terms.t1, category: 'ELECTRICITY', description: 'Power', amount: '100000',
    supplier: 'UMEME', method: 'CASH', invoiceRef: `INV-${Math.random()}`, fundingSource: 'SCHOOL_FUNDS', ...over,
  });
  expect(e.status, JSON.stringify(e.body)).toBe(200);
  const d = await head.post(`/api/expenses/${e.body.id}/decide`, { approve: true });
  expect(d.status).toBe(200);
  return e.body;
}

describe('Reference data (FR-100, FR-404, FR-603, FR-705, FR-702, FR-801, FR-204, FR-403)', () => {
  it('FR-404: fee item vocabulary is exactly the 12 FRS items', async () => {
    const l = (await bursar.get('/api/setup/lookups')).body;
    expect(labels(l.feeItems).sort()).toEqual([
      'Admission Fees', 'School Fees', 'Requirements', 'School Uniform', 'Holiday Package', 'Breakfast and Lunch', 'Reading Materials',
      'Swimming', 'Kids Day Out', 'Afternoon Stay', 'Boarding Fee', 'Arrears B/F',
    ].sort());
  });
  it('FR-603: payment methods are Cash, Mobile Money, Bank Transfer, Cheque', async () => {
    const l = (await bursar.get('/api/setup/lookups')).body;
    expect(labels(l.lists.PAYMENT_METHOD)).toEqual(['Cash', 'Mobile Money', 'Bank Transfer', 'Cheque']);
  });
  it('FR-705: expense categories are the 12 FRS categories', async () => {
    const l = (await bursar.get('/api/setup/lookups')).body;
    expect(labels(l.lists.EXPENSE_CATEGORY)).toEqual(['Rent', 'Electricity', 'Water', 'Salaries', 'Taxes', 'District Licenses', 'Transport', 'Construction', 'Food and Drinks', 'Cooking Charcoal', 'Repairs and Maintenance', 'Miscellaneous']);
  });
  it('FR-702: funding sources are School Funds, Owner Contribution, Owner Loan, Donation, Other', async () => {
    const l = (await bursar.get('/api/setup/lookups')).body;
    expect(labels(l.lists.FUNDING_SOURCE)).toEqual(['School Funds', 'Owner Contribution', 'Owner Loan', 'Donation', 'Other']);
  });
  it('FR-801: contribution types are Cash Contribution, Expense Paid Directly, Loan', async () => {
    const l = (await bursar.get('/api/setup/lookups')).body;
    expect(labels(l.lists.CONTRIBUTION_TYPE)).toEqual(['Cash Contribution', 'Expense Paid Directly', 'Loan']);
  });
  it('FR-204 (as changed by the school, 27/10/2026): pupil statuses are Active and Alumni', async () => {
    const l = (await bursar.get('/api/setup/lookups')).body;
    expect(labels(l.lists.PUPIL_STATUS)).toEqual(['Active', 'Alumni']);
  });
  it('FR-403 / FR-402: charge frequency and Mandatory/Optional lists', async () => {
    const l = (await bursar.get('/api/setup/lookups')).body;
    expect(labels(l.lists.CHARGE_FREQUENCY)).toEqual(['Once Only', 'Every Term', 'Every Year']);
    expect(labels(l.lists.MANDATORY_OPTIONAL)).toEqual(['Mandatory', 'Optional']);
  });
  it('FR-105: KG and Primary classes are separable by section', async () => {
    const l = (await bursar.get('/api/setup/lookups')).body;
    const kg = l.classes.filter((c: { sectionName: string }) => c.sectionName === 'Kindergarten').map((c: { name: string }) => c.name);
    const pri = l.classes.filter((c: { sectionName: string }) => c.sectionName === 'Primary').map((c: { name: string }) => c.name);
    expect(kg).toEqual(['Baby Class']);
    expect(pri).toEqual(['P1', 'P2']);
  });
  it('BR-24 / CTL-01: a coded value not in its list is rejected (payment method, funding source, sex)', async () => {
    const p = await createPupil(bursar, w, 'Coded Pupil');
    expect((await bursar.post('/api/pupils', { fullName: 'Bad Sex', sex: 'UNKNOWN', dateJoined: '2026-01-20', classId: w.classes.p1, guardianName: 'G', phonePrimary: '0772123456' })).status).toBe(400);
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '1000', mandatory: true }]);
    await bill(bursar, w.terms.t1, w.classes.p1);
    const c = (await chargesOf(bursar, p.id))[0];
    expect((await pay(bursar, p.id, [{ chargeId: c.id, amount: '10' }], { method: 'BITCOIN' })).status).toBe(400);
    expect((await bursar.post('/api/expenses', { expenseDate: '2026-03-10', termId: w.terms.t1, category: 'RENT', description: 'Rent payment', amount: '1', supplier: 's', method: 'CASH', invoiceRef: 'i', fundingSource: 'GRANT' })).status).toBe(400);
    expect((await bursar.post('/api/expenses', { expenseDate: '2026-03-10', termId: w.terms.t1, category: 'RENT', description: 'Rent payment', amount: '1', supplier: 's', method: 'CASH', invoiceRef: 'ok', fundingSource: 'SCHOOL_FUNDS' })).status).toBe(200); // control
    expect((await bursar.post('/api/expenses', { expenseDate: '2026-03-10', termId: w.terms.t1, category: 'PARTY', description: 'Rent payment', amount: '1', supplier: 's', method: 'CASH', invoiceRef: 'i', fundingSource: 'SCHOOL_FUNDS' })).status).toBe(400);
  });
  it('FR-103 / NFR-12: a new expense category is usable at once', async () => {
    const add = await admin.post('/api/setup/reference-lists/EXPENSE_CATEGORY/values', { code: 'STATIONERY', label: 'Stationery' });
    expect(add.status, JSON.stringify(add.body)).toBe(200);
    const e = await bursar.post('/api/expenses', { expenseDate: '2026-03-10', termId: w.terms.t1, category: 'STATIONERY', description: 'Pens', amount: '5000', supplier: 'Shop', method: 'CASH', invoiceRef: 'S1', fundingSource: 'SCHOOL_FUNDS' });
    expect(e.status).toBe(200);
  });
});

describe('Pupils and history (FR-200, FR-300)', () => {
  it('FR-202 / BR-13: identifiers are STJA-YYYY-NNNN, sequential and zero-padded', async () => {
    const a = await createPupil(bursar, w, 'First');
    const b = await createPupil(bursar, w, 'Second');
    expect(a.pupilCode).toBe('STJA-2026-0001');
    expect(b.pupilCode).toBe('STJA-2026-0002');
  });
  it('FR-202 / CTL-02: the pupil ID cannot be edited', async () => {
    const a = await createPupil(bursar, w, 'Locked Id');
    await bursar.patch(`/api/pupils/${a.id}`, { pupilCode: 'STJA-1999-9999', fullName: 'Locked Id' });
    expect((await bursar.get(`/api/pupils/${a.id}`)).body.pupilCode).toBe('STJA-2026-0001');
  });
  it('FR-206: guardian, both phones, address and emergency contact are stored', async () => {
    // Since 13/10/2026 the emergency contact has its own name, relationship and phone (Tina's request).
    const a = await createPupil(bursar, w, 'Contact Kid', w.classes.p1, { phoneAlt: '0701234567', address: 'Kasangati', emergencyName: 'Aunt Grace', emergencyRelationship: 'AUNT_UNCLE', emergencyPhone: '0782000000' });
    const p = (await bursar.get(`/api/pupils/${a.id}`)).body;
    expect(p).toMatchObject({ guardianName: 'Parent of Contact Kid', phonePrimary: '0772123456', phoneAlt: '0701234567', address: 'Kasangati' });
    expect(p).toMatchObject({ emergencyName: 'Aunt Grace', emergencyRelationship: 'AUNT_UNCLE', emergencyPhone: '0782000000' });
  });
  it('FR-207 / BR-16: Alumni pupils are not billed, whatever their reason for leaving', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '1000', mandatory: true }]);
    await createPupil(bursar, w, 'Stays');
    for (const r of ['WITHDRAWN_BY_PARENT', 'COMPLETED', 'TRANSFERRED']) {
      const p = await createPupil(bursar, w, `Left ${r}`);
      const res = await bursar.post(`/api/pupils/${p.id}/status`, { status: 'ALUMNI', effectiveDate: '2026-01-25', leavingReason: r, confirm: true });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    const prev = (await bursar.post('/api/billing/preview', { termId: w.terms.t1, classId: w.classes.p1 })).body;
    expect(prev.counts.activePupils).toBe(1);
  });
  it('FR-301 to FR-303 / CTL-10: promotion adds dated history and keeps the old placement', async () => {
    const a = await createPupil(bursar, w, 'Promoted');
    expect((await bursar.post(`/api/pupils/${a.id}/class`, { classId: w.classes.p2, effectiveDate: '2026-05-25', eventType: 'PROMOTED' })).status).toBe(200);
    await bursar.post(`/api/pupils/${a.id}/status`, { status: 'ALUMNI', effectiveDate: '2026-06-01', leavingReason: 'WITHDRAWN_BY_PARENT', confirm: true });
    const p = (await bursar.get(`/api/pupils/${a.id}`)).body;
    const h = p.history as Array<Record<string, any>>;
    expect(h.length).toBeGreaterThanOrEqual(3);
    const txt = JSON.stringify(h);
    expect(txt).toMatch(/P1/);
    expect(txt).toMatch(/P2/);
    expect(txt).toMatch(/2026-05-25|25\/05\/2026/);
    expect(p.dateLeft ?? txt).toBeTruthy();
    expect(txt).toMatch(/WITHDRAWN_BY_PARENT|Withdrawn by parent/);
  });
});

describe('Charges and payments (FR-500, FR-600, BR-01 to BR-06, BR-17, BR-18)', () => {
  it('BR-01..BR-06 / AC-05: full lifecycle including discount and credit', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '450000', mandatory: true }]);
    const p = await createPupil(bursar, w, 'Lifecycle');
    await bill(bursar, w.terms.t1, w.classes.p1, [{ key: `${p.id}:${w.items.SCHOOL_FEES}`, discount: '50000', discountReason: 'Bursary' }]);
    const d = (await prisma.chargeDiscount.findFirstOrThrow()).id;
    await head.post(`/api/charges/discounts/${d}/decide`, { approve: true });
    const c = (await chargesOf(bursar, p.id))[0];
    expect(c).toMatchObject({ amountCharged: '450000.00', discount: '50000.00', netDue: '400000.00', totalPaid: '0.00', balance: '400000.00', status: 'UNPAID' });
    await pay(bursar, p.id, [{ chargeId: c.id, amount: '100000' }]);
    await pay(bursar, p.id, [{ chargeId: c.id, amount: '100000' }]);
    expect((await bursar.get(`/api/charges/${c.id}`)).body).toMatchObject({ totalPaid: '200000.00', balance: '200000.00', status: 'PARTIAL' });
    await pay(bursar, p.id, [{ chargeId: c.id, amount: '200000' }]);
    expect((await bursar.get(`/api/charges/${c.id}`)).body).toMatchObject({ balance: '0.00', status: 'PAID' });
  });
  it('FR-601: many partial payments on one fee item are each recorded', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '450000', mandatory: true }]);
    const p = await createPupil(bursar, w, 'Partials');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const c = (await chargesOf(bursar, p.id))[0];
    for (let i = 0; i < 5; i++) expect((await pay(bursar, p.id, [{ chargeId: c.id, amount: '10000' }])).status).toBe(200);
    expect((await bursar.get(`/api/charges/${c.id}`)).body.totalPaid).toBe('50000.00');
    expect((await bursar.get(`/api/payments?pupilId=${p.id}`)).body.total).toBe(5);
  });
  it('FR-602: a payment records date, pupil, term, item, amount, method, reference and receiving officer', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '450000', mandatory: true }]);
    const p = await createPupil(bursar, w, 'Fields');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const c = (await chargesOf(bursar, p.id))[0];
    const r = await pay(bursar, p.id, [{ chargeId: c.id, amount: '1000' }], { method: 'BANK_TRANSFER', reference: 'BT-9' });
    const rec = (await bursar.get(`/api/payments/receipts/${r.body.receiptNo}`)).body;
    expect(rec).toMatchObject({ receiptNo: r.body.receiptNo, reference: 'BT-9', methodLabel: 'Bank Transfer', receivedByName: 'Bursar User', termLabel: 'Term 1 2026' });
    expect(JSON.stringify(rec)).toMatch(/2026-03-01|01\/03\/2026/);
    expect(rec.lines[0]).toMatchObject({ feeItemName: 'School Fees' });
  });
  it('BR-18 / FR-604 / D-06: the database itself refuses a duplicate receipt number', async () => {
    const idx = await prisma.$queryRaw<Array<{ indexdef: string }>>`SELECT indexdef FROM pg_indexes WHERE tablename = 'Receipt' AND indexdef ILIKE '%UNIQUE%receiptNo%'`;
    expect(idx.length).toBe(1);
  });
  it('BR-17: an amount of zero or negative is refused', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '450000', mandatory: true }]);
    const p = await createPupil(bursar, w, 'Zero');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const c = (await chargesOf(bursar, p.id))[0];
    expect((await pay(bursar, p.id, [{ chargeId: c.id, amount: '0' }])).status).toBe(400);
    expect((await pay(bursar, p.id, [{ chargeId: c.id, amount: '-5' }])).status).toBe(400);
  });
  it('CTL-04: balances are computed, never keyed (a PATCH cannot set totalPaid or balance)', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '450000', mandatory: true }]);
    const p = await createPupil(bursar, w, 'NoKey');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const c = (await chargesOf(bursar, p.id))[0];
    await bursar.patch(`/api/charges/${c.id}`, { totalPaid: '450000', balance: '0' });
    expect((await bursar.get(`/api/charges/${c.id}`)).body).toMatchObject({ totalPaid: '0.00', balance: '450000.00' });
  });
});

describe('Receipts (FR-1200)', () => {
  it('FR-1203: one receipt can itemise eleven fee items', async () => {
    const l = (await bursar.get('/api/setup/lookups')).body;
    const items = l.feeItems.filter((f: { code: string }) => f.code !== 'ARREARS_BF');
    expect(items).toHaveLength(11);
    await setFees(bursar, w.terms.t1, w.classes.p1, items.map((f: { id: number }) => ({ feeItemId: f.id, amount: '10000', mandatory: true })));
    const p = await createPupil(bursar, w, 'Eleven');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const cs = await chargesOf(bursar, p.id);
    expect(cs).toHaveLength(11);
    const r = await pay(bursar, p.id, cs.map((c) => ({ chargeId: c.id, amount: '10000' })));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const rec = (await bursar.get(`/api/payments/receipts/${r.body.receiptNo}`)).body;
    expect(rec.lines).toHaveLength(11);
    expect(rec.total).toBe('110000.00');
  });
  it('FR-1202: receipt shows school name, pupil ID and academic year/term', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '450000', mandatory: true }]);
    const p = await createPupil(bursar, w, 'Header');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const c = (await chargesOf(bursar, p.id))[0];
    const r = await pay(bursar, p.id, [{ chargeId: c.id, amount: '1000' }]);
    const rec = (await bursar.get(`/api/payments/receipts/${r.body.receiptNo}`)).body;
    expect(JSON.stringify(rec)).toMatch(/Supreme Tower Junior Academy/);
    expect(rec.pupil.pupilCode).toBe(p.pupilCode);
  });
});

describe('Term billing (FR-1000, BR-15)', () => {
  it('FR-1002: billing is the Cartesian product of fee lines and active pupils in the chosen class only', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [
      { feeItemId: w.items.SCHOOL_FEES, amount: '450000', mandatory: true },
      { feeItemId: w.items.REQUIREMENTS, amount: '50000', mandatory: true },
      { feeItemId: w.items.SWIMMING, amount: '30000', mandatory: false },
    ]);
    for (let i = 0; i < 3; i++) await createPupil(bursar, w, `P1 kid ${i}`);
    await createPupil(bursar, w, 'P2 kid', w.classes.p2);
    const prev = (await bursar.post('/api/billing/preview', { termId: w.terms.t1, classId: w.classes.p1 })).body;
    expect(prev.counts).toMatchObject({ feeItems: 3, activePupils: 3, proposedRows: 9 });
    const res = await bill(bursar, w.terms.t1, w.classes.p1);
    expect(res.created).toBe(9);
  });
  it('FR-1004: diagnostic when fees exist but no active pupils', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '450000', mandatory: true }]);
    const prev = (await bursar.post('/api/billing/preview', { termId: w.terms.t1, classId: w.classes.p1 })).body;
    expect(prev.counts.activePupils).toBe(0);
    expect(prev.diagnostics.join(' ')).toMatch(/Active pupils/i);
    expect(prev.diagnostics.join(' ')).not.toMatch(/No fee structure/);
  });
  it('FR-1005: a pupil-specific discount entered at review is attached to that pupil only', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '450000', mandatory: true }]);
    const a = await createPupil(bursar, w, 'Disc A');
    const b = await createPupil(bursar, w, 'Disc B');
    await bill(bursar, w.terms.t1, w.classes.p1, [{ key: `${a.id}:${w.items.SCHOOL_FEES}`, discount: '45000', discountReason: 'Sibling' }]);
    expect((await chargesOf(bursar, a.id))[0].pendingDiscount).toBe('45000.00');
    expect((await chargesOf(bursar, b.id))[0].pendingDiscount ?? '0.00').toBe('0.00');
  });
});

describe('Carry forward (FR-1100, BR-19, BR-20, D-01)', () => {
  it('BR-19: a credit balance is never carried forward', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '100000', mandatory: true }, { feeItemId: w.items.REQUIREMENTS, amount: '50000', mandatory: true }]);
    const p = await createPupil(bursar, w, 'Credit Kid');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const cs = await chargesOf(bursar, p.id);
    const sf = cs.find((c) => c.feeItemName === 'School Fees')!;
    await pay(bursar, p.id, [{ chargeId: sf.id, amount: '120000' }], { acknowledgeOverpayment: true });
    const prev = (await bursar.post('/api/carry-forward/preview', { sourceTermId: w.terms.t1, destTermId: w.terms.t2 })).body;
    expect(prev.counts).toMatchObject({ examined: 2, withBalance: 1 });
    expect(prev.totalArrears).toBe('50000.00');
  });
  it('FR-1104: counts of examined charges, charges with balance and total are shown before posting', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '100000', mandatory: true }]);
    for (let i = 0; i < 3; i++) await createPupil(bursar, w, `CF ${i}`);
    await bill(bursar, w.terms.t1, w.classes.p1);
    const prev = (await bursar.post('/api/carry-forward/preview', { sourceTermId: w.terms.t1, destTermId: w.terms.t2 })).body;
    expect(prev.counts).toMatchObject({ examined: 3, withBalance: 3 });
    expect(prev.totalArrears).toBe('300000.00');
  });
  it('D-01: after carry forward, arrears are not double counted in the destination term billed figure', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '100000', mandatory: true }]);
    await setFees(bursar, w.terms.t2, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '100000', mandatory: true }]);
    await createPupil(bursar, w, 'Double');
    await bill(bursar, w.terms.t1, w.classes.p1);
    await bursar.post('/api/carry-forward/post', { sourceTermId: w.terms.t1, destTermId: w.terms.t2, idempotencyKey: key(), confirm: true });
    await bill(bursar, w.terms.t2, w.classes.p1);
    const t2 = (await head.get(`/api/reports/summary?termId=${w.terms.t2}`)).body;
    expect(t2.totalBilled).toBe('100000.00');
    expect(t2.arrearsBroughtForward).toBe('100000.00');
    expect(t2.outstanding).toBe('200000.00');
    const year = (await head.get(`/api/reports/summary?academicYearId=${w.yearId}`)).body;
    expect(year.outstanding).toBe('200000.00');
    expect(year.totalBilled).toBe('200000.00');
  });
});

describe('Arrears list and statements (FR-1300, FR-1400)', () => {
  it('FR-1302: arrears list filters by year and by term, or all terms', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '100000', mandatory: true }]);
    await setFees(bursar, w.terms.t2, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '200000', mandatory: true }]);
    await createPupil(bursar, w, 'Filter');
    await bill(bursar, w.terms.t1, w.classes.p1);
    await bill(bursar, w.terms.t2, w.classes.p1);
    expect((await bursar.get(`/api/collections/arrears?termId=${w.terms.t1}`)).body.rows[0].outstanding).toBe('100000.00');
    expect((await bursar.get(`/api/collections/arrears?termId=${w.terms.t2}`)).body.rows[0].outstanding).toBe('200000.00');
    expect((await bursar.get(`/api/collections/arrears?academicYearId=${w.yearId}`)).body.rows[0].outstanding).toBe('300000.00');
    expect((await bursar.get('/api/collections/arrears')).body.rows[0].outstanding).toBe('300000.00');
  });
  it('FR-1303: arrears list shows guardian and both phone numbers', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '100000', mandatory: true }]);
    await createPupil(bursar, w, 'Phones', w.classes.p1, { phoneAlt: '0701234567' });
    await bill(bursar, w.terms.t1, w.classes.p1);
    const row = (await bursar.get('/api/collections/arrears')).body.rows[0];
    expect(row).toMatchObject({ guardianName: 'Parent of Phones', phonePrimary: '0772123456', phoneAlt: '0701234567' });
  });
  it('FR-1403: the statement aggregates charges across academic years', async () => {
    const y = await admin.post('/api/setup/years', { year: 2027 });
    expect(y.status, JSON.stringify(y.body)).toBe(200);
    const t = await admin.post('/api/setup/terms', { academicYearId: y.body.id, number: 1, startDate: '2027-02-01', endDate: '2027-04-30' });
    expect(t.status, JSON.stringify(t.body)).toBe(200);
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '100000', mandatory: true }]);
    await setFees(bursar, t.body.id, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '120000', mandatory: true }]);
    const p = await createPupil(bursar, w, 'Two Years');
    await bill(bursar, w.terms.t1, w.classes.p1);
    await bill(bursar, t.body.id, w.classes.p1);
    const st = (await bursar.get(`/api/collections/statements/${p.id}`)).body;
    expect(st.charges).toHaveLength(2);
    expect(st.totals).toMatchObject({ totalBilled: '220000.00', outstanding: '220000.00', statusLabel: 'Unpaid' });
  });
  it('FR-1402 / FR-1404: statement lines and payments carry every required field', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '100000', mandatory: true }]);
    const p = await createPupil(bursar, w, 'Fields Stmt');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const c = (await chargesOf(bursar, p.id))[0];
    const r = await pay(bursar, p.id, [{ chargeId: c.id, amount: '40000' }], { method: 'CHEQUE', reference: 'CHQ-1' });
    const st = (await bursar.get(`/api/collections/statements/${p.id}`)).body;
    expect(st.charges[0]).toMatchObject({ amountCharged: '100000.00', discount: '0.00', netDue: '100000.00', totalPaid: '40000.00', balance: '60000.00', status: 'PARTIAL' });
    expect(st.payments[0]).toMatchObject({ receiptNo: r.body.receiptNo, feeItemName: 'School Fees', amount: '40000.00', reference: 'CHQ-1' });
    expect(JSON.stringify(st.payments[0])).toMatch(/CHEQUE|Cheque/);
  });
});

describe('Expenses, owner funds and reporting (FR-700, FR-800, FR-1600, BR-07, BR-11, BR-12, BR-21, BR-23)', () => {
  it('BR-07 / BR-11 / BR-12: collection rate, total expenses and net result', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '400000', mandatory: true }]);
    const p = await createPupil(bursar, w, 'Rate');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const c = (await chargesOf(bursar, p.id))[0];
    await pay(bursar, p.id, [{ chargeId: c.id, amount: '100000' }]);
    await approvedExpense({ amount: '30000' });
    await approvedExpense({ amount: '20000', fundingSource: 'OWNER_CONTRIBUTION' });
    const s = (await head.get(`/api/reports/summary?termId=${w.terms.t1}`)).body;
    expect(s.collectionRate).toBe('0.2500');
    expect(s).toMatchObject({ schoolFundedExpenses: '30000.00', ownerFundedExpenses: '20000.00', totalExpenses: '50000.00', netResult: '50000.00' });
  });
  it('FR-701 / FR-706: expense keeps all FRS fields including approver', async () => {
    const e = await approvedExpense({ amount: '12345', supplier: 'NWSC', invoiceRef: 'W-1', category: 'WATER', description: 'Water bill' });
    const got = (await bursar.get(`/api/expenses/${e.id}`)).body;
    expect(got).toMatchObject({ category: 'WATER', supplier: 'NWSC', invoiceRef: 'W-1', description: 'Water bill', fundingSource: 'SCHOOL_FUNDS', approvedByName: 'Head User' });
    expect(got.amount).toBe('12345.00');
  });
  it('BR-21 / FR-803: owner loan is not income and does not raise the surplus', async () => {
    const before = (await head.get(`/api/reports/summary?termId=${w.terms.t1}`)).body.netResult;
    const r = await bursar.post('/api/owner-funds', { date: '2026-03-01', termId: w.terms.t1, type: 'LOAN', amount: '2000000', ownerName: 'Proprietor' });
    expect(r.status).toBe(200);
    expect((await head.get(`/api/reports/summary?termId=${w.terms.t1}`)).body.netResult).toBe(before);
    const inc = (await head.get(`/api/reports/income-statement?termId=${w.terms.t1}`)).body;
    expect(inc.totalIncome).toBe('0.00');
    expect(inc.belowTheLine.loansReceived).toBe('2000000.00');
  });
  it('BR-23 / FR-1605: income statement is cash-basis (billed but unpaid is not income)', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '400000', mandatory: true }]);
    const p = await createPupil(bursar, w, 'Cash');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const c = (await chargesOf(bursar, p.id))[0];
    await pay(bursar, p.id, [{ chargeId: c.id, amount: '150000' }]);
    await approvedExpense({ amount: '50000' });
    const inc = (await head.get(`/api/reports/income-statement?termId=${w.terms.t1}`)).body;
    const txt = JSON.stringify(inc);
    expect(txt).toMatch(/150000\.00/);
    expect(txt).not.toMatch(/400000\.00/);
    expect(txt).toMatch(/100000\.00/); // net surplus
  });
  it('FR-1601: collection-by-term lists every term with billed, collected, outstanding, rate', async () => {
    const rows = (await head.get('/api/reports/collection-by-term')).body;
    expect(rows).toHaveLength(3);
    for (const r of rows) for (const k of ['totalBilled', 'totalCollected', 'outstanding', 'collectionRate']) expect(r).toHaveProperty(k);
  });
  it('FR-1602: outstanding by class splits P1 and P2', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '100000', mandatory: true }]);
    await setFees(bursar, w.terms.t1, w.classes.p2, [{ feeItemId: w.items.SCHOOL_FEES, amount: '200000', mandatory: true }]);
    await createPupil(bursar, w, 'In P1');
    await createPupil(bursar, w, 'In P2', w.classes.p2);
    await bill(bursar, w.terms.t1, w.classes.p1);
    await bill(bursar, w.terms.t1, w.classes.p2);
    const rows = (await head.get(`/api/reports/outstanding-by-class?termId=${w.terms.t1}`)).body;
    const by = Object.fromEntries(rows.map((r: { className: string; outstanding: string }) => [r.className, r.outstanding]));
    expect(by).toMatchObject({ P1: '100000.00', P2: '200000.00' });
  });
  it('FR-1604 / AC-12: expenditure by category is split school vs owner funded', async () => {
    await approvedExpense({ amount: '10000', category: 'RENT', fundingSource: 'SCHOOL_FUNDS' });
    await approvedExpense({ amount: '20000', category: 'RENT', fundingSource: 'OWNER_LOAN' });
    const rows = (await head.get(`/api/reports/expenses-by-category?termId=${w.terms.t1}`)).body;
    expect(rows.find((r: { categoryLabel: string }) => r.categoryLabel === 'Rent')).toMatchObject({ schoolFunded: '10000.00', ownerFunded: '20000.00' });
  });
  it('FR-1606 / FR-1607: dashboard has all nine indicators for one term', async () => {
    const d = (await head.get(`/api/dashboard?termId=${w.terms.t1}`)).body;
    for (const k of ['activePupils', 'totalBilled', 'totalCollected', 'outstanding', 'totalExpenses', 'schoolFundedExpenses', 'ownerFundedExpenses', 'netResult', 'collectionRate']) {
      expect(d.figures, k).toHaveProperty(k);
    }
  });
});

describe('Payroll (FR-900, BR-08 to BR-10, BR-14, FRS 6.2)', () => {
  const paye = async (salary: string) => {
    await prisma.payrollEntry.deleteMany();
    await prisma.payrollRun.deleteMany();
    await prisma.staff.updateMany({ data: { status: 'INACTIVE' } });
    await bursar.post('/api/payroll/staff', { fullName: `S ${salary}`, jobRole: 'Teacher', employmentType: 'PERMANENT', basicSalary: salary, startDate: '2025-01-01' });
    const run = await bursar.post('/api/payroll/runs', { year: 2026, month: 3 });
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    return run.body.entries[0];
  };
  it('FRS 6.2: PAYE band boundaries (235,000 / 335,000 / 410,000) and above', async () => {
    const cases: Array<[string, string]> = [
      ['235000', '0.00'], ['235001', '0.10'], ['335000', '10000.00'], ['410000', '25000.00'], ['410001', '25000.30'], ['1000000', '202000.00'],
    ];
    for (const [salary, expected] of cases) expect((await paye(salary)).paye, `salary ${salary}`).toBe(expected);
  });
  it('BR-08 / BR-09 / BR-10: NSSF 5% and 10%, net = basic - NSSF employee - PAYE - other', async () => {
    const e = await paye('600000');
    expect(e).toMatchObject({ nssfEmployee: '30000.00', nssfEmployer: '60000.00', paye: '82000.00', net: '488000.00' });
  });
  it('FR-901 / FR-902 / BR-14: staff register fields and STF-NNN code', async () => {
    const s = await bursar.post('/api/payroll/staff', { fullName: 'Reg Staff', jobRole: 'Bursar', department: 'Admin', employmentType: 'CONTRACT', basicSalary: '700000', startDate: '2025-02-01' });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body).toMatchObject({ staffCode: 'STF-001', fullName: 'Reg Staff', jobRole: 'Bursar', department: 'Admin', employmentType: 'CONTRACT', basicSalary: '700000.00' });
    expect(JSON.stringify(s.body)).toMatch(/ACTIVE|Active/);
  });
  it('FR-905: a new effective-dated band set is used without code changes', async () => {
    // No default role holds payroll.rates; check which roles do, then grant it to the administrator as an admin would.
    const holders = await prisma.rolePermission.findMany({ where: { permission: 'payroll.rates' } });
    console.log('PAYROLL_RATES_HOLDERS', holders.length);
    await prisma.rolePermission.create({ data: { roleId: (await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } })).id, permission: 'payroll.rates' } });
    const admin2 = await login('admin');
    const res = await admin2.post('/api/payroll/rates', {
      effectiveFrom: '2026-03-01', nssfEmployeeRate: '0.05', nssfEmployerRate: '0.10',
      bands: [{ lowerBound: '0', upperBound: '300000', rate: '0' }, { lowerBound: '300000', upperBound: null, rate: '0.1' }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await paye('500000')).paye).toBe('20000.00');
  });
});

describe('Snapshots (FR-1500, BR-22, CTL-09)', () => {
  it('FR-1501 / FR-1503: snapshot holds all eight figures, the date and the officer', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '100000', mandatory: true }]);
    const p = await createPupil(bursar, w, 'Snap');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const c = (await chargesOf(bursar, p.id))[0];
    await pay(bursar, p.id, [{ chargeId: c.id, amount: '60000' }]);
    await approvedExpense({ amount: '10000' });
    await approvedExpense({ amount: '5000', fundingSource: 'OWNER_CONTRIBUTION' });
    const s = await bursar.post(`/api/term-close/${w.terms.t1}/prepare`, { confirm: true });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body).toMatchObject({ activePupils: 1, totalBilled: '100000.00', totalCollected: '60000.00', outstanding: '40000.00', schoolFundedExpenses: '10000.00', ownerFundedExpenses: '5000.00', totalExpenses: '15000.00', netResult: '45000.00', recordedByName: 'Bursar User' });
    expect(JSON.stringify(s.body)).toMatch(/2026-\d\d-\d\d/);
  });
});

describe('Capacity (NFR-11)', () => {
  it('NFR-11: 500 pupils, 1,000+ charges, 2,000 payments, 1,000 expenses and 50 staff; reports stay responsive', async () => {
    const t0 = Date.now();
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '400000', mandatory: true }, { feeItemId: w.items.REQUIREMENTS, amount: '50000', mandatory: true }]);
    const userId = w.users.bursar;
    const s = await prisma.schoolSettings.findFirstOrThrow();
    // Bulk-create pupils directly for speed (identity generation is tested elsewhere).
    await prisma.pupil.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({ pupilCode: `STJA-${s.pupilIdStartYear}-${String(i + 1).padStart(4, '0')}`, fullName: `Load Pupil ${i}`, sex: 'MALE', dateJoined: new Date('2026-01-20'), classId: w.classes.p1, status: 'ACTIVE', guardianName: 'G', phonePrimary: '0772123456', createdById: userId, updatedById: userId })),
    });
    const tBill = Date.now();
    const posted = await bill(bursar, w.terms.t1, w.classes.p1);
    const billMs = Date.now() - tBill;
    expect(posted.created).toBe(1000);
    const charges = await prisma.charge.findMany({ select: { id: true, pupilId: true } });
    const tPay = Date.now();
    for (let i = 0; i < 2000; i += 20) {
      await Promise.all(Array.from({ length: 20 }, (_, j) => {
        const ch = charges[(i + j) % charges.length];
        return pay(bursar, ch.pupilId, [{ chargeId: ch.id, amount: '1000' }]);
      }));
    }
    const payMs = Date.now() - tPay;
    expect(await prisma.receipt.count()).toBe(2000);
    await prisma.expense.createMany({
      data: Array.from({ length: 1000 }, (_, i) => ({ expenseNo: `EXP-L-${i}`, expenseDate: new Date('2026-03-10'), termId: w.terms.t1, category: 'RENT', description: 'Load', amount: 1000, supplier: 'S', method: 'CASH', invoiceRef: `L${i}`, fundingSource: 'SCHOOL_FUNDS', status: 'APPROVED', enteredById: userId, approvedById: w.users.head, approvedByName: 'Head User' })),
    });
    for (let i = 0; i < 50; i++) await bursar.post('/api/payroll/staff', { fullName: `Staff ${i}`, jobRole: 'Teacher', employmentType: 'PERMANENT', basicSalary: '500000', startDate: '2025-01-01' });
    const timings: Record<string, number> = { billMs, payMs };
    for (const [name, url] of [
      ['summary', `/api/reports/summary?termId=${w.terms.t1}`], ['arrears', '/api/collections/arrears'], ['dashboard', `/api/dashboard?termId=${w.terms.t1}`],
      ['statement', `/api/collections/statements/${charges[0].pupilId}`], ['expensesList', '/api/expenses?pageSize=50'], ['payments', '/api/payments?pageSize=50'],
    ]) {
      const t = Date.now();
      const r = await head.get(url);
      timings[name] = Date.now() - t;
      expect(r.status, `${name} ${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
    }
    const run = await bursar.post('/api/payroll/runs', { year: 2026, month: 3 });
    expect(run.body.entries).toHaveLength(50);
    const sum = (await head.get(`/api/reports/summary?termId=${w.terms.t1}`)).body;
    expect(sum.totalCollected).toBe('2000000.00');
    expect(sum.totalExpenses).toBe('1000000.00');
    console.log('NFR11_TIMINGS', JSON.stringify({ ...timings, totalMs: Date.now() - t0 }));
    for (const k of ['summary', 'arrears', 'dashboard', 'statement', 'expensesList', 'payments']) expect(timings[k], k).toBeLessThan(3000);
  }, 600_000);
});

describe('Edge cases around the approved decisions (D-01, D-04, D-05)', () => {
  it('D-01: reversing a payment on a charge already carried forward leaves the debt collectable', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '100000', mandatory: true }]);
    const p = await createPupil(bursar, w, 'Reverse After CF');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const sf = (await chargesOf(bursar, p.id))[0];
    const r = await pay(bursar, p.id, [{ chargeId: sf.id, amount: '40000' }]);
    await bursar.post('/api/carry-forward/post', { sourceTermId: w.terms.t1, destTermId: w.terms.t2, idempotencyKey: key(), confirm: true });
    const rev = await bursar.post(`/api/payments/${r.body.id}/reversal`, { reason: 'Bounced' });
    let outcome = `request ${rev.status}`;
    if (rev.status === 200) {
      const d = await head.post(`/api/payments/reversals/${rev.body.id}/decide`, { approve: true });
      outcome += ` decide ${d.status} ${JSON.stringify(d.body).slice(0, 160)}`;
    } else outcome += ` ${JSON.stringify(rev.body).slice(0, 160)}`;
    console.log('D01_REVERSAL_OUTCOME', outcome);
    const st = (await bursar.get(`/api/collections/statements/${p.id}`)).body;
    const paid = st.totals.totalPaid;
    console.log('D01_AFTER', JSON.stringify(st.totals), JSON.stringify(st.charges.map((c: any) => [c.feeItemName, c.termLabel, c.netDue, c.totalPaid, c.balance, c.status])));
    console.log('D01_ARREARS', JSON.stringify((await bursar.get('/api/collections/arrears')).body.rows.map((r: any) => [r.outstanding, r.unpaidItems])));
    for (const t of [w.terms.t1, w.terms.t2]) { const s = (await head.get(`/api/reports/summary?termId=${t}`)).body; console.log('D01_SUMMARY', t, s.totalBilled, s.totalCollected, s.outstanding, s.carriedForwardOut, s.arrearsBroughtForward); }
    const payOld = await pay(bursar, p.id, [{ chargeId: sf.id, amount: '40000' }]);
    console.log('D01_PAY_SOURCE', payOld.status, JSON.stringify(payOld.body).slice(0, 200));
    // Whatever the outcome, total owed must equal 100,000 minus whatever still counts as paid.
    expect(Number(st.totals.outstanding) + Number(paid)).toBe(100000);
    // The reinstated 40,000 must be collectable: either the reversal is blocked, or the money can be paid somewhere.
    // Chosen behaviour: the reinstated amount moves to the Arrears B/F charge, which takes the payment.
    const arrearsCharge = st.charges.find((c: any) => c.isArrears);
    const payArrears = arrearsCharge ? await pay(bursar, p.id, [{ chargeId: arrearsCharge.id, amount: '40000' }]) : { status: 0 };
    console.log('D01_PAY_ARREARS', payArrears.status);
    expect(rev.status === 400 || payOld.status === 200 || payArrears.status === 200, 'reinstated balance sits on a closed (carried-forward) charge that refuses payment').toBe(true);
  });
  it('D-01: a discount cannot be added to a charge that was carried forward', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '100000', mandatory: true }]);
    const p = await createPupil(bursar, w, 'Disc After CF');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const sf = (await chargesOf(bursar, p.id))[0];
    await bursar.post('/api/carry-forward/post', { sourceTermId: w.terms.t1, destTermId: w.terms.t2, idempotencyKey: key(), confirm: true });
    const res = await bursar.post(`/api/charges/${sf.id}/discounts`, { amount: '10000', reason: 'Late bursary' });
    expect(res.status).toBe(400);
  });
  it('D-04: a once-only fee is not charged again after the pupil is promoted to another class', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.ADMISSION, amount: '100000', mandatory: true }]);
    await setFees(bursar, w.terms.t2, w.classes.p2, [{ feeItemId: w.items.ADMISSION, amount: '100000', mandatory: true }]);
    const p = await createPupil(bursar, w, 'Promoted Once');
    await bill(bursar, w.terms.t1, w.classes.p1);
    await bursar.post(`/api/pupils/${p.id}/class`, { classId: w.classes.p2, effectiveDate: '2026-05-25', eventType: 'PROMOTED' });
    const prev = (await bursar.post('/api/billing/preview', { termId: w.terms.t2, classId: w.classes.p2 })).body;
    expect(prev.rows[0].skipReason).toMatch(/Once-only/);
  });
  it('D-05: a pending (unapproved) discount does not reduce billed or outstanding', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '100000', mandatory: true }]);
    await createPupil(bursar, w, 'Pending Disc');
    const p2 = await createPupil(bursar, w, 'Pending Disc 2');
    await bill(bursar, w.terms.t1, w.classes.p1, [{ key: `${p2.id}:${w.items.SCHOOL_FEES}`, discount: '20000', discountReason: 'x' }]);
    const s = (await head.get(`/api/reports/summary?termId=${w.terms.t1}`)).body;
    expect(s.totalBilled).toBe('200000.00');
    expect(s.outstanding).toBe('200000.00');
  });
  it('D-05: a rejected expense never counts', async () => {
    const e = await bursar.post('/api/expenses', { expenseDate: '2026-03-10', termId: w.terms.t1, category: 'RENT', description: 'Rent payment', amount: '5000', supplier: 's', method: 'CASH', invoiceRef: 'REJ', fundingSource: 'SCHOOL_FUNDS' });
    expect(e.status, JSON.stringify(e.body)).toBe(200);
    const d = await head.post(`/api/expenses/${e.body.id}/decide`, { approve: false, note: 'No invoice' });
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect((await head.get(`/api/reports/summary?termId=${w.terms.t1}`)).body.totalExpenses).toBe('0.00');
  });
  it('FR-1405: a pupil with only a credit shows Paid in Full, not as owing', async () => {
    await setFees(bursar, w.terms.t1, w.classes.p1, [{ feeItemId: w.items.SCHOOL_FEES, amount: '100000', mandatory: true }]);
    const p = await createPupil(bursar, w, 'Overpaid');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const sf = (await chargesOf(bursar, p.id))[0];
    await pay(bursar, p.id, [{ chargeId: sf.id, amount: '120000' }], { acknowledgeOverpayment: true });
    const st = (await bursar.get(`/api/collections/statements/${p.id}`)).body;
    expect(st.totals.statusLabel).toBe('Paid in Full');
    expect(st.totals.outstanding).toBe('-20000.00');
    const list = (await bursar.get('/api/collections/arrears')).body.rows;
    expect(list).toHaveLength(0);
  });
});
