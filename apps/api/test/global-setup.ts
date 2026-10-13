import { execSync } from 'node:child_process';

export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/stja_test';
  execSync('npx prisma migrate deploy', {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
