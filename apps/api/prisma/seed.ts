/**
 * Development and demo seed. Everything it creates is synthetic (WR-31): the school name is
 * marked DEMO, and names and phone numbers are made up. It drives the real API in-process, so
 * the demo data goes through the same validation and rules as data typed into the app.
 *
 *   npm run db:seed            base data + demo data (only into an empty database)
 *   SEED_DEMO=false npm run db:seed   base data only
 */
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/db';
import { createApp } from '../src/app';
import { seedBase } from '../src/seed/base';

export const DEMO_PASSWORD = 'Demo-pass-2026';
const app = createApp();

async function as(username: string) {
  const agent = request.agent(app);
  const login = await agent.post('/api/auth/login').send({ username, password: DEMO_PASSWORD });
  if (login.status !== 200) throw new Error(`Demo login failed for ${username}`);
  const csrf = (await agent.get('/api/auth/me')).body.csrfToken;
  const call = async (method: 'post' | 'put' | 'patch', url: string, body: object = {}) => {
    const res = await agent[method](url).set('x-csrf-token', csrf).send(body);
    if (res.status >= 400) throw new Error(`${method.toUpperCase()} ${url} failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  };
  return {
    get: async (url: string) => (await agent.get(url)).body,
    post: (url: string, body?: object) => call('post', url, body),
    put: (url: string, body?: object) => call('put', url, body),
    patch: (url: string, body?: object) => call('patch', url, body),
  };
}

// Small deterministic random generator so the demo is the same every time.
let seed = 20260213;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
let k = 0;
const key = () => `demo-${Date.now()}-${++k}`;

const FIRST = ['Amina', 'Brian', 'Catherine', 'Daniel', 'Esther', 'Francis', 'Grace', 'Henry', 'Irene', 'Joseph', 'Kevin', 'Lydia', 'Moses', 'Naomi', 'Oscar', 'Patience', 'Ronald', 'Sarah', 'Timothy', 'Vivian', 'Winnie', 'Allan', 'Brenda', 'Derrick', 'Faith', 'Gloria', 'Ivan', 'Joan', 'Mark', 'Precious'];
const LAST = ['Nakato', 'Okello', 'Namubiru', 'Ssempijja', 'Achieng', 'Mugisha', 'Nabirye', 'Kato', 'Atim', 'Lubega', 'Nansubuga', 'Opio', 'Babirye', 'Waiswa', 'Akello', 'Tumusiime', 'Nalwoga', 'Kizza', 'Auma', 'Mukasa'];

async function main() {
  await seedBase(prisma, { schoolName: 'Supreme Tower Junior Academy (DEMO DATA)', startYear: 2026 });
  if (process.env.SEED_DEMO === 'false') return console.log('Base data seeded.');
  if ((await prisma.pupil.count()) > 0 || (await prisma.user.count()) > 0) {
    return console.log('The database already has users or pupils, so demo data was not added.');
  }

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const roles = await prisma.role.findMany();
  for (const [username, fullName, role] of [
    ['admin', 'Agnes Administrator', 'ADMIN'],
    ['bursar', 'Ben Bursar', 'BURSAR'],
    ['head', 'Hellen Head Teacher', 'HEAD_TEACHER'],
    ['owner', 'Peter Proprietor', 'PROPRIETOR'],
    ['auditor', 'Alice Auditor', 'AUDITOR'],
  ]) {
    await prisma.user.create({ data: { username, fullName, passwordHash: hash, roles: { create: [{ roleId: roles.find((r) => r.code === role)!.id }] } } });
  }
  const admin = await as('admin');
  const bursar = await as('bursar');
  const head = await as('head');

  await admin.patch('/api/setup/settings', { address: 'Plot 12, Kasangati Town Council, Wakiso District', phone: '+256 700 000000', email: 'accounts@demo.stja.example', receiptFooter: 'DEMO receipt. Thank you for your payment.' });

  // Calendar and classes.
  const year = await admin.post('/api/setup/years', { year: 2026 });
  const terms = [
    await admin.post('/api/setup/terms', { academicYearId: year.id, number: 1, startDate: '2026-02-02', endDate: '2026-04-30' }),
    await admin.post('/api/setup/terms', { academicYearId: year.id, number: 2, startDate: '2026-05-25', endDate: '2026-08-14' }),
    await admin.post('/api/setup/terms', { academicYearId: year.id, number: 3, startDate: '2026-09-07', endDate: '2026-12-04' }),
  ];
  const lookups = await admin.get('/api/setup/lookups');
  const section = (code: string) => lookups.sections.find((s: { code: string }) => s.code === code).id;
  const classes: Array<{ id: number; name: string; kg: boolean }> = [];
  for (const [i, name] of ['Baby Class', 'Middle Class', 'Top Class'].entries()) classes.push({ ...(await admin.post('/api/setup/classes', { name, sectionId: section('KG'), sortOrder: i + 1 })), kg: true });
  for (let i = 1; i <= 7; i++) classes.push({ ...(await admin.post('/api/setup/classes', { name: `P${i}`, sectionId: section('PRIMARY'), sortOrder: i })), kg: false });
  const item = (code: string) => lookups.feeItems.find((f: { code: string }) => f.code === code).id;

  // Fee structure for term 1, copied to terms 2 and 3.
  for (const c of classes) {
    const tuition = c.kg ? 350000 : 450000 + 25000 * (Number(c.name.slice(1)) || 0);
    await bursar.put('/api/fees', {
      termId: terms[0].id,
      classId: c.id,
      lines: [
        { feeItemId: item('ADMISSION'), amount: '100000', mandatory: true },
        { feeItemId: item('SCHOOL_FEES'), amount: String(tuition), mandatory: true },
        { feeItemId: item('REQUIREMENTS'), amount: '60000', mandatory: true },
        { feeItemId: item('MEALS'), amount: '150000', mandatory: true },
        { feeItemId: item('UNIFORM'), amount: '85000', mandatory: false },
        { feeItemId: item('SWIMMING'), amount: '40000', mandatory: false },
        { feeItemId: item('AFTERNOON_STAY'), amount: '50000', mandatory: false },
      ],
    });
  }
  await bursar.post('/api/fees/copy', { fromTermId: terms[0].id, toTermId: terms[1].id });
  await bursar.post('/api/fees/copy', { fromTermId: terms[0].id, toTermId: terms[2].id });

  // Pupils.
  const pupils: Array<{ id: number; classId: number }> = [];
  for (let i = 0; i < 64; i++) {
    const cls = classes[i % classes.length];
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const p = await bursar.post('/api/pupils', {
      fullName: name, sex: rand() < 0.5 ? 'FEMALE' : 'MALE', dateOfBirth: `${cls.kg ? 2021 : 2016 - (Number(cls.name.slice(1)) || 0) + 1}-0${1 + Math.floor(rand() * 9)}-1${Math.floor(rand() * 9)}`,
      dateJoined: `2026-01-${String(10 + Math.floor(rand() * 18)).padStart(2, '0')}`, classId: cls.id,
      guardianName: `${pick(FIRST)} ${name.split(' ')[1]}`, guardianRelationship: ['MOTHER', 'FATHER', 'MOTHER', 'GUARDIAN', 'GRANDPARENT'][i % 5], phonePrimary: `07${String(70000000 + Math.floor(rand() * 9999999)).slice(0, 8)}`,
      phoneAlt: rand() < 0.4 ? `07${String(50000000 + Math.floor(rand() * 9999999)).slice(0, 8)}` : '', address: `${pick(['Kasangati', 'Gayaza', 'Kiteezi', 'Matugga', 'Wampewo'])}, Wakiso`,
      ...(rand() < 0.5 ? { emergencyName: `${pick(FIRST)} ${name.split(' ')[1]}`, emergencyRelationship: ['AUNT_UNCLE', 'GRANDPARENT', 'SIBLING'][i % 3], emergencyPhone: `0701000${100 + i}` } : {}),
    });
    pupils.push({ id: p.id, classId: cls.id });
  }

  const billTerm = async (termIndex: number) => {
    for (const c of classes) {
      const preview = await bursar.post('/api/billing/preview', { termId: terms[termIndex].id, classId: c.id });
      const rows = preview.rows
        .filter((r: { mandatory: boolean; skipReason: string | null }) => !r.mandatory && !r.skipReason && rand() < 0.5)
        .map((r: { key: string }) => ({ key: r.key, include: false }));
      // A few sibling discounts for the head teacher to approve.
      const sf = preview.rows.find((r: { feeItemId: number; skipReason: string | null }) => r.feeItemId === item('SCHOOL_FEES') && !r.skipReason);
      if (sf && rand() < 0.4) rows.push({ key: sf.key, discount: '50000', discountReason: 'Sibling discount' });
      await bursar.post('/api/billing/post', { termId: terms[termIndex].id, classId: c.id, idempotencyKey: key(), confirm: true, dueDate: preview.term ? undefined : undefined, rows });
    }
    const approvals = await head.get('/api/approvals');
    for (const a of approvals.filter((x: { type: string }) => x.type === 'DISCOUNT')) await head.post(`/api/charges/discounts/${a.id}/decide`, { approve: true });
  };

  const collect = async (termIndex: number, share: number, dates: string[]) => {
    for (const p of pupils) {
      const charges = (await bursar.get(`/api/payments/allocatable/${p.id}`)) as Array<{ id: number; balance: string; termId: number }>;
      const due = charges.filter((c) => c.termId === terms[termIndex].id || termIndex > 0);
      if (!due.length || rand() > share + 0.15) continue;
      const fullPayer = rand() < share;
      const lines = due
        .slice(0, 4)
        .map((c) => ({ chargeId: c.id, amount: fullPayer ? c.balance : String(Math.round((Number(c.balance) * (0.3 + rand() * 0.5)) / 1000) * 1000) }))
        .filter((l) => Number(l.amount) > 0);
      if (!lines.length) continue;
      await bursar.post('/api/payments', { pupilId: p.id, paymentDate: pick(dates), method: pick(['CASH', 'MOBILE_MONEY', 'MOBILE_MONEY', 'BANK_TRANSFER']), reference: `REF${Math.floor(rand() * 900000 + 100000)}`, idempotencyKey: key(), lines });
    }
  };

  const spend = async (termIndex: number, month: string) => {
    const list: Array<[string, string, string, string, string]> = [
      ['RENT', 'Premises rent', '1500000', 'Kasangati Properties Ltd', 'SCHOOL_FUNDS'],
      ['ELECTRICITY', 'UMEME electricity', '320000', 'UMEME', 'SCHOOL_FUNDS'],
      ['WATER', 'NWSC water bill', '180000', 'NWSC', 'SCHOOL_FUNDS'],
      ['FOOD_AND_DRINKS', 'Posho, beans and milk for pupils', '2400000', 'Kasangati Market Traders', 'SCHOOL_FUNDS'],
      ['COOKING_CHARCOAL', 'Charcoal for the kitchen', '450000', 'Local supplier', 'SCHOOL_FUNDS'],
      ['TRANSPORT', 'School van fuel', '600000', 'Total Energies Gayaza', 'SCHOOL_FUNDS'],
      ['CONSTRUCTION', 'New classroom block (phase)', '3500000', 'BuildRight Contractors', 'OWNER_LOAN'],
      ['REPAIRS_AND_MAINTENANCE', 'Roof repairs', '850000', 'Fundi Works', 'OWNER_CONTRIBUTION'],
      ['MISCELLANEOUS', 'Library books donated', '400000', 'Friends of STJA', 'DONATION'],
    ];
    const ids: number[] = [];
    for (const [i, [category, description, amount, supplier, fundingSource]] of list.entries()) {
      if (termIndex > 0 && category === 'CONSTRUCTION' && rand() < 0.5) continue;
      const e = await bursar.post('/api/expenses', {
        expenseDate: `${month}-${String(5 + i).padStart(2, '0')}`, termId: terms[termIndex].id, category, description, amount, supplier,
        method: pick(['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER']), invoiceRef: `INV-${termIndex + 1}${i}${Math.floor(rand() * 900 + 100)}`, fundingSource,
      });
      ids.push(e.id);
      if (fundingSource === 'OWNER_CONTRIBUTION') {
        await head.post(`/api/expenses/${e.id}/decide`, { approve: true });
        await bursar.post('/api/owner-funds', { date: `${month}-${String(5 + i).padStart(2, '0')}`, termId: terms[termIndex].id, type: 'EXPENSE_PAID_DIRECTLY', amount, ownerName: 'Peter Proprietor', description, expenseId: e.id });
      }
    }
    for (const id of ids) {
      const e = await bursar.get(`/api/expenses/${id}`);
      if (e.status === 'PENDING') await head.post(`/api/expenses/${id}/decide`, { approve: true });
    }
  };

  // Staff and payroll. The FRS rates are legacy: the demo marks them signed off so payroll can be shown.
  for (const [fullName, jobRole, employmentType, basicSalary] of [
    ['Rose Nambi', 'Head of Primary', 'PERMANENT', '1200000'], ['John Ssebunya', 'Class teacher', 'PERMANENT', '650000'],
    ['Mary Akello', 'Class teacher', 'PERMANENT', '600000'], ['Isaac Mutebi', 'Class teacher', 'CONTRACT', '550000'],
    ['Juliet Nakku', 'Nursery teacher', 'PERMANENT', '500000'], ['Sam Ochieng', 'Cook', 'CONTRACT', '300000'],
    ['Agnes Nakimuli', 'Matron', 'CONTRACT', '280000'], ['Paul Kigozi', 'Security guard', 'CASUAL', '250000'],
  ]) {
    await bursar.post('/api/payroll/staff', { fullName, jobRole, department: jobRole.includes('teacher') || jobRole.includes('Head') ? 'Teaching' : 'Support', employmentType, basicSalary, startDate: '2025-01-06' });
  }
  const rates = await prisma.statutoryRateSet.findFirstOrThrow();
  await prisma.statutoryRateSet.update({ where: { id: rates.id }, data: { validated: true, validatedBy: 'DEMO ONLY: not checked by a payroll professional' } });
  await admin.patch('/api/setup/settings', { payrollEnabled: true });
  const runPayroll = async (month: number, termId?: number) => {
    const run = await bursar.post('/api/payroll/runs', { year: 2026, month, termId });
    await bursar.post(`/api/payroll/runs/${run.id}/submit`);
    await head.post(`/api/payroll/runs/${run.id}/decide`, { approve: true });
  };

  // Term 1: bill, collect, spend, pay staff, close, carry forward.
  await billTerm(0);
  await collect(0, 0.7, ['2026-02-03', '2026-02-10', '2026-02-24', '2026-03-09', '2026-03-23', '2026-04-14']);
  await spend(0, '2026-03');
  await bursar.post('/api/owner-funds', { date: '2026-02-15', termId: terms[0].id, type: 'LOAN', amount: '3500000', ownerName: 'Peter Proprietor', description: 'Loan for classroom construction', method: 'BANK_TRANSFER' });
  await bursar.post('/api/owner-funds', { date: '2026-03-01', termId: terms[0].id, type: 'CASH', amount: '1000000', ownerName: 'Peter Proprietor', description: 'Working capital top-up', method: 'CASH' });
  for (const m of [2, 3, 4]) await runPayroll(m);
  const snap1 = await bursar.post(`/api/term-close/${terms[0].id}/prepare`, { confirm: true, notes: 'Term 1 close (demo)' });
  await head.post(`/api/term-close/snapshots/${snap1.id}/decide`, { approve: true });
  await bursar.post('/api/carry-forward/post', { sourceTermId: terms[0].id, destTermId: terms[1].id, idempotencyKey: key(), confirm: true });

  // Term 2.
  await billTerm(1);
  await collect(1, 0.65, ['2026-05-26', '2026-06-08', '2026-06-22', '2026-07-06', '2026-07-20', '2026-08-03']);
  await spend(1, '2026-06');
  for (const m of [5, 6, 7, 8]) await runPayroll(m, terms[1].id); // May falls mostly in the holiday; the bursar posts it to Term 2
  const snap2 = await bursar.post(`/api/term-close/${terms[1].id}/prepare`, { confirm: true, notes: 'Term 2 close (demo)' });
  await head.post(`/api/term-close/snapshots/${snap2.id}/decide`, { approve: true });
  await bursar.post('/api/carry-forward/post', { sourceTermId: terms[1].id, destTermId: terms[2].id, idempotencyKey: key(), confirm: true });

  // Term 3 is in progress: billed, partly collected, some items waiting for approval.
  await billTerm(2);
  await collect(2, 0.45, ['2026-09-08', '2026-09-15', '2026-09-29', '2026-10-06']);
  await spend(2, '2026-09');
  await runPayroll(9);
  await bursar.post('/api/expenses', { expenseDate: '2026-10-08', termId: terms[2].id, category: 'DISTRICT_LICENSES', description: 'Trading licence renewal', amount: '250000', supplier: 'Kasangati Town Council', method: 'BANK_TRANSFER', invoiceRef: 'KTC-2026-118', fundingSource: 'SCHOOL_FUNDS' });

  console.log(`Demo data ready. Sign in as admin, bursar, head, owner or auditor with password ${DEMO_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
