process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/stja_test';
process.env.NODE_ENV = 'test';
