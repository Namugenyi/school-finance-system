import type { Db } from '../db';
import type { AuthUser } from '../auth/session';
import { forbidden, notFound } from '../lib/errors';

/**
 * A-24: once a term is closed, new or changed transactions for it are post-close exceptions.
 * Only users with "term.postClosed" (Head Teacher by default) may record them, and they are
 * flagged so the term-close screen lists them. Returns whether the entry is post-close.
 */
export async function checkTermOpen(db: Db, user: AuthUser, termId: number): Promise<boolean> {
  const term = await db.academicTerm.findUnique({ where: { id: termId } });
  if (!term) throw notFound('Term');
  if (term.status !== 'CLOSED') return false;
  if (!user.permissions.has('term.postClosed')) {
    throw forbidden('This term is closed. Only someone allowed to record post-close exceptions (normally the Head Teacher) can change it.');
  }
  return true;
}
