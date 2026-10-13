import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db';
import { handle, parse } from '../lib/http';
import { badRequest, unauthorized } from '../lib/errors';
import { audit } from '../lib/audit';
import { config } from '../config';
import { createSession, currentUser, requireAuth, setSessionCookie, SESSION_COOKIE, hashToken } from './session';

export const router = Router();

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.env === 'test' ? 1000 : 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Wait a few minutes and try again.' } },
});

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain letters and numbers');

export function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

router.post(
  '/login',
  loginLimiter,
  handle(async (req, res) => {
    const body = parse(z.object({ username: z.string().min(1), password: z.string().min(1) }), req.body);
    const user = await prisma.user.findUnique({ where: { username: body.username.trim().toLowerCase() } });
    const genericError = unauthorized('Username or password is incorrect');
    if (!user || !user.active) {
      await bcrypt.compare(body.password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
      throw genericError;
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw unauthorized('This account is temporarily locked after repeated failed sign-ins. Try again later.');
    }
    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failed >= MAX_FAILED ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      });
      await audit(prisma, null, 'auth.login_failed', 'User', user.id, { ip: req.ip });
      throw genericError;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const session = await createSession(user.id, req);
    setSessionCookie(res, session.token, session.expiresAt);
    await audit(prisma, { id: user.id, username: user.username } as never, 'auth.login', 'User', user.id, { ip: req.ip });
    return { ok: true };
  }),
);

router.post(
  '/logout',
  handle(async (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }),
);

router.get(
  '/me',
  requireAuth,
  handle(async (req) => {
    const u = currentUser(req);
    return {
      id: u.id,
      username: u.username,
      fullName: u.fullName,
      roles: u.roles,
      permissions: [...u.permissions].sort(),
      csrfToken: u.csrfToken,
      mustChangePassword: u.mustChangePassword,
    };
  }),
);

router.post(
  '/change-password',
  requireAuth,
  handle(async (req) => {
    const u = currentUser(req);
    const body = parse(z.object({ currentPassword: z.string(), newPassword: passwordSchema }), req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
      throw badRequest('Current password is incorrect');
    }
    await prisma.user.update({
      where: { id: u.id },
      data: { passwordHash: await hashPassword(body.newPassword), mustChangePassword: false },
    });
    // Sign out other sessions after a password change.
    await prisma.session.deleteMany({ where: { userId: u.id, id: { not: u.sessionId } } });
    await audit(prisma, u, 'auth.password_changed', 'User', u.id);
    return { ok: true };
  }),
);
