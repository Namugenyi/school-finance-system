# STJA School Finance & Accounts System

Web application for Supreme Tower Junior Academy, Kasangati, built from the functional requirements specification STJA-FRS-v12. It replaces the 18-sheet workbook with one shared system for pupils, fees, billing, payments and receipts, arrears, statements, expenses, owner funds, payroll, carry-forward, term close and reports. Grades, attendance and learning tools are out of scope.

Amounts are in Uganda shillings with two decimals. Dates are shown and typed as DD/MM/YYYY, in Kampala time.

## What is in the repository

| Path | What it holds |
|---|---|
| `apps/api` | Express + TypeScript API, Prisma schema and migrations, finance rules, API tests |
| `apps/web` | React + TypeScript + Tailwind screens, browser (Playwright) journeys |
| `docs/requirements` | Phase 1 requirements analysis, traceability and the seven decisions |
| `docs/build-notes.md` | How the build meets the decisions, and what still needs the school |
| `docs/deployment.md` | Running it on a server, HTTPS, backups and restore |
| `docs/user-guide.md` | A short guide for the bursar, head teacher and administrator |

## Run it on your machine

You need Node 20 and PostgreSQL 16.

```bash
npm install
cp apps/api/.env.example apps/api/.env          # set DATABASE_URL
npm run db:migrate --workspace apps/api
npm run db:seed --workspace apps/api            # synthetic demo school (refuses if data exists)
npm run dev                                     # API on :4000, web on http://localhost:5173
```

The demo seed creates users `admin`, `bursar`, `head`, `owner` and `auditor`, all with the password `Demo-pass-2026`. Every name, phone number and amount in it is made up.

## Checks

```bash
npm run typecheck      # both apps
npm test               # 87 API and rule tests against a real Postgres (stja_test)
npm run build
npm run e2e            # 12 browser journeys against a fresh stja_e2e database
```

CI runs all four on every pull request (`.github/workflows/ci.yml`).

## Before real use

Payroll posting ships switched off, because the PAYE bands and NSSF rates in the FRS are old. Read the "Before go-live" list in [docs/build-notes.md](docs/build-notes.md).
