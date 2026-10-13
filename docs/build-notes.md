# Build notes

How the build implements STJA-FRS-v12 and the seven decisions Tina approved on 13/10/2026, and what still needs the school before real use.

## Architecture

- **Database**: PostgreSQL. Money is `NUMERIC(14,2)`, never floating point. Balances, statuses and the paid and discount totals are not stored: a database view (`ChargeBalance`) works them out from the charges, approved discounts, non-reversed payments and carry-forwards, so they cannot drift.
- **API**: Express and TypeScript. Every action checks a named permission on the server; the screens only hide what the server would refuse anyway. Sessions are httpOnly cookies with a CSRF token, five failed sign-ins lock an account for 15 minutes, and sessions end after 60 idle minutes.
- **Web**: React, served by the API in production. Lists are paged on the server, every list can be exported to CSV, and receipts, statements, payslips and reports have print layouts (A4).
- **One set of figures**: billed, collected, outstanding, collection rate, expenses and net result come from one function (`apps/api/src/finance/figures.ts`). The dashboard, reports, term close and snapshots all call it, so they always agree.
- **Audit**: every change writes who, when, what, the before and after values and any reason. Nothing financial is deleted: charges are voided, payments reversed, and snapshots superseded.

## The seven decisions

| Decision | How it is built |
|---|---|
| D-01 Carry-forward counts a debt once | Carrying forward marks the old charge as carried (it shows "Carried forward" with nothing left to pay) and raises an Arrears B/F charge in the new term that names where the debt came from. Arrears B/F is left out of "billed". |
| D-02 Billed is net of discounts | Discounts are requests until approved; only approved ones reduce billed. |
| D-03 Three funding groups | Expenses are school-funded, owner-funded (contribution or loan) or other-funded (donation, other). Owner money is never counted as income. |
| D-04 Once-only and yearly fees | Billing skips a once-only fee already charged and a yearly fee already charged that year, unless the bursar gives a reason, which is stored on the charge. |
| D-05 Approvals by someone else | Discounts, payment reversals, expenses, payroll runs and term close need approval by a different person from whoever entered them. The server enforces this even for an administrator. |
| D-06 System receipts | Receipt numbers are issued by the system (RCT-YYYY-NNNNN). One receipt can cover several fee items. |
| D-07 Payroll posting | An approved run posts one Salaries expense of basic pay plus employer NSSF, in the term containing the 15th of the month, or the term that just ended for a holiday month. The bursar can change the term before submitting. |

Other choices made where the FRS left a gap:

- An overpayment is allowed only after the cashier confirms it, and shows as a credit (marked "CR") on that fee item.
- A closed term can still be corrected by someone with the "post to a closed term" permission (the head teacher by default). Such entries are flagged, listed on the term close page, and need a revised snapshot. The approved snapshot is frozen by the database and kept.
- Approving a term close re-checks the live figures. If anything changed since the snapshot was prepared, approval is refused.
- Repeating a billing run, a payment or a carry-forward (a double click or a dropped connection) cannot create duplicates.
- Owner loan repayments are not tracked yet; the report shows loans received to date.

## Before go-live

These need the school, not more code:

1. **G-03 Payroll rates.** The PAYE bands and NSSF rates loaded at start are the FRS values. We believe, but have not verified, that current law adds a 10% band above UGX 10,000,000 a month and calculates NSSF on gross pay. An accountant should confirm the current rules; enter them under Payroll > Rates, mark them as checked, then switch payroll posting on in Setup.
2. **G-01 Existing records.** If there is a live workbook with pupils and unpaid balances, opening balances need importing. That is a separate task, with a reconciliation report.
3. **G-02 Real setup data.** Class names, fee amounts and the staff list are entered in Setup, Fee structure and Payroll.
4. **G-04 Hosting.** Where it runs, the domain, and HTTPS. See [deployment.md](deployment.md).
5. **G-05 Users.** The real users and their roles. If one person holds two roles, approvals still need a second person.
6. **G-06 School details.** Name, address, phone, email and registration number for receipts and statements (Setup > School). A logo is not printed yet.

## Tests

- `apps/api/test`: 87 tests against a real Postgres, covering the money rules, permissions, approvals by a second person, duplicate protection, carry-forward, payroll, term close, reports reconciling to each other, and security (CSRF, lockout, session expiry, CSV formula injection).
- `apps/web/e2e`: 12 browser journeys through the real screens, from registering a pupil to carrying arrears into the next year.
