import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { getApp, login, PASSWORD, resetDb } from './helpers';
import { prisma } from '../src/db';

const ask = (body: object) => request(getApp()).post('/api/auth/access-requests').send(body);

beforeAll(async () => {
  await resetDb();
});

describe('sign-in help from the login page', () => {
  it('shows the administrator contact without signing in, falling back to the school contact', async () => {
    await prisma.schoolSettings.update({ where: { id: 1 }, data: { phone: '0414000000', email: 'office@example.org', adminContactName: 'Office admin', adminContactPhone: '0772000111', adminContactEmail: null } });
    const res = await request(getApp()).get('/api/auth/help');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ contactName: 'Office admin', phone: '0772000111', email: 'office@example.org' });
  });

  it('lets an administrator set the contact in School settings', async () => {
    const admin = await login('admin');
    const res = await admin.patch('/api/setup/settings', { adminContactName: 'Ms Admin', adminContactPhone: '0700123456', adminContactEmail: 'admin@example.org' });
    expect(res.status).toBe(200);
    expect((await request(getApp()).get('/api/auth/help')).body).toMatchObject({ contactName: 'Ms Admin', phone: '0700123456', email: 'admin@example.org' });
  });

  it('gives the same answer whether or not the username exists', async () => {
    const real = await ask({ username: 'Bursar', reason: 'LOCKED_OUT', contactPhone: '0772555000' });
    const fake = await ask({ username: 'nobody-here', reason: 'FORGOT_PASSWORD' });
    expect(real.status).toBe(200);
    expect(fake.status).toBe(200);
    expect(real.body).toEqual(fake.body);
    const rows = await prisma.accessRequest.findMany({ orderBy: { id: 'asc' } });
    expect(rows.map((r) => [r.username, r.userId !== null])).toEqual([['bursar', true], ['nobody-here', false]]);
  });

  it('does not stack duplicate pending requests for one username', async () => {
    await ask({ username: 'bursar', reason: 'FORGOT_PASSWORD', note: 'Second try' });
    const rows = await prisma.accessRequest.findMany({ where: { username: 'bursar' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: 'FORGOT_PASSWORD', note: 'Second try', contactPhone: '0772555000' });
  });

  it('rejects an unknown reason', async () => {
    expect((await ask({ username: 'bursar', reason: 'PLEASE' })).status).toBe(400);
  });

  it('is only visible to people who manage users', async () => {
    const bursar = await login('bursar2');
    expect((await bursar.get('/api/users/access-requests')).status).toBe(403);
    const admin = await login('admin');
    const list = await admin.get('/api/users/access-requests');
    expect(list.status).toBe(200);
    expect(list.body.find((r: { username: string }) => r.username === 'bursar').account).toMatchObject({ fullName: 'Bursar User', locked: false });
    expect(list.body.find((r: { username: string }) => r.username === 'nobody-here').account).toBeNull();
  });

  it('unlocks a locked account', async () => {
    await prisma.user.update({ where: { username: 'head' }, data: { lockedUntil: new Date(Date.now() + 10 * 60_000) } });
    await ask({ username: 'head', reason: 'LOCKED_OUT' });
    const admin = await login('admin');
    const users = (await admin.get('/api/users')).body as Array<{ username: string; locked: boolean }>;
    expect(users.find((u) => u.username === 'head')!.locked).toBe(true);
    const req = await prisma.accessRequest.findFirstOrThrow({ where: { username: 'head' } });
    const res = await admin.post(`/api/users/access-requests/${req.id}/resolve`, { action: 'UNLOCK', note: 'Phoned to confirm' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'UNLOCKED', temporaryPassword: null });
    expect((await request(getApp()).post('/api/auth/login').send({ username: 'head', password: PASSWORD })).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'access_request.unlock', entityId: String(req.id) } })).toBe(1);
    // Already dealt with.
    expect((await admin.post(`/api/users/access-requests/${req.id}/resolve`, { action: 'DISMISS' })).status).toBe(409);
  });

  it('sets a temporary password that must be changed, signs the user out, and keeps it out of the audit log', async () => {
    const owner = await login('owner');
    const req = await prisma.accessRequest.create({ data: { username: 'owner', reason: 'FORGOT_PASSWORD' } });
    const admin = await login('admin');
    const res = await admin.post(`/api/users/access-requests/${req.id}/resolve`, { action: 'RESET' });
    expect(res.status).toBe(200);
    const temp = res.body.temporaryPassword as string;
    expect(temp).toMatch(/^[A-Za-z]{4}-\d{4}-[A-Za-z]{4}$/);
    expect((await owner.get('/api/auth/me')).status).toBe(401);
    expect((await request(getApp()).post('/api/auth/login').send({ username: 'owner', password: PASSWORD })).status).toBe(401);
    const agent = request.agent(getApp());
    expect((await agent.post('/api/auth/login').send({ username: 'owner', password: temp })).status).toBe(200);
    expect((await agent.get('/api/auth/me')).body.mustChangePassword).toBe(true);
    const logs = await prisma.auditLog.findMany({ where: { action: { in: ['access_request.reset', 'user.password_reset_temporary'] } } });
    expect(logs).toHaveLength(2);
    expect(JSON.stringify(logs)).not.toContain(temp);
    const after = await prisma.accessRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(after.status).toBe('PASSWORD_RESET');
    // The linked user is filled in when the request had none.
    expect(after.userId).not.toBeNull();
  });

  it('can only dismiss a request for a username with no account', async () => {
    const admin = await login('admin');
    const req = await prisma.accessRequest.findFirstOrThrow({ where: { username: 'nobody-here' } });
    expect((await admin.post(`/api/users/access-requests/${req.id}/resolve`, { action: 'RESET' })).status).toBe(400);
    const res = await admin.post(`/api/users/access-requests/${req.id}/resolve`, { action: 'DISMISS', note: 'Not one of ours' });
    expect(res.body.status).toBe('DISMISSED');
  });
});
