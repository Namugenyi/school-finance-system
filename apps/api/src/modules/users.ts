import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { handle, idParam, pagination, parse } from '../lib/http';
import { badRequest, conflict, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { currentUser, requirePermission } from '../auth/session';
import { ALL_PERMISSIONS, PERMISSIONS } from '../auth/permissions';
import { hashPassword, passwordSchema, temporaryPassword } from '../auth/routes';

export const router = Router();

const serializeUser = (u: { id: number; username: string; fullName: string; email: string | null; active: boolean; lastLoginAt: Date | null; mustChangePassword: boolean; lockedUntil?: Date | null; roles: Array<{ role: { code: string; name: string } }> }) => ({
  id: u.id,
  username: u.username,
  fullName: u.fullName,
  email: u.email,
  active: u.active,
  mustChangePassword: u.mustChangePassword,
  lastLoginAt: u.lastLoginAt,
  locked: !!u.lockedUntil && u.lockedUntil > new Date(),
  roles: u.roles.map((r) => r.role.code),
});

router.get('/permissions', requirePermission('users.manage'), handle(async () => Object.entries(PERMISSIONS).map(([key, label]) => ({ key, label }))));

router.get(
  '/roles',
  requirePermission('users.manage'),
  handle(async () => {
    const roles = await prisma.role.findMany({ include: { permissions: true, _count: { select: { users: true } } }, orderBy: { id: 'asc' } });
    return roles.map((r) => ({ id: r.id, code: r.code, name: r.name, description: r.description, isSystem: r.isSystem, userCount: r._count.users, permissions: r.permissions.map((p) => p.permission).sort() }));
  }),
);

const roleBody = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).nullable().optional(),
  permissions: z.array(z.string()).refine((ps) => ps.every((p) => (ALL_PERMISSIONS as string[]).includes(p)), 'Unknown permission'),
});

router.post(
  '/roles',
  requirePermission('users.manage'),
  handle(async (req) => {
    const body = parse(roleBody.extend({ code: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,30}$/, 'Code must be capitals, digits and underscores') }), req.body);
    if (await prisma.role.findUnique({ where: { code: body.code } })) throw conflict('A role with this code already exists');
    const role = await prisma.role.create({
      data: { code: body.code, name: body.name, description: body.description ?? null, permissions: { create: body.permissions.map((permission) => ({ permission })) } },
    });
    await audit(prisma, currentUser(req), 'role.create', 'Role', role.id, { after: body });
    return role;
  }),
);

router.put(
  '/roles/:id',
  requirePermission('users.manage'),
  handle(async (req) => {
    const id = idParam(req);
    const body = parse(roleBody, req.body);
    const before = await prisma.role.findUnique({ where: { id }, include: { permissions: true } });
    if (!before) throw notFound('Role');
    // Stop an administrator from locking everyone out of user management.
    if (before.code === 'ADMIN' && !body.permissions.includes('users.manage')) {
      throw badRequest('The School Administrator role must keep the "Manage user accounts" permission');
    }
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      prisma.role.update({
        where: { id },
        data: { name: body.name, description: body.description ?? null, permissions: { create: body.permissions.map((permission) => ({ permission })) } },
      }),
    ]);
    await audit(prisma, currentUser(req), 'role.update', 'Role', id, {
      before: { name: before.name, permissions: before.permissions.map((p) => p.permission) },
      after: body,
    });
    return { ok: true };
  }),
);

router.get(
  '/',
  requirePermission('users.manage'),
  handle(async () => {
    const users = await prisma.user.findMany({ include: { roles: { include: { role: true } } }, orderBy: { fullName: 'asc' } });
    return users.map(serializeUser);
  }),
);

router.post(
  '/',
  requirePermission('users.manage'),
  handle(async (req) => {
    const body = parse(
      z.object({
        username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, 'Username: 3-40 letters, digits, dot, dash or underscore'),
        fullName: z.string().trim().min(2).max(120),
        email: z.string().trim().email().nullable().optional(),
        password: passwordSchema,
        roles: z.array(z.string()).min(1, 'Give the user at least one role'),
      }),
      req.body,
    );
    if (await prisma.user.findUnique({ where: { username: body.username } })) throw conflict('That username is taken');
    const roles = await prisma.role.findMany({ where: { code: { in: body.roles } } });
    if (roles.length !== body.roles.length) throw badRequest('Unknown role');
    const user = await prisma.user.create({
      data: {
        username: body.username,
        fullName: body.fullName,
        email: body.email ?? null,
        passwordHash: await hashPassword(body.password),
        mustChangePassword: true,
        roles: { create: roles.map((r) => ({ roleId: r.id })) },
      },
      include: { roles: { include: { role: true } } },
    });
    await audit(prisma, currentUser(req), 'user.create', 'User', user.id, { after: serializeUser(user) });
    return serializeUser(user);
  }),
);

router.patch(
  '/:id',
  requirePermission('users.manage'),
  handle(async (req) => {
    const id = idParam(req);
    const body = parse(
      z.object({
        fullName: z.string().trim().min(2).max(120).optional(),
        email: z.string().trim().email().nullable().optional(),
        active: z.boolean().optional(),
        roles: z.array(z.string()).min(1).optional(),
        resetPassword: passwordSchema.optional(),
      }),
      req.body,
    );
    const me = currentUser(req);
    const before = await prisma.user.findUnique({ where: { id }, include: { roles: { include: { role: true } } } });
    if (!before) throw notFound('User');
    if (id === me.id && body.active === false) throw badRequest('You cannot deactivate your own account');
    if (id === me.id && body.roles && !body.roles.includes('ADMIN') && me.roles.includes('ADMIN')) {
      throw badRequest('You cannot remove the administrator role from yourself');
    }
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          fullName: body.fullName,
          email: body.email,
          active: body.active,
          ...(body.resetPassword ? { passwordHash: await hashPassword(body.resetPassword), mustChangePassword: true, failedLogins: 0, lockedUntil: null } : {}),
        },
      });
      if (body.roles) {
        const roles = await tx.role.findMany({ where: { code: { in: body.roles } } });
        if (roles.length !== body.roles.length) throw badRequest('Unknown role');
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({ data: roles.map((r) => ({ userId: id, roleId: r.id })) });
      }
      if (body.active === false || body.resetPassword) await tx.session.deleteMany({ where: { userId: id } });
    });
    const after = await prisma.user.findUniqueOrThrow({ where: { id }, include: { roles: { include: { role: true } } } });
    await audit(prisma, me, body.resetPassword ? 'user.update_password_reset' : 'user.update', 'User', id, { before: serializeUser(before), after: serializeUser(after) });
    return serializeUser(after);
  }),
);

// ───────── Sign-in help requests from the login page ─────────

router.get(
  '/access-requests',
  requirePermission('users.manage'),
  handle(async () => {
    const recent = new Date(Date.now() - 30 * 24 * 60 * 60_000);
    const rows = await prisma.accessRequest.findMany({
      where: { OR: [{ status: 'PENDING' }, { resolvedAt: { gte: recent } }] },
      include: { user: { select: { id: true, fullName: true, active: true, lockedUntil: true } } },
      orderBy: [{ status: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    const resolverIds = [...new Set(rows.map((r) => r.resolvedById).filter((v): v is number => v !== null))];
    const resolvers = await prisma.user.findMany({ where: { id: { in: resolverIds } }, select: { id: true, fullName: true } });
    const now = new Date();
    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      reason: r.reason,
      contactPhone: r.contactPhone,
      note: r.note,
      status: r.status,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
      resolution: r.resolution,
      resolvedBy: resolvers.find((u) => u.id === r.resolvedById)?.fullName ?? null,
      account: r.user
        ? { id: r.user.id, fullName: r.user.fullName, active: r.user.active, locked: !!r.user.lockedUntil && r.user.lockedUntil > now }
        : null,
    }));
  }),
);

router.post(
  '/access-requests/:id/resolve',
  requirePermission('users.manage'),
  handle(async (req) => {
    const id = idParam(req);
    const body = parse(z.object({ action: z.enum(['UNLOCK', 'RESET', 'DISMISS']), note: z.string().trim().max(300).nullable().optional() }), req.body);
    const me = currentUser(req);
    const request = await prisma.accessRequest.findUnique({ where: { id } });
    if (!request) throw notFound('Request');
    if (request.status !== 'PENDING') throw conflict('This request has already been dealt with');
    // Re-match by username in case the account was created after the request came in.
    const user = request.userId
      ? await prisma.user.findUnique({ where: { id: request.userId } })
      : await prisma.user.findUnique({ where: { username: request.username } });
    if (body.action !== 'DISMISS') {
      if (!user) throw badRequest('No account has this username. Dismiss the request, or create the account under Users.');
      if (user.id === me.id) throw badRequest('Use Change password for your own account');
    }
    let tempPassword: string | null = null;
    const status = body.action === 'UNLOCK' ? 'UNLOCKED' : body.action === 'RESET' ? 'PASSWORD_RESET' : 'DISMISSED';
    await prisma.$transaction(async (tx) => {
      if (user && body.action === 'UNLOCK') {
        await tx.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
      }
      if (user && body.action === 'RESET') {
        tempPassword = temporaryPassword();
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash: await hashPassword(tempPassword), mustChangePassword: true, failedLogins: 0, lockedUntil: null },
        });
        await tx.session.deleteMany({ where: { userId: user.id } });
      }
      await tx.accessRequest.update({
        where: { id },
        data: { status, userId: user?.id ?? null, resolvedById: me.id, resolvedAt: new Date(), resolution: body.note || null },
      });
      // Close any other open requests for the same account at the same time.
      if (body.action !== 'DISMISS') {
        await tx.accessRequest.updateMany({
          where: { username: request.username, status: 'PENDING', id: { not: id } },
          data: { status, resolvedById: me.id, resolvedAt: new Date(), resolution: 'Handled with an earlier request' },
        });
      }
      await audit(tx, me, `access_request.${body.action.toLowerCase()}`, 'AccessRequest', id, {
        after: { username: request.username, userId: user?.id ?? null, status },
        reason: body.note || null,
      });
      if (user && body.action !== 'DISMISS') {
        await audit(tx, me, body.action === 'RESET' ? 'user.password_reset_temporary' : 'user.unlock', 'User', user.id, { reason: `Sign-in help request #${id}` });
      }
    });
    return { ok: true, status, temporaryPassword: tempPassword };
  }),
);

router.post(
  '/:id/unlock',
  requirePermission('users.manage'),
  handle(async (req) => {
    const id = idParam(req);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw notFound('User');
    await prisma.user.update({ where: { id }, data: { failedLogins: 0, lockedUntil: null } });
    await audit(prisma, currentUser(req), 'user.unlock', 'User', id);
    return { ok: true };
  }),
);

// ───────── Audit log (WR-04) ─────────

export const auditRouter = Router();

auditRouter.get(
  '/',
  requirePermission('audit.view'),
  handle(async (req) => {
    const { skip, take, page, pageSize } = pagination(req.query);
    const q = req.query;
    const where = {
      entityType: typeof q.entityType === 'string' && q.entityType ? q.entityType : undefined,
      entityId: typeof q.entityId === 'string' && q.entityId ? q.entityId : undefined,
      username: typeof q.username === 'string' && q.username ? q.username : undefined,
      action: typeof q.action === 'string' && q.action ? { contains: q.action } : undefined,
    };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, skip, take }),
      prisma.auditLog.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }),
);
