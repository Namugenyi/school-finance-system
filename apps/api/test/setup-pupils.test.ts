import { beforeAll, describe, expect, it } from 'vitest';
import { createPupil, login, resetDb, type Client, type World } from './helpers';
import { prisma } from '../src/db';

let w: World;
let admin: Client;
let bursar: Client;
beforeAll(async () => {
  w = await resetDb();
  admin = await login('admin');
  bursar = await login('bursar');
});

describe('reference data (FR-101 to FR-107)', () => {
  it('has all sixteen FRS vocabularies available', async () => {
    const res = await bursar.get('/api/setup/lookups');
    const l = res.body;
    expect(l.years.length).toBeGreaterThan(0); // Academic Year
    expect(l.terms.length).toBe(3); // Term
    expect(l.sections.map((s: { code: string }) => s.code)).toEqual(['KG', 'PRIMARY']); // Section
    expect(l.classes.length).toBe(3); // All / KG / Primary classes (class carries its section)
    expect(l.feeItems.map((f: { name: string }) => f.name)).toContain('Arrears B/F'); // Fee Items
    for (const code of ['MANDATORY_OPTIONAL', 'CHARGE_FREQUENCY', 'PAYMENT_METHOD', 'PAYMENT_STATUS', 'PUPIL_STATUS', 'EXPENSE_CATEGORY', 'FUNDING_SOURCE', 'CONTRIBUTION_TYPE', 'SEX']) {
      expect(l.lists[code]?.length, code).toBeGreaterThan(0);
    }
    expect(l.feeItems).toHaveLength(12);
    expect(l.lists.EXPENSE_CATEGORY).toHaveLength(12);
  });

  it('makes a new value usable immediately and rejects values not in the list (FR-103, BR-24)', async () => {
    const bad = await bursar.post('/api/expenses', { expenseDate: '2026-03-01', termId: w.terms.t1, category: 'STATIONERY', description: 'Chalk', amount: '1000', method: 'CASH', fundingSource: 'SCHOOL_FUNDS' });
    expect(bad.status).toBe(400);
    const add = await admin.post('/api/setup/reference-lists/EXPENSE_CATEGORY/values', { label: 'Stationery' });
    expect(add.status).toBe(200);
    const ok = await bursar.post('/api/expenses', { expenseDate: '2026-03-01', termId: w.terms.t1, category: 'STATIONERY', description: 'Chalk', amount: '1000', method: 'CASH', fundingSource: 'SCHOOL_FUNDS' });
    expect(ok.status).toBe(200);
  });

  it('prevents duplicate values and additions to fixed lists', async () => {
    expect((await admin.post('/api/setup/reference-lists/EXPENSE_CATEGORY/values', { label: 'stationery' })).status).toBe(409);
    expect((await admin.post('/api/setup/reference-lists/PUPIL_STATUS/values', { label: 'Suspended' })).status).toBe(400);
  });

  it('does not let system values be deactivated (A-07)', async () => {
    const v = await prisma.referenceValue.findFirstOrThrow({ where: { code: 'SALARIES' } });
    expect((await admin.patch(`/api/setup/reference-values/${v.id}`, { active: false })).status).toBe(400);
    expect((await admin.patch(`/api/setup/reference-values/${v.id}`, { label: 'Staff Salaries' })).status).toBe(200);
  });

  it('stores the academic year as one four-digit year (FR-106)', async () => {
    expect((await admin.post('/api/setup/years', { year: 26 })).status).toBe(400);
    expect((await admin.post('/api/setup/years', { year: 2026 })).status).toBe(409);
    expect((await admin.post('/api/setup/years', { year: 2027 })).status).toBe(200);
  });

  it('rejects overlapping term dates', async () => {
    const year = await prisma.academicYear.findUniqueOrThrow({ where: { year: 2027 } });
    const res = await admin.post('/api/setup/terms', { academicYearId: year.id, number: 1, startDate: '2026-11-01', endDate: '2027-03-01' });
    expect(res.status).toBe(409);
  });
});

describe('pupil register (FR-201 to FR-207)', () => {
  it('generates STJA-YYYY-NNNN from the start-year setting (FR-202)', async () => {
    const p = await createPupil(bursar, w, 'Amina Nakato');
    expect(p.pupilCode).toMatch(/^STJA-2026-\d{4}$/);
  });

  it('keeps the ID when dates change (FR-203)', async () => {
    const p = await createPupil(bursar, w, 'Brian Okello');
    const res = await bursar.patch(`/api/pupils/${p.id}`, { dateOfBirth: '2019-05-01', dateJoined: '2026-01-15' });
    expect(res.status).toBe(200);
    expect(res.body.pupilCode).toBe(p.pupilCode);
    expect((await bursar.patch(`/api/pupils/${p.id}`, { pupilCode: 'STJA-1999-0001' })).status).toBe(400);
  });

  it('restarts the sequence under a new start year (A-04)', async () => {
    await admin.patch('/api/setup/settings', { pupilIdStartYear: 2027 });
    const p = await createPupil(bursar, w, 'Cathy Atim');
    expect(p.pupilCode).toBe('STJA-2027-0001');
    await admin.patch('/api/setup/settings', { pupilIdStartYear: 2026 });
  });

  it('issues unique IDs under concurrent registration (IT-ID-03)', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => createPupil(bursar, w, `Concurrent Pupil ${i}`)));
    const codes = results.map((r) => r.pupilCode);
    expect(new Set(codes).size).toBe(12);
  });

  it('validates Ugandan phone numbers (A-12)', async () => {
    const res = await bursar.post('/api/pupils', { fullName: 'Phone Test', sex: 'MALE', dateJoined: '2026-01-10', classId: w.classes.p1, phonePrimary: '12345' });
    expect(res.status).toBe(400);
    const ok = await bursar.post('/api/pupils', { fullName: 'Phone Ok', sex: 'MALE', dateJoined: '2026-01-10', classId: w.classes.p1, phonePrimary: '+256 772 123 456' });
    expect(ok.body.phonePrimary).toBe('+256772123456');
  });

  it('only allows the five FRS statuses and asks for confirmation (FR-204, WR-29)', async () => {
    const p = await createPupil(bursar, w, 'Status Pupil');
    expect((await bursar.post(`/api/pupils/${p.id}/status`, { status: 'SUSPENDED', effectiveDate: '2026-03-01', confirm: true })).status).toBe(400);
    expect((await bursar.post(`/api/pupils/${p.id}/status`, { status: 'WITHDRAWN', effectiveDate: '2026-03-01', leavingReason: 'WITHDRAWN_BY_PARENT' })).status).toBe(400);
    expect((await bursar.post(`/api/pupils/${p.id}/status`, { status: 'WITHDRAWN', effectiveDate: '2026-03-01', confirm: true })).status).toBe(400); // needs a reason
    const ok = await bursar.post(`/api/pupils/${p.id}/status`, { status: 'WITHDRAWN', effectiveDate: '2026-03-01', leavingReason: 'WITHDRAWN_BY_PARENT', confirm: true });
    expect(ok.status).toBe(200);
    const detail = (await bursar.get(`/api/pupils/${p.id}`)).body;
    expect(detail.status).toBe('WITHDRAWN');
    expect(detail.dateLeft).toBe('2026-03-01');
  });
});

describe('parent / guardian and emergency contact', () => {
  it('keeps the two apart, each with a relationship from the Setup list', async () => {
    const lists = (await bursar.get('/api/setup/lookups')).body.lists;
    expect(lists.RELATIONSHIP.map((v: { label: string }) => v.label)).toEqual(['Mother', 'Father', 'Guardian', 'Grandparent', 'Sibling', 'Aunt / Uncle', 'Other']);
    const p = await createPupil(bursar, w, 'Two Contacts', w.classes.p1, {
      guardianRelationship: 'MOTHER', emergencyName: 'Sarah Nakato', emergencyRelationship: 'AUNT_UNCLE', emergencyPhone: '0782000000',
    });
    const got = (await bursar.get(`/api/pupils/${p.id}`)).body;
    expect(got).toMatchObject({ guardianName: 'Parent of Two Contacts', guardianRelationship: 'MOTHER', phonePrimary: '0772123456', emergencyName: 'Sarah Nakato', emergencyRelationship: 'AUNT_UNCLE', emergencyPhone: '0782000000' });
    const edited = await bursar.patch(`/api/pupils/${p.id}`, { emergencyRelationship: 'GRANDPARENT' });
    expect(edited.status).toBe(200);
    expect(edited.body.emergencyRelationship).toBe('GRANDPARENT');
  });

  it('rejects a relationship that is not in the list and a bad emergency phone (BR-24, A-12)', async () => {
    const base = { fullName: 'Bad Relation', sex: 'FEMALE', dateJoined: '2026-01-20', classId: w.classes.p1 };
    expect((await bursar.post('/api/pupils', { ...base, guardianRelationship: 'NEIGHBOUR' })).status).toBe(400);
    expect((await bursar.post('/api/pupils', { ...base, emergencyRelationship: 'NEIGHBOUR' })).status).toBe(400);
    expect((await bursar.post('/api/pupils', { ...base, emergencyPhone: '12345' })).status).toBe(400);
  });

  it('hides emergency contact details from roles without contact access', async () => {
    const p = await createPupil(bursar, w, 'Hidden Contact', w.classes.p1, { emergencyName: 'Secret Aunt', emergencyPhone: '0782000001' });
    const auditor = await login('auditor');
    const got = (await auditor.get(`/api/pupils/${p.id}`)).body;
    expect(got.contactsHidden).toBe(true);
    expect(got.emergencyName).toBeUndefined();
    expect(got.emergencyPhone).toBeUndefined();
  });
});

describe('pupil history (FR-301 to FR-303)', () => {
  it('keeps every placement when a pupil is promoted', async () => {
    const p = await createPupil(bursar, w, 'History Pupil');
    await bursar.post(`/api/pupils/${p.id}/class`, { classId: w.classes.p2, effectiveDate: '2026-05-25', eventType: 'PROMOTED' });
    const detail = (await bursar.get(`/api/pupils/${p.id}`)).body;
    expect(detail.className).toBe('P2');
    expect(detail.history.map((h: { eventType: string; className: string }) => `${h.eventType}:${h.className}`)).toEqual(['PROMOTED:P2', 'ENROLLED:P1']);
    expect(detail.history[0].termLabel).toBe('Term 2 2026');
  });

  it('does not allow class or status changes through a plain edit', async () => {
    const p = await createPupil(bursar, w, 'Sneaky Edit');
    expect((await bursar.patch(`/api/pupils/${p.id}`, { classId: w.classes.p2 })).status).toBe(400);
  });

  it('requires a reason to correct history and audits it', async () => {
    const p = await createPupil(bursar, w, 'Correction Pupil');
    const h = await prisma.pupilHistory.findFirstOrThrow({ where: { pupilId: p.id } });
    expect((await bursar.patch(`/api/pupils/${p.id}/history/${h.id}`, { effectiveDate: '2026-01-05' })).status).toBe(400);
    expect((await bursar.patch(`/api/pupils/${p.id}/history/${h.id}`, { effectiveDate: '2026-01-05', reason: 'Wrong date typed at enrolment' })).status).toBe(200);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'pupil.history_correct', entityId: String(h.id) } });
    expect(log.reason).toMatch(/Wrong date/);
  });

  it('promotes a whole class in one step', async () => {
    const a = await createPupil(bursar, w, 'Bulk A', w.classes.baby);
    const b = await createPupil(bursar, w, 'Bulk B', w.classes.baby);
    const res = await bursar.post('/api/pupils/promote', { fromClassId: w.classes.baby, toClassId: w.classes.p1, effectiveDate: '2026-05-25', pupilIds: [a.id, b.id] });
    expect(res.body.promoted).toBe(2);
  });
});

describe('fee structure (FR-401 to FR-405)', () => {
  it('prevents duplicate fee items for a class and term', async () => {
    const res = await bursar.put('/api/fees', {
      termId: w.terms.t1, classId: w.classes.p1,
      lines: [{ feeItemId: w.items.SCHOOL_FEES, amount: '450000', mandatory: true }, { feeItemId: w.items.SCHOOL_FEES, amount: '1', mandatory: true }],
    });
    expect(res.status).toBe(409);
  });

  it('rejects invalid amounts and Arrears B/F', async () => {
    expect((await bursar.put('/api/fees', { termId: w.terms.t1, classId: w.classes.p1, lines: [{ feeItemId: w.items.SCHOOL_FEES, amount: '-5', mandatory: true }] })).status).toBe(400);
    expect((await bursar.put('/api/fees', { termId: w.terms.t1, classId: w.classes.p1, lines: [{ feeItemId: w.items.ARREARS_BF, amount: '5', mandatory: true }] })).status).toBe(400);
  });

  it('saves and copies a term’s fees to the next term (A-23)', async () => {
    await bursar.put('/api/fees', { termId: w.terms.t1, classId: w.classes.p1, lines: [{ feeItemId: w.items.SCHOOL_FEES, amount: '450,000', mandatory: true }] });
    const res = await bursar.post('/api/fees/copy', { fromTermId: w.terms.t1, toTermId: w.terms.t2 });
    expect(res.body.copied).toBe(1);
    const lines = (await bursar.get(`/api/fees?termId=${w.terms.t2}&classId=${w.classes.p1}`)).body;
    expect(lines[0].amount).toBe('450000.00');
  });
});
