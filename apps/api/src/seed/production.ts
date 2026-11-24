/**
 * Production first-run seed: base data and one administrator account.
 * Usage: ADMIN_USERNAME=admin ADMIN_PASSWORD='...' node dist/seed/production.js
 */
import { prisma } from '../db';
import { ensureAdmin, seedBase } from './base';

async function main() {
  await seedBase(prisma);
  const username = process.env.ADMIN_USERNAME ?? 'admin';
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 10) {
    console.log('Base data is in place. Set ADMIN_PASSWORD (10+ characters) to create the first administrator.');
    return;
  }
  const created = await ensureAdmin(prisma, username.toLowerCase(), password);
  console.log(created ? `Administrator "${username}" created. They must change the password at first sign-in.` : 'Users already exist; no administrator created.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
