import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { prisma } from '../src/db';
import { seedBase } from '../src/seed/base';

export const PASSWORD = 'Test-pass-2026';
let app: Express | null = null;
export const getApp = () => (app ??= createApp());

/** Wipe every table and reload base data, with one user per role and a 2026 calendar. */
export async function resetDb() {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`ALTER TABLE "TermSnapshot" DISABLE TRIGGER "TermSnapshot_freeze"`);
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "TermSnapshot" ENABLE TRIGGER "TermSnapshot_freeze"`);
  await seedBase(prisma, { startYear: 2026 });
  const hash = await bcrypt.hash(PASSWORD, 4);
  const roles = await prisma.role.findMany();
  const users: Record<string, number> = {};
  for (const [username, roleCode] of [
    ['admin', 'ADMIN'], ['bursar', 'BURSAR'], ['bursar2', 'BURSAR'], ['head', 'HEAD_TEACHER'], ['owner', 'PROPRIETOR'], ['auditor', 'AUDITOR'],
  ]) {
    const u = await prisma.user.create({
      data: { username, fullName: `${username[0].toUpperCase()}${username.slice(1)} User`, passwordHash: hash, roles: { create: [{ roleId: roles.find((r) => r.code === roleCode)!.id }] } },
    });
    users[username] = u.id;
  }
  const year = await prisma.academicYear.create({ data: { year: 2026 } });
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const t1 = await prisma.academicTerm.create({ data: { academicYearId: year.id, number: 1, name: 'Term 1', startDate: d('2026-02-02'), endDate: d('2026-04-30') } });
  const t2 = await prisma.academicTerm.create({ data: { academicYearId: year.id, number: 2, name: 'Term 2', startDate: d('2026-05-25'), endDate: d('2026-08-14') } });
  const t3 = await prisma.academicTerm.create({ data: { academicYearId: year.id, number: 3, name: 'Term 3', startDate: d('2026-09-07'), endDate: d('2026-12-04') } });
  const primary = await prisma.section.findUniqueOrThrow({ where: { code: 'PRIMARY' } });
  const kg = await prisma.section.findUniqueOrThrow({ where: { code: 'KG' } });
  const p1 = await prisma.schoolClass.create({ data: { name: 'P1', sectionId: primary.id, sortOrder: 1 } });
  const p2 = await prisma.schoolClass.create({ data: { name: 'P2', sectionId: primary.id, sortOrder: 2 } });
  const baby = await prisma.schoolClass.create({ data: { name: 'Baby Class', sectionId: kg.id, sortOrder: 1 } });
  const items = Object.fromEntries((await prisma.feeItem.findMany()).map((f) => [f.code, f.id]));
  return { users, yearId: year.id, terms: { t1: t1.id, t2: t2.id, t3: t3.id }, classes: { p1: p1.id, p2: p2.id, baby: baby.id }, items };
}

export type World = Awaited<ReturnType<typeof resetDb>>;

export interface Client {
  get: (url: string) => request.Test;
  post: (url: string, body?: object) => request.Test;
  put: (url: string, body?: object) => request.Test;
  patch: (url: string, body?: object) => request.Test;
  del: (url: string) => request.Test;
}

/** Sign in and return a client that sends the session cookie and CSRF token. */
export async function login(username: string): Promise<Client> {
  const agent = request.agent(getApp());
  const res = await agent.post('/api/auth/login').send({ username, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  const me = await agent.get('/api/auth/me');
  const csrf = me.body.csrfToken as string;
  return {
    get: (url) => agent.get(url),
    post: (url, body = {}) => agent.post(url).set('x-csrf-token', csrf).send(body),
    put: (url, body = {}) => agent.put(url).set('x-csrf-token', csrf).send(body),
    patch: (url, body = {}) => agent.patch(url).set('x-csrf-token', csrf).send(body),
    del: (url) => agent.delete(url).set('x-csrf-token', csrf),
  };
}

let keySeq = 0;
export const key = () => `test-key-${Date.now()}-${++keySeq}`;

/** The parent or guardian and emergency contact details every new pupil needs. */
export const GUARDIAN = {
  guardianName: 'Test Guardian', guardianRelationship: 'MOTHER', phonePrimary: '0772123456', address: 'Kasangati, Wakiso',
  emergencyName: 'Test Aunt', emergencyRelationship: 'AUNT_UNCLE', emergencyPhone: '0701123456',
};

export async function createPupil(c: Client, w: World, name: string, classId = w.classes.p1, extra: object = {}) {
  const res = await c.post('/api/pupils', { fullName: name, sex: 'FEMALE', dateJoined: '2026-01-20', classId, ...GUARDIAN, guardianName: `Parent of ${name}`, ...extra });
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  return res.body as { id: number; pupilCode: string };
}

export async function setFees(c: Client, termId: number, classId: number, lines: Array<{ feeItemId: number; amount: string; mandatory: boolean }>) {
  const res = await c.put('/api/fees', { termId, classId, lines });
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
}

export async function bill(c: Client, termId: number, classId: number, rows: object[] = []) {
  const res = await c.post('/api/billing/post', { termId, classId, idempotencyKey: key(), confirm: true, rows });
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  return res.body;
}

export async function chargesOf(c: Client, pupilId: number, termId?: number) {
  const res = await c.get(`/api/charges?pupilId=${pupilId}${termId ? `&termId=${termId}` : ''}&pageSize=200`);
  return res.body.items as Array<Record<string, any>>;
}

export async function pay(c: Client, pupilId: number, lines: Array<{ chargeId: number; amount: string }>, extra: object = {}) {
  return c.post('/api/payments', { pupilId, paymentDate: '2026-03-01', method: 'CASH', idempotencyKey: key(), lines, ...extra });
}
