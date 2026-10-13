import path from 'node:path';
import fs from 'node:fs';
import express, { Router } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { prisma } from './db';
import { config } from './config';
import { errorHandler, handle } from './lib/http';
import { csrfGuard, hasPermission, loadSession, requireAuth } from './auth/session';
import { router as authRouter } from './auth/routes';
import { router as setupRouter } from './modules/setup';
import { router as usersRouter, auditRouter } from './modules/users';
import { router as pupilsRouter } from './modules/pupils';
import { router as feesRouter } from './modules/fees';
import { router as chargesRouter } from './modules/charges';
import { router as billingRouter } from './modules/billing';
import { router as paymentsRouter } from './modules/payments';
import { router as collectionsRouter } from './modules/collections';
import { router as expensesRouter } from './modules/expenses';
import { router as ownerRouter } from './modules/owner';
import { router as payrollRouter } from './modules/payroll';
import { router as carryRouter } from './modules/carryforward';
import { router as termCloseRouter } from './modules/termclose';
import { router as reportsRouter, dashboardRouter } from './modules/reports';
import { router as approvalsRouter } from './modules/approvals';

/** Quick search across the main records for the app shell's search box (WR-30). */
const searchRouter = Router();
searchRouter.get(
  '/',
  requireAuth,
  handle(async (req) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 2) return { pupils: [], receipts: [], expenses: [] };
    const like = { contains: q, mode: 'insensitive' as const };
    const [pupils, receipts, expenses] = await Promise.all([
      hasPermission(req.user, 'pupils.view')
        ? prisma.pupil.findMany({ where: { OR: [{ fullName: like }, { pupilCode: like }] }, take: 8, orderBy: { fullName: 'asc' }, select: { id: true, pupilCode: true, fullName: true, status: true } })
        : [],
      hasPermission(req.user, 'payments.view')
        ? prisma.receipt.findMany({ where: { OR: [{ receiptNo: like }, { reference: like }] }, take: 5, select: { id: true, receiptNo: true, total: true } })
        : [],
      hasPermission(req.user, 'expenses.view')
        ? prisma.expense.findMany({ where: { OR: [{ expenseNo: like }, { description: like }, { supplier: like }] }, take: 5, select: { id: true, expenseNo: true, description: true } })
        : [],
    ]);
    return { pupils, receipts: receipts.map((r) => ({ ...r, total: r.total.toFixed(2) })), expenses };
  }),
);

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const api = Router();
  api.get('/health', handle(async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, time: new Date().toISOString() };
  }));
  api.use(loadSession);
  api.use(csrfGuard);
  api.use('/auth', authRouter);
  api.use('/setup', setupRouter);
  api.use('/users', usersRouter);
  api.use('/audit', auditRouter);
  api.use('/pupils', pupilsRouter);
  api.use('/fees', feesRouter);
  api.use('/charges', chargesRouter);
  api.use('/billing', billingRouter);
  api.use('/payments', paymentsRouter);
  api.use('/collections', collectionsRouter);
  api.use('/expenses', expensesRouter);
  api.use('/owner-funds', ownerRouter);
  api.use('/payroll', payrollRouter);
  api.use('/carry-forward', carryRouter);
  api.use('/term-close', termCloseRouter);
  api.use('/reports', reportsRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/approvals', approvalsRouter);
  api.use('/search', searchRouter);
  api.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown API route' } }));
  app.use('/api', api);

  // In production the API also serves the built web app.
  if (config.staticDir && fs.existsSync(config.staticDir)) {
    const dir = path.resolve(config.staticDir);
    app.use(express.static(dir, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dir, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
