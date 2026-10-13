# Requirements summary

Phase 1 of the STJA Finance & Accounts web application: requirements analysis of **STJA-FRS-v12** (Version 12, "Baselined — As-Built Specification", 21 pages).

| Document | Contents |
|---|---|
| 01-requirements-summary.md (this file) | What the FRS asks for, how it maps to web modules, release scope, outline plan |
| [02-traceability-matrix.md](02-traceability-matrix.md) | Every requirement with module, entities, UI, logic and planned tests ([CSV](traceability-matrix.csv)) |
| [03-decisions-and-issues.md](03-decisions-and-issues.md) | Decisions D-01 to D-07 (all approved 13/10/2026), go-live needs, defaults, FRS conflicts, proposed FRS changes, risks |

## 1. Confirmation of inputs

- **FRS.** The full PDF (21 pages: document control, architecture, functional requirements FR-100 to FR-1600, business rules, PAYE bands, data dictionary, NFRs, controls, SOPs, assumptions, constraints, future scope, acceptance criteria) was read in full on 13/10/2026.
- **Repository.** `Namugenyi/school-finance-system` was empty: no commits, no branches, no existing code or conventions to preserve. The preferred stack from the build brief therefore applies (A-01).

## 2. What the system is

A cash-basis fee billing and collection system for one school (Kindergarten and Primary sections, three terms a year, UGX), with expenses tracked by funding source, owner money kept apart from school income, a small payroll, term-end archives and management reporting. It is not a general ledger, not a school management system (no grades, attendance or report cards), and not integrated with banks, mobile money, URA or NSSF.

The FRS describes an 18-sheet Excel workbook used by one person. The web version keeps the business rules and workflow order (configure, register, bill, collect, spend, pursue, close, analyse) but replaces spreadsheet mechanics (paste-values, array formulas, cell colours) with validated forms, previews and explicit posting, and adds what a multi-user web app needs: logins, roles, approvals and an audit trail.

## 3. Requirement counts

| Group | Source | Count | Notes |
|---|---|---|---|
| Functional requirements | FRS 3-5 | 93 | 88 Mandatory, 5 Desirable (FR-205, FR-506, FR-508, FR-704, FR-1608) |
| Business rules | FRS 6 | 24 + 4 PAYE bands | All Mandatory |
| Data dictionary | FRS 7 | 4 tables | Pupils, Charges, Payments, Expenses |
| Non-functional | FRS 8 | 14 | 3 Excel-only, 6 kept with a web equivalent, 5 kept as written |
| Controls | FRS 9 | 12 | All kept |
| Operating procedures | FRS 10 | 23 steps | Become guided workflows and the user guide |
| Scope exclusions, assumptions, constraints | FRS 1.4, 11.1, 11.2 | 6 + 7 + 5 | Single-user assumptions superseded |
| Future enhancements | FRS 11.3 | 8 | Out of R1, except the discount approval trail from FUT-02 |
| Acceptance criteria | FRS 11.4 | 12 | Each mapped to web tests |
| Web requirements | Build brief | 33 | Security, approvals, reversals, idempotency, audit, ops |
| **Total traced** | | **245** | |

Every FRS requirement is in the matrix. None is dropped silently: the four that only make sense in Excel (FR-1007, NFR-01, NFR-02, NFR-13) are marked `N/A (Excel-only)` with the reason.

## 4. Worksheet to module map

| Code | Web module | FRS worksheets | Build thread |
|---|---|---|---|
| M01 | App shell, home, navigation, formatting | Home | 3 |
| M02 | Setup: reference lists, academic years and terms, classes, school settings, payroll rates | Setup | 3 |
| M03 | Pupils: register, detail, status changes, history | Pupils, Pupil_History | 3 |
| M04 | Fee structure: fee items, fee schedule per year/term/class | Fee_Structure | 3 |
| M05 | Charges ledger, discounts and waivers | Charges | 3 |
| M06 | Term billing: preview, review, post | Term_Billing | 3 |
| M07 | Payments: record, search, reverse | Payments | 3 |
| M08 | Receipts: view, print, PDF | Receipt | 3 |
| M09 | Arrears list and follow-up | Arrears_List | 3 |
| M10 | Pupil statements | Pupil_Statement | 3 |
| M11 | Expenses and approvals | Expenses | 4 |
| M12 | Owner contributions and loans | Owner_Contributions | 4 |
| M13 | Staff and payroll | Payroll | 4 |
| M14 | Carry forward | Carry_Forward | 4 |
| M15 | Term close and snapshots | Term_Snapshots | 4 |
| M16 | Reports | Reports | 4 |
| M17 | Dashboard | Dashboard | 4 |
| M18 | Users, roles, approvals, audit log (web-only) | none | 3 (foundation) |

## 5. Initial release (R1) scope

**In R1:** every Mandatory and Desirable FRS requirement (with the web equivalents in the matrix), all 12 controls, all SOP workflows, and the 33 build-brief requirements (WR-01 to WR-33), including the discount approval trail from FUT-02.

**Not in R1:** FUT-01, FUT-03 to FUT-08 (FUT-08 multi-class billing may be pulled in if cheap), owner loan repayment tracking (A-15), refunds or transfers of credit balances (A-10), import of the current workbook unless G-01 says otherwise, and everything in the FRS scope exclusions.

**R1 but disabled in production until signed off:** payroll calculations (G-03).

## 6. Outline architecture, entities and plan

Thread 2 (design) owns the detail; this is the starting point it inherits.

**Architecture.** One modular monolith: React + TypeScript (Vite, Tailwind) frontend; NestJS API; PostgreSQL via Prisma with versioned migrations; all financial calculations in tested backend services (ChargeCalculator, PayrollCalculator, ReportingService) shared by screens, reports, dashboard and snapshots so figures reconcile by construction.

**Core entities.** SchoolSettings, AcademicYear, Term (with dates), Section, Class, ReferenceList, ReferenceValue, User, Role, Permission, UserRoleAssignment, Pupil, PupilHistory, FeeItem, FeeStructure, Charge, ChargeDiscount, ChargeTransfer (if D-01 option 1), BillingBatch, Payment (receipt), PaymentLine, PaymentReversal, Expense, OwnerContribution, Staff, StatutoryRateSet, TaxBand, PayrollPeriod, PayrollRun, PayrollEntry, CarryForwardBatch, TermSnapshot, ApprovalRecord, AuditLog, IdSequence.

**Navigation.** Home dashboard; *Entry*: Pupils, Fees, Charges, Payments, Expenses, Owner funds, Payroll; *Operations*: Term billing, Carry forward, Receipts, Term close; *Reports*: Arrears, Statements, Reports, Snapshots, Dashboard; *Admin*: Setup, Users and roles, Audit log.

**Plan.**
1. Thread 1 (this): requirements, matrix, decisions.
2. Thread 2: architecture decision record, schema and migrations, API contracts, role and permission matrix, screen inventory and journeys.
3. Thread 3: auth and permissions, Setup, Pupils, Fee structure, Charges, Term billing, Payments, Receipts, Arrears, Statements, with unit, integration and E2E tests.
4. Thread 4: Expenses, Owner funds, Payroll, Carry forward, Term close, Reports, Dashboard, deployment, backup and user guide.

Each phase is validated (tests and build green) before the next starts.

## 7. Planned end-to-end journeys

These are the 16 browser journeys from the build brief; the matrix refers to them as E2E-01 to E2E-16.

1. Configure year, term, classes and fee structure. 2. Register a pupil and check the ID. 3. Generate a term bill for Active pupils. 4. Review and post the bill. 5. Partial payment, check balance. 6. Further payment, check Paid. 7. Print the receipt. 8. Statement with historical totals. 9. Arrears and carry-forward. 10. School- and owner-funded expenses. 11. Owner loan not counted as income. 12. Payroll run. 13. Payroll posted once only. 14. Reports reconcile. 15. Term close; snapshot unchanged afterwards. 16. Unauthorised actions denied.
