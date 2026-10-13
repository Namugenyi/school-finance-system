/**
 * Starts the API on a clean database for the browser tests: base data, one user per role,
 * three 2026 terms and three classes (the same world as the API tests). Never point this at real data.
 */
import { createApp } from '../src/app';
import { prisma } from '../src/db';
import { resetDb } from './helpers';

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  if (!/stja_(e2e|test)/.test(url)) throw new Error('e2e-server only runs against an stja_e2e or stja_test database');
  await resetDb();
  await prisma.schoolSettings.update({ where: { id: 1 }, data: { schoolName: 'Supreme Tower Junior Academy (TEST)' } });
  const port = Number(process.env.PORT ?? 4100);
  createApp().listen(port, () => console.log(`e2e API on ${port}`));
}

void main();
