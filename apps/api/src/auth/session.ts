import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db';
import { config } from '../config';
import { forbidden, unauthorized, AppError } from '../lib/errors';
import type { Permission } from './permissions';

export const SESSION_COOKIE = 'stja_session';

export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  roles: string[];
  permissions: Set<string>;
  sessionId: number;
  csrfToken: string;
  mustChangePassword: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export async function createSession(userId: number, req: Request) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionHours * 3600_000);
  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      csrfToken,
      userId,
      expiresAt,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
    },
  });
  return { token, csrfToken, expiresAt };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
    expires: expiresAt,
    path: '/',
  });
}

/** Load the signed-in user, if any. Sessions expire after a fixed length and after idle time. */
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return next();
    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { include: { roles: { include: { role: { include: { permissions: true } } } } } } },
    });
    if (!session) return next();
    const now = Date.now();
    const idleLimit = session.lastSeenAt.getTime() + config.sessionIdleMinutes * 60_000;
    if (session.expiresAt.getTime() < now || idleLimit < now || !session.user.active) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      return next();
    }
    if (now - session.lastSeenAt.getTime() > 60_000) {
      await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    }
    const permissions = new Set<string>();
    for (const ur of session.user.roles) for (const p of ur.role.permissions) permissions.add(p.permission);
    req.user = {
      id: session.user.id,
      username: session.user.username,
      fullName: session.user.fullName,
      roles: session.user.roles.map((r) => r.role.code),
      permissions,
      sessionId: session.id,
      csrfToken: session.csrfToken,
      mustChangePassword: session.user.mustChangePassword,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * CSRF protection for cookie sessions: every state-changing request must echo the session's
 * CSRF token in a header. Cross-site pages cannot read the token, and the cookie is SameSite=strict.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.user) return next();
  const header = req.get('x-csrf-token');
  if (!header || header !== req.user.csrfToken) {
    return next(new AppError(403, 'CSRF', 'Your session token is missing or out of date. Refresh the page and try again.'));
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

/** Backend permission check (WR-01): the UI hides buttons, but this is what actually enforces access. */
export function requirePermission(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!perms.some((p) => req.user!.permissions.has(p))) return next(forbidden());
    next();
  };
}

export function hasPermission(user: AuthUser | undefined, perm: Permission) {
  return !!user && user.permissions.has(perm);
}

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
