import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { getApp, login, PASSWORD, resetDb, type World } from './helpers';
import { prisma } from '../src/db';
import { LOGIN_FAILED_MESSAGE } from '../src/auth/routes';

let w: World;
beforeAll(async () => {
  w = await resetDb();
});

describe('authentication (WR-03)', () => {
  it('rejects unauthenticated API calls', async () => {
    const res = await request(getApp()).get('/api/pupils');
    expect(res.status).toBe(401);
  });

  it('rejects a wrong password with a generic message', async () => {
    const res = await request(getApp()).post('/api/auth/login').send({ username: 'bursar', password: 'wrong-password-1' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe(LOGIN_FAILED_MESSAGE);
  });

  it('locks an account after five failed attempts', async () => {
    for (let i = 0; i < 5; i++) await request(getApp()).post('/api/auth/login').send({ username: 'owner', password: 'bad-password-9' });
    const res = await request(getApp()).post('/api/auth/login').send({ username: 'owner', password: PASSWORD });
    expect(res.status).toBe(401);
    // Same message as a wrong password or an unknown user, so the lock is not revealed.
    expect(res.body.error.message).toBe(LOGIN_FAILED_MESSAGE);
    const unknown = await request(getApp()).post('/api/auth/login').send({ username: 'no-such-user', password: PASSWORD });
    expect(unknown.body.error.message).toBe(LOGIN_FAILED_MESSAGE);
    await prisma.user.update({ where: { username: 'owner' }, data: { lockedUntil: null } });
  });

  it('sets an httpOnly, SameSite=Strict session cookie', async () => {
    const res = await request(getApp()).post('/api/auth/login').send({ username: 'bursar', password: PASSWORD });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
  });

  it('refuses state changes without the CSRF token', async () => {
    const agent = request.agent(getApp());
    await agent.post('/api/auth/login').send({ username: 'bursar', password: PASSWORD });
    const res = await agent.post('/api/pupils').send({ fullName: 'No Token', sex: 'MALE', dateJoined: '2026-01-10', classId: w.classes.p1 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF');
  });

  it('stores passwords hashed, never in plain text', async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { username: 'bursar' } });
    expect(u.passwordHash).not.toContain(PASSWORD);
    expect(u.passwordHash).toMatch(/^\$2[aby]\$/);
  });
});

describe('role permissions enforced on the server (WR-01, E2E-16)', () => {
  it('auditor can read but not write', async () => {
    const auditor = await login('auditor');
    expect((await auditor.get('/api/pupils')).status).toBe(200);
    expect((await auditor.get('/api/audit')).status).toBe(200);
    const res = await auditor.post('/api/pupils', { fullName: 'Blocked Pupil', sex: 'MALE', dateJoined: '2026-01-10', classId: w.classes.p1 });
    expect(res.status).toBe(403);
    expect((await auditor.post('/api/billing/preview', { termId: w.terms.t1, classId: w.classes.p1 })).status).toBe(403);
  });

  it('bursar cannot manage users or approve expenses', async () => {
    const bursar = await login('bursar');
    expect((await bursar.get('/api/users')).status).toBe(403);
    expect((await bursar.post('/api/expenses/1/decide', { approve: true })).status).toBe(403);
  });

  it('administrator cannot record payments by default', async () => {
    const admin = await login('admin');
    const res = await admin.post('/api/payments', { pupilId: 1, paymentDate: '2026-03-01', method: 'CASH', idempotencyKey: 'abcdefgh', lines: [{ chargeId: 1, amount: '10' }] });
    expect(res.status).toBe(403);
  });

  it('hides guardian phone numbers from roles without contact access', async () => {
    const bursar = await login('bursar');
    await bursar.post('/api/pupils', { fullName: 'Contact Check', sex: 'MALE', dateJoined: '2026-01-10', classId: w.classes.p1, phonePrimary: '0772000111' });
    const owner = await login('owner');
    const res = await owner.get('/api/pupils?search=Contact');
    expect(res.body.items[0].phonePrimary).toBeUndefined();
    expect(res.body.items[0].contactsHidden).toBe(true);
  });

  it('role permissions are configurable and take effect', async () => {
    const admin = await login('admin');
    const roles = (await admin.get('/api/users/roles')).body as Array<{ id: number; code: string; name: string; permissions: string[] }>;
    const auditor = roles.find((r) => r.code === 'AUDITOR')!;
    await admin.put(`/api/users/roles/${auditor.id}`, { name: auditor.name, permissions: auditor.permissions.filter((p) => p !== 'pupils.view') });
    const a = await login('auditor');
    expect((await a.get('/api/pupils')).status).toBe(403);
    await admin.put(`/api/users/roles/${auditor.id}`, { name: auditor.name, permissions: auditor.permissions });
  });

  it('writes an audit entry for sensitive actions (WR-04)', async () => {
    const entries = await prisma.auditLog.findMany({ where: { action: 'role.update' } });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].username).toBe('admin');
    expect(entries[0].before).toBeTruthy();
  });
});
