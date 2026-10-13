import { beforeEach, describe, expect, it } from 'vitest';
import { bill, chargesOf, createPupil, key, login, pay, resetDb, setFees, type Client, type World } from './helpers';

let w: World;
let bursar: Client;
let head: Client;

async function standardFees(termId: number) {
  await setFees(bursar, termId, w.classes.p1, [
    { feeItemId: w.items.ADMISSION, amount: '100000', mandatory: true },
    { feeItemId: w.items.SCHOOL_FEES, amount: '450000', mandatory: true },
    { feeItemId: w.items.UNIFORM, amount: '80000', mandatory: false },
    { feeItemId: w.items.SWIMMING, amount: '30000', mandatory: false },
  ]);
}

beforeEach(async () => {
  w = await resetDb();
  bursar = await login('bursar');
  head = await login('head');
});

describe('term billing (FR-1001 to FR-1006, WR-07, D-04)', () => {
  it('explains which precondition failed when counts are zero (FR-1004)', async () => {
    const res = await bursar.post('/api/billing/preview', { termId: w.terms.t1, classId: w.classes.p1 });
    expect(res.body.counts).toMatchObject({ feeItems: 0, activePupils: 0, proposedRows: 0 });
    expect(res.body.diagnostics.join(' ')).toMatch(/No fee structure/);
    expect(res.body.diagnostics.join(' ')).toMatch(/no Active pupils/);
  });

  it('proposes fee lines × active pupils only (FR-1002, FR-207)', async () => {
    await standardFees(w.terms.t1);
    await createPupil(bursar, w, 'Active One');
    await createPupil(bursar, w, 'Active Two');
    const left = await createPupil(bursar, w, 'Left Pupil');
    await bursar.post(`/api/pupils/${left.id}/status`, { status: 'TRANSFERRED', effectiveDate: '2026-01-25', leavingReason: 'TRANSFERRED', confirm: true });
    const res = await bursar.post('/api/billing/preview', { termId: w.terms.t1, classId: w.classes.p1 });
    expect(res.body.counts).toMatchObject({ feeItems: 4, activePupils: 2, proposedRows: 8 });
    expect(res.body.totalAmount).toBe('1320000.00');
  });

  it('posts reviewed rows, removes optional items and blocks removing mandatory ones (FR-1005, A-08)', async () => {
    await standardFees(w.terms.t1);
    const p = await createPupil(bursar, w, 'Review Pupil');
    const blocked = await bursar.post('/api/billing/post', { termId: w.terms.t1, classId: w.classes.p1, idempotencyKey: key(), confirm: true, rows: [{ key: `${p.id}:${w.items.SCHOOL_FEES}`, include: false }] });
    expect(blocked.status).toBe(400);
    const res = await bill(bursar, w.terms.t1, w.classes.p1, [{ key: `${p.id}:${w.items.SWIMMING}`, include: false }]);
    expect(res.created).toBe(3);
    expect(res.skipped).toHaveLength(1);
  });

  it('is idempotent and never creates duplicates (WR-07)', async () => {
    await standardFees(w.terms.t1);
    await createPupil(bursar, w, 'Idem Pupil');
    const k = key();
    const body = { termId: w.terms.t1, classId: w.classes.p1, idempotencyKey: k, confirm: true };
    const [a, b] = await Promise.all([bursar.post('/api/billing/post', body), bursar.post('/api/billing/post', body)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.batchId).toBe(b.body.batchId);
    const again = await bill(bursar, w.terms.t1, w.classes.p1);
    expect(again.created).toBe(0);
    expect(again.skipped.every((s: { reason: string }) => /this term/.test(s.reason))).toBe(true);
  });

  it('respects Once Only and Every Year frequencies across terms (D-04)', async () => {
    await standardFees(w.terms.t1);
    await standardFees(w.terms.t2);
    const p = await createPupil(bursar, w, 'Frequency Pupil');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const preview = await bursar.post('/api/billing/preview', { termId: w.terms.t2, classId: w.classes.p1 });
    const reason = (code: string) => preview.body.rows.find((r: { feeItemId: number }) => r.feeItemId === w.items[code]).skipReason;
    expect(reason('ADMISSION')).toMatch(/Once-only/);
    expect(reason('UNIFORM')).toMatch(/Yearly/);
    expect(reason('SCHOOL_FEES')).toBeNull();
    // An authorised override with a reason charges it anyway.
    const res = await bill(bursar, w.terms.t2, w.classes.p1, [{ key: `${p.id}:${w.items.UNIFORM}`, overrideReason: 'Second uniform set ordered' }]);
    expect(res.created).toBe(3);
    const t2 = await chargesOf(bursar, p.id, w.terms.t2);
    expect(t2.map((c) => c.feeItemName).sort()).toEqual(['School Fees', 'School Uniform', 'Swimming']);
  });

  it('requires fees to exist before billing (BR-15)', async () => {
    await createPupil(bursar, w, 'No Fees');
    const res = await bursar.post('/api/billing/post', { termId: w.terms.t1, classId: w.classes.p1, idempotencyKey: key(), confirm: true });
    expect(res.status).toBe(400);
  });
});

describe('payments, balances and receipts (FR-501 to FR-606, FR-1201 to FR-1206)', () => {
  let pupilId: number;
  let fees: Record<string, any>;
  beforeEach(async () => {
    await standardFees(w.terms.t1);
    pupilId = (await createPupil(bursar, w, 'Payer Pupil')).id;
    await bill(bursar, w.terms.t1, w.classes.p1);
    fees = Object.fromEntries((await chargesOf(bursar, pupilId)).map((c) => [c.feeItemName, c]));
  });

  it('starts Unpaid, goes Partial, then Paid (BR-04 to BR-06, E2E-05/06)', async () => {
    const sf = fees['School Fees'];
    expect(sf.status).toBe('UNPAID');
    await pay(bursar, pupilId, [{ chargeId: sf.id, amount: '200000' }]);
    let c = (await bursar.get(`/api/charges/${sf.id}`)).body;
    expect(c).toMatchObject({ status: 'PARTIAL', totalPaid: '200000.00', balance: '250000.00' });
    await pay(bursar, pupilId, [{ chargeId: sf.id, amount: '250000' }]);
    c = (await bursar.get(`/api/charges/${sf.id}`)).body;
    expect(c).toMatchObject({ status: 'PAID', balance: '0.00' });
  });

  it('issues one receipt number for several fee items (D-06, FR-1203)', async () => {
    const res = await pay(bursar, pupilId, [
      { chargeId: fees['School Fees'].id, amount: '450000' },
      { chargeId: fees['Admission Fees'].id, amount: '100000' },
      { chargeId: fees['Swimming'].id, amount: '10000' },
    ], { reference: 'MM-123', method: 'MOBILE_MONEY' });
    expect(res.status).toBe(200);
    expect(res.body.receiptNo).toMatch(/^RCT-2026-\d{5}$/);
    const r = (await bursar.get(`/api/payments/receipts/${res.body.receiptNo}`)).body;
    expect(r.lines).toHaveLength(3);
    expect(r.total).toBe('560000.00');
    expect(r).toMatchObject({ methodLabel: 'Mobile Money', reference: 'MM-123', receivedByName: 'Bursar User' });
    expect(r.pupil).toMatchObject({ fullName: 'Payer Pupil', className: 'P1', guardianName: 'Parent of Payer Pupil' });
    expect(r.termLabel).toBe('Term 1 2026');
  });

  it('never issues the same receipt number twice, even concurrently (BR-18)', async () => {
    const results = await Promise.all(
      [fees['School Fees'], fees['Admission Fees'], fees['School Uniform'], fees['Swimming']].map((c) => pay(bursar, pupilId, [{ chargeId: c.id, amount: '1000' }])),
    );
    const numbers = results.map((r) => r.body.receiptNo);
    expect(new Set(numbers).size).toBe(4);
  });

  it('does not double-record a double-clicked payment', async () => {
    const k = key();
    const body = { pupilId, paymentDate: '2026-03-01', method: 'CASH', idempotencyKey: k, lines: [{ chargeId: fees['School Fees'].id, amount: '5000' }] };
    const [a, b] = await Promise.all([bursar.post('/api/payments', body), bursar.post('/api/payments', body)]);
    expect(a.body.receiptNo).toBe(b.body.receiptNo);
  });

  it('warns about overpayment and shows a credit (A-10, FR-507)', async () => {
    const id = fees['Swimming'].id;
    const first = await pay(bursar, pupilId, [{ chargeId: id, amount: '35000' }]);
    expect(first.status).toBe(400);
    expect(first.body.error.code).toBe('OVERPAYMENT');
    const ok = await pay(bursar, pupilId, [{ chargeId: id, amount: '35000' }], { acknowledgeOverpayment: true });
    expect(ok.status).toBe(200);
    expect(ok.body.warnings.join(' ')).toMatch(/credit/);
    const c = (await bursar.get(`/api/charges/${id}`)).body;
    expect(c).toMatchObject({ balance: '-5000.00', status: 'PAID' });
  });

  it('refuses payments to another pupil’s charge or with no allocation (BR-17, A-09)', async () => {
    const other = await createPupil(bursar, w, 'Other Pupil');
    expect((await pay(bursar, other.id, [{ chargeId: fees['School Fees'].id, amount: '100' }])).status).toBe(400);
    expect((await pay(bursar, pupilId, [])).status).toBe(400);
  });

  it('reverses a payment only with approval from someone else (WR-09, D-05)', async () => {
    const sf = fees['School Fees'];
    const r = await pay(bursar, pupilId, [{ chargeId: sf.id, amount: '450000' }]);
    const reversal = await bursar.post(`/api/payments/${r.body.id}/reversal`, { reason: 'Cheque bounced' });
    expect(reversal.status).toBe(200);
    // Still counts until approved.
    expect((await bursar.get(`/api/charges/${sf.id}`)).body.status).toBe('PAID');
    expect((await bursar.post(`/api/payments/reversals/${reversal.body.id}/decide`, { approve: true })).status).toBe(403);
    const bursar2 = await login('bursar2');
    expect((await bursar2.post(`/api/payments/reversals/${reversal.body.id}/decide`, { approve: true })).status).toBe(403);
    expect((await head.post(`/api/payments/reversals/${reversal.body.id}/decide`, { approve: true })).status).toBe(200);
    const after = (await bursar.get(`/api/charges/${sf.id}`)).body;
    expect(after).toMatchObject({ status: 'UNPAID', totalPaid: '0.00' });
    const receipt = (await bursar.get(`/api/payments/receipts/${r.body.receiptNo}`)).body;
    expect(receipt.reversed).toBe(true);
  });

  it('searches payments by receipt, pupil, method and date (WR-10)', async () => {
    await pay(bursar, pupilId, [{ chargeId: fees['School Fees'].id, amount: '1000' }], { method: 'CHEQUE', paymentDate: '2026-02-10' });
    await pay(bursar, pupilId, [{ chargeId: fees['School Fees'].id, amount: '2000' }], { method: 'CASH', paymentDate: '2026-03-10' });
    expect((await bursar.get('/api/payments?method=CHEQUE')).body.total).toBe(1);
    expect((await bursar.get('/api/payments?from=2026-03-01&to=2026-03-31')).body.total).toBe(1);
    expect((await bursar.get('/api/payments?search=Payer')).body.total).toBe(2);
    const csv = await bursar.get('/api/payments?format=csv');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toMatch(/Receipt No/);
  });
});

describe('discounts and waivers (FR-502, WR-05, WR-06)', () => {
  it('counts a discount only after another person approves it', async () => {
    await standardFees(w.terms.t1);
    const p = await createPupil(bursar, w, 'Discount Pupil');
    await bill(bursar, w.terms.t1, w.classes.p1, [{ key: `${p.id}:${w.items.SCHOOL_FEES}`, discount: '50000', discountReason: 'Staff child' }]);
    const sf = (await chargesOf(bursar, p.id)).find((c) => c.feeItemName === 'School Fees')!;
    expect(sf).toMatchObject({ discount: '0.00', pendingDiscount: '50000.00', netDue: '450000.00' });
    const detail = (await bursar.get(`/api/charges/${sf.id}`)).body;
    const discountId = detail.discounts[0].id;
    expect((await bursar.post(`/api/charges/discounts/${discountId}/decide`, { approve: true })).status).toBe(403);
    expect((await head.post(`/api/charges/discounts/${discountId}/decide`, { approve: true })).status).toBe(200);
    const after = (await bursar.get(`/api/charges/${sf.id}`)).body;
    expect(after).toMatchObject({ discount: '50000.00', netDue: '400000.00', balance: '400000.00' });
  });

  it('blocks discounts larger than the charge (WR-06)', async () => {
    await standardFees(w.terms.t1);
    const p = await createPupil(bursar, w, 'Big Discount');
    await bill(bursar, w.terms.t1, w.classes.p1);
    const sw = (await chargesOf(bursar, p.id)).find((c) => c.feeItemName === 'Swimming')!;
    expect((await bursar.post(`/api/charges/${sw.id}/discounts`, { amount: '30001', reason: 'Too much' })).status).toBe(400);
    expect((await bursar.post(`/api/charges/${sw.id}/discounts`, { amount: '30000', reason: 'Full waiver' })).status).toBe(200);
  });
});

describe('arrears list and statements (FR-1301 to FR-1405)', () => {
  it('lists pupils with balances and contact details, and builds a statement', async () => {
    await standardFees(w.terms.t1);
    const a = await createPupil(bursar, w, 'Arrears Alice');
    const b = await createPupil(bursar, w, 'Settled Bob');
    await bill(bursar, w.terms.t1, w.classes.p1, [
      { key: `${a.id}:${w.items.SWIMMING}`, include: false }, { key: `${a.id}:${w.items.UNIFORM}`, include: false },
      { key: `${b.id}:${w.items.SWIMMING}`, include: false }, { key: `${b.id}:${w.items.UNIFORM}`, include: false },
    ]);
    const bCharges = await chargesOf(bursar, b.id);
    await pay(bursar, b.id, bCharges.map((c) => ({ chargeId: c.id, amount: c.balance })));
    const aCharges = await chargesOf(bursar, a.id);
    await pay(bursar, a.id, [{ chargeId: aCharges.find((c) => c.feeItemName === 'School Fees')!.id, amount: '150000' }]);

    const list = (await bursar.get(`/api/collections/arrears?termId=${w.terms.t1}`)).body;
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({ pupilName: 'Arrears Alice', totalBilled: '550000.00', totalPaid: '150000.00', outstanding: '400000.00', unpaidItems: 2, statusLabel: 'Partial', phonePrimary: '0772123456' });
    const all = (await bursar.get(`/api/collections/arrears?termId=${w.terms.t1}&onlyOutstanding=false`)).body;
    expect(all.rows.find((r: { pupilName: string }) => r.pupilName === 'Settled Bob').statusLabel).toBe('Paid in Full');

    const st = (await bursar.get(`/api/collections/statements/${a.id}`)).body;
    expect(st.charges).toHaveLength(2);
    expect(st.totals).toMatchObject({ totalBilled: '550000.00', totalPaid: '150000.00', outstanding: '400000.00', statusLabel: 'Partial' });
    expect(st.payments[0]).toMatchObject({ amount: '150000.00', feeItemName: 'School Fees' });
  });
});
