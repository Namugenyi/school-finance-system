import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { handle, pagination, parse } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { isoDate, parseDate, todayKampala } from '../lib/dates';
import { nextContributionNo } from '../lib/ids';
import { dec, money } from '../lib/money';
import { currentUser, requirePermission } from '../auth/session';
import { assertRefCode, termLabel } from './setup';
import { moneyInput } from './fees';

export const router = Router();

/**
 * FR-801 to FR-803, BR-21, C-09: owner money is funding, not income. Cash contributions and
 * loans never enter Total Collected or the surplus. An "Expense Paid Directly" contribution links
 * to its expense, and the money is counted once, as that expense (WR-14).
 */
router.get(
  '/',
  requirePermission('owner.view'),
  handle(async (req) => {
    const q = req.query;
    const { skip, take, page, pageSize } = pagination(q);
    const where: Prisma.OwnerContributionWhereInput = {
      termId: q.termId ? Number(q.termId) : undefined,
      term: q.academicYearId ? { academicYearId: Number(q.academicYearId) } : undefined,
      type: typeof q.type === 'string' && q.type ? q.type : undefined,
    };
    const [items, total, byType] = await Promise.all([
      prisma.ownerContribution.findMany({ where, include: { term: { include: { academicYear: true } }, expense: true }, orderBy: [{ date: 'desc' }, { id: 'desc' }], skip, take }),
      prisma.ownerContribution.count({ where }),
      prisma.ownerContribution.groupBy({ by: ['type'], where, _sum: { amount: true } }),
    ]);
    return {
      items: items.map((c) => ({
        id: c.id, contributionNo: c.contributionNo, date: isoDate(c.date), termId: c.termId, termLabel: termLabel(c.term), type: c.type,
        amount: money(c.amount), ownerName: c.ownerName, description: c.description, method: c.method, reference: c.reference,
        expense: c.expense ? { id: c.expense.id, expenseNo: c.expense.expenseNo, status: c.expense.status, amount: money(c.expense.amount) } : null,
      })),
      total,
      page,
      pageSize,
      totalsByType: Object.fromEntries(byType.map((t) => [t.type, money(t._sum.amount)])),
    };
  }),
);

router.post(
  '/',
  requirePermission('owner.manage'),
  handle(async (req) => {
    const body = parse(
      z.object({
        date: z.string(),
        termId: z.number().int(),
        type: z.string(),
        amount: moneyInput,
        ownerName: z.string().trim().min(2).max(120),
        description: z.string().trim().max(500).transform((v) => v || null).nullable().optional(),
        method: z.string().nullable().optional(),
        reference: z.string().trim().max(100).transform((v) => v || null).nullable().optional(),
        expenseId: z.number().int().nullable().optional(),
      }),
      req.body,
    );
    const user = currentUser(req);
    await assertRefCode(prisma, 'CONTRIBUTION_TYPE', body.type, 'Contribution type');
    if (body.method) await assertRefCode(prisma, 'PAYMENT_METHOD', body.method, 'Payment method');
    const date = parseDate(body.date, 'Date');
    if (date > todayKampala()) throw badRequest('Date cannot be in the future');
    if (dec(body.amount).lte(0)) throw badRequest('Amount must be more than zero');
    if (!(await prisma.academicTerm.findUnique({ where: { id: body.termId } }))) throw notFound('Term');

    if (body.type === 'EXPENSE_PAID_DIRECTLY') {
      // FR-802: must point at the expense it paid, which must be owner-funded and the same amount.
      if (!body.expenseId) throw badRequest('Choose the expense the owner paid directly');
      const expense = await prisma.expense.findUnique({ where: { id: body.expenseId }, include: { contribution: true } });
      if (!expense) throw notFound('Expense');
      if (expense.contribution) throw badRequest(`Expense ${expense.expenseNo} is already linked to ${expense.contribution.contributionNo}`);
      if (expense.fundingSource !== 'OWNER_CONTRIBUTION') throw badRequest(`Expense ${expense.expenseNo} must have Owner Contribution as its funding source`);
      if (!dec(expense.amount).eq(dec(body.amount))) throw badRequest(`The amount must match expense ${expense.expenseNo} (${money(expense.amount)})`);
      if (expense.status === 'REJECTED') throw badRequest('That expense was rejected');
    } else if (body.expenseId) {
      throw badRequest('Only an "Expense Paid Directly" contribution links to an expense');
    }

    const c = await prisma.$transaction(async (tx) => {
      const created = await tx.ownerContribution.create({
        data: {
          contributionNo: await nextContributionNo(tx), date, termId: body.termId, type: body.type, amount: dec(body.amount),
          ownerName: body.ownerName, description: body.description ?? null, method: body.method ?? null, reference: body.reference ?? null,
          expenseId: body.expenseId ?? null, createdById: user.id,
        },
      });
      await audit(tx, user, 'owner.create', 'OwnerContribution', created.id, { after: created });
      return created;
    });
    return { id: c.id, contributionNo: c.contributionNo };
  }),
);
