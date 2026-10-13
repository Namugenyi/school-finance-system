# Decisions, assumptions and FRS issues

Phase 1 output for the STJA Finance & Accounts web application. It lists what blocks implementation, what we will assume unless told otherwise, where the FRS contradicts itself, and the changes to the FRS that a web application needs.

ID prefixes: `D` blocking decision, `G` needed before go-live (does not block building), `A` default we will proceed with, `C` conflict or ambiguity in the FRS, `PC` proposed change to the FRS. The traceability matrix refers to these IDs.

## 1. Decisions that block implementation

Each of these changes a financial figure the school will see, and the FRS does not settle it. Building on a guess would mean reworking posted data later. A recommendation is given for each; replying "accept all" adopts every recommendation.

### D-01. What happens to the original charge when its balance is carried forward?

**Why it blocks.** The FRS raises a new Arrears B/F charge in the new term (FR-1102) but leaves the original charge untouched, still showing its unpaid balance. The same debt then appears twice: in the Arrears List "all terms" view (FR-1302), on the Pupil Statement that sums every year (FR-1403), and in Total Billed. When the parent pays the Arrears B/F charge, the original charge still shows Unpaid forever. There is a second problem: if a pupil has arrears in several items, they become several Arrears B/F charges for the same pupil, item and term, which breaks the one-charge-per-pupil-item-term rule (FR-501) that payment matching (BR-02) relies on.

**Options.**
1. *Transfer (recommended).* Carrying forward posts a "transferred to next term" entry on the original charge, so its balance becomes zero and its status reads "Carried forward". The new Arrears B/F charge holds the debt and links back to the original. History stays intact and readable; the debt is counted once. Each source charge produces its own Arrears B/F line (so the debt's age and origin stay visible, FR-1103), and payments are allocated to a specific charge rather than matched by item and term.
2. *Literal FRS.* Leave the original open and accept double counting; reports would need special rules to exclude one side.

**Also decide:** whether Arrears B/F charges count in a term's *Total Billed* and collection rate. Recommended: no. They count in Outstanding, and are shown on their own line ("Arrears brought forward") so new billing and old debt are not mixed.

Affects: FR-501, FR-503, FR-1102, FR-1103, FR-1302, FR-1403, FR-1501, FR-1601, BR-02, BR-20, WR-18.

### D-02. Does "Total Billed" mean before or after discounts?

**Why it blocks.** Balances use Net Amount Due (after discount), but the FRS never says whether Total Billed in the arrears list, statement, reports, dashboard, snapshots and collection rate (BR-07) is gross or net. With gross, Billed − Collected ≠ Outstanding, and discounts make the collection rate look worse than it is.

**Recommended:** Total Billed = sum of Net Amount Due (after approved discounts). Discounts and waivers are reported as their own figure so they stay visible.

Affects: BR-07, FR-1301, FR-1405, FR-1501, FR-1601, FR-1607.

### D-03. How are expenses funded by "Donation" or "Other" reported?

**Why it blocks.** There are five funding sources (FR-702) but BR-11 says Total Expenses = School-Funded + Owner-Funded. Donation and Other fit neither, so either they vanish from the totals or get misclassified, and the surplus/deficit changes accordingly.

**Recommended:** three buckets. School-funded = School Funds. Owner-funded = Owner Contribution + Owner Loan. Other-funded = Donation + Other. Total Expenses = all three, and all three appear on reports, the dashboard and snapshots. BR-11 is amended to match (PC-05).

Affects: BR-11, BR-12, FR-703, FR-1501, FR-1604, FR-1607.

### D-04. How should billing treat "Once Only" and "Every Year" fees?

**Why it blocks.** Each fee item has a charge frequency (FR-403), but the billing generator is a plain "every fee line × every active pupil" (FR-1002) and never uses it. Without a rule, Admission Fees could be charged again every term.

**Recommended:**
- *Once Only* (e.g. Admission Fees): skipped for a pupil who has ever had that item charged.
- *Every Year*: skipped if the pupil already has that item in the same academic year.
- *Every Term*: charged each term (the one-per-term rule still applies).
- Skipped rows appear in the billing preview with the reason, and an authorised user can override one with a recorded reason.

Affects: FR-403, FR-1002, FR-1005, WR-08.

### D-05. Which actions need a second person's approval, and who approves?

**Why it blocks.** The FRS only records an "Approved By" name on expenses (FR-706). The build brief asks for discount approvals, payment reversals and segregation of duties. Whether approval is a gate (nothing counts until approved) or just a record changes every workflow and every total.

**Recommended:**

| Action | Entered by | Approved by | Counts in balances and reports |
|---|---|---|---|
| Discount or waiver | Bursar | Head Teacher | Only after approval |
| Payment reversal | Bursar | Head Teacher | Only after approval |
| Expense | Bursar | Head Teacher or Proprietor | Only after approval |
| Payroll posting | Bursar | Head Teacher or Proprietor | Only after approval |
| Term close | Bursar | Head Teacher | n/a |
| Ordinary payment | Bursar | none (receipted on entry) | Immediately |

The approver must be a different user from the person who entered it. The approver roles stay configurable.

Affects: FR-502, FR-706, CTL-08, WR-02, WR-05, WR-09, WR-14, WR-16, WR-19.

### D-06. Where do receipt numbers come from?

**Why it blocks.** The FRS has staff type the receipt number (FR-602) and requires it to be unique (BR-18), yet also prints several fee items under one receipt number (FR-1203). See C-01. If the school uses pre-printed receipt books, the app must accept typed numbers; otherwise it should issue them.

**Recommended:** the system issues receipt numbers automatically (for example `RCT-2026-00001`), one number per payment visit. One receipt covers one pupil and can pay several fee items. If the school also uses pre-printed books, the book number can be stored as the reference.

Affects: FR-602, FR-604, FR-1201, FR-1203, BR-18.

### D-07. Payroll posting: which amount goes to Expenses, and into which term?

**Why it blocks.** FR-908 posts "the payroll total" under Salaries, but does not say which total (basic pay, net pay, or basic plus employer NSSF). Payroll is monthly, while expenses belong to a year and term, and the FRS never gives terms start and end dates.

**Recommended:**
- Post one Salaries expense per approved monthly run, equal to total basic pay plus employer NSSF (the school's full cost). PAYE and NSSF stay inside that figure rather than being posted again under Taxes.
- Terms get start and end dates in Setup. A month posts to the term containing it; months in a holiday post to the term just ended. The poster can change the term before approving.
- Posting the same run twice is impossible.

Affects: FR-908, SOP-4.2, WR-16.

## 2. Needed before go-live (not blocking the build)

| ID | Item | Why |
|---|---|---|
| G-01 | Is there a live v12 workbook with real records to import (pupils with existing IDs, unpaid balances, payments)? | Decides whether a one-off import with opening balances is in scope, and what the pupil ID sequence starts from. |
| G-02 | Real class names (KG and Primary), fee amounts and staff list. | Setup data. The FRS does not list the class names. Synthetic demo data is used until then. |
| G-03 | Validate PAYE and NSSF rules with a current Ugandan source or payroll professional. | The FRS bands are legacy values. We believe (not verified) that current law adds 10% on monthly income above UGX 10,000,000, and that NSSF is calculated on gross pay rather than basic only. Local Service Tax may also apply as an "other deduction". Payroll can be built and tested, but stays disabled in production until signed off. |
| G-04 | Hosting and budget: where the app will run, who pays, and the domain name. | Deployment thread. |
| G-05 | The real users and which role each holds; whether one person may hold two roles. | Small schools often have one person covering two roles, which interacts with D-05. |
| G-06 | School details for receipts and statements: full name, address, phone, email, logo, and any registration or TIN number to print. | Receipt and statement headers. |

## 3. Defaults we will proceed with

These follow from the FRS or are low-risk. Tell us if any is wrong.

| ID | Default |
|---|---|
| A-01 | Stack (repo is empty): React + TypeScript + Vite + Tailwind; TypeScript API (NestJS); PostgreSQL with Prisma; Vitest and Playwright; one modular monolith. Details in thread 2. |
| A-02 | Charge, payment, expense and contribution IDs are system-generated (the FRS has them typed as "manual sequence"). |
| A-03 | Money stored as exact decimals, NUMERIC(14,2), in UGX. Shown with thousands separators and two decimals as FR-405 says (e.g. 1,250,000.00). Dates shown DD/MM/YYYY, timezone Africa/Kampala (UTC+3). |
| A-04 | Pupil ID: the sequence runs per start-year prefix (STJA-2026-0001, 0002, …). If the start-year parameter changes, numbering restarts at 0001 under the new year. IDs are never reused, even for deleted drafts. |
| A-05 | Pupil history is written automatically on enrolment, promotion, class change and status change, instead of being typed separately (SOP-1.3). |
| A-06 | Reason for leaving is a selectable list (Transferred, Completed, Withdrawn by parent, Other + note), editable in Setup. |
| A-07 | Reference values that drive logic (pupil statuses, payment statuses, funding sources, Arrears B/F, Salaries category) can be relabelled but not deleted. Other values can be deactivated, never hard-deleted once used. |
| A-08 | Mandatory/Optional is set per fee-structure line, defaulting from the fee item. In the billing preview, Optional items can be removed per pupil; Mandatory items cannot. |
| A-09 | A payment must be allocated to an existing charge. Paying before billing is not supported (BR-17). |
| A-10 | Overpayment is allowed with a warning and leaves a credit on that charge. Credits are shown, not carried forward (BR-19), and cannot yet be refunded or moved to another item. Discounts up to 100% of the charge are allowed; above is blocked. |
| A-11 | The receiving officer is the logged-in user who records the payment. |
| A-12 | Phone numbers validated as Ugandan numbers (+256 or 0 followed by 9 digits). |
| A-13 | One receipt is for one pupil. Lines may belong to different terms; each line shows its year and term. |
| A-14 | "Unpaid items" on the arrears list counts charges with a balance above zero (Unpaid + Partial). Pupil-level overall status applies BR-04 to BR-06 to the pupil's totals ("Paid in Full", "Partial", "Unpaid"). |
| A-15 | Owner loan repayments are not in the FRS. R1 records loans received and shows the outstanding loan total; repayment tracking is deferred and listed as a known gap. |
| A-16 | The statement lists all payments, newest first, rather than an undefined "recent" subset. |
| A-17 | "Active pupils" for a term = pupils whose history shows them Active in that term. |
| A-18 | Outstanding by class uses the class recorded on the charge at billing time, not the pupil's current class. |
| A-19 | A payroll line whose net pay would be negative is rejected with an explanation. |
| A-20 | A payment counts in the period of the charge it pays, as the FRS's year/term columns do. A cash-received-by-date view is added to the income report. |
| A-21 | Supported browsers: current Chrome, Edge, Firefox and Safari, desktop and mobile. |
| A-22 | Capacity figures in NFR-11 are a floor; performance is tested at ten times those volumes. |
| A-23 | Fee structure screen offers "copy from previous term" to speed up SOP-1.4. Nothing posts without review. |
| A-24 | Once a term is closed, new or changed transactions for it need Head Teacher approval and are listed as post-close exceptions; re-closing creates a new snapshot version and keeps the original (WR-19). |

## 4. Conflicts and ambiguities found in the FRS

| ID | Issue | Resolution |
|---|---|---|
| C-01 | FR-604 and BR-18 require each receipt number to appear once in Payments, but FR-1203 puts several fee items under the same receipt number, which would trigger the duplicate flag in the workbook itself. | Split into a receipt (unique number) with several payment lines. PC-03, D-06. |
| C-02 | Payments match charges by pupil + item + year + term (BR-02). This fails as soon as two charges share those values, which carry-forward creates. | Payment lines point at a specific charge. D-01. |
| C-03 | Carry-forward leaves the source balance open, so the debt is counted twice. | D-01. |
| C-04 | Charge frequency is captured but never used by billing. | D-04. |
| C-05 | BR-11 covers two funding buckets; FR-702 has five sources. | D-03. |
| C-06 | "Total Billed" is not defined as gross or net. | D-02. |
| C-07 | Payroll is monthly; expenses and snapshots are termly; terms have no dates. | D-07. |
| C-08 | Fee structure keys on both section and class, but a class belongs to exactly one section; separate KG and Primary class lists duplicate the All Classes list. | Class carries its section; the three class lists become one Class table with a section. PC-03. |
| C-09 | The FRS never says whether owner cash contributions are income. BR-21 only covers loans. | Cash contributions are funding, not operating income (consistent with BR-12, which uses fee collections only). Reported separately. |
| C-10 | The data dictionary skips columns (Charges C and F, Payments E, Expenses F, H, J). | Inferred from the FR text; listed in matrix rows DD-*. |
| C-11 | FR-205 colours only Active and Withdrawn; three statuses have no colour. | Neutral styling with text labels for the others. |
| C-12 | FR-1404 says "recent" payments without a number. | A-16. |
| C-13 | Snapshot "active pupil count" is computed from current status, so a past term's figure would drift. | A-17. |

## 5. Proposed changes to the FRS

The FRS describes an Excel workbook. These changes keep its business meaning while replacing spreadsheet mechanics. They should be recorded as a new FRS revision if the school keeps the FRS as its baseline document.

| ID | Change | Why |
|---|---|---|
| PC-01 | Copy/paste-values steps (FR-1006, SOP-1.7, SOP-4.4) become a preview and an explicit, confirmed Post action. Array-formula and Excel compatibility requirements (FR-1007, NFR-01, NFR-02, NFR-13) do not apply. | The review-before-commit intent is kept; the error-prone manual copy is removed and posting becomes atomic and repeat-safe. |
| PC-02 | The single Setup table becomes one managed list per vocabulary. | Same guarantees (FR-101 to FR-104) with database constraints. |
| PC-03 | Receipts become a header (number, date, pupil, method, reference, officer) with lines (charge, amount). Classes carry their section. | Resolves C-01 and C-08. |
| PC-04 | Multi-user operation with logins, roles, approvals and an audit log replaces the single-user assumption (SCP-EX-03, ASM-05, CON-01). | Required for a web application. |
| PC-05 | BR-11 becomes Total Expenses = School-Funded + Owner-Funded + Other-Funded (subject to D-03). | Resolves C-05. |
| PC-06 | Duplicate receipt numbers are blocked, not flagged (FR-604, CTL-03, AC-10). | Stronger control with the same intent. |
| PC-07 | Carry-forward closes the source balance with a transfer entry (subject to D-01). | Resolves C-02 and C-03. |
| PC-08 | Discount approval trail brought forward from FUT-02 into the first release. | Requested in the build brief. |
| PC-09 | Payment reversals, term re-close versions and post-close exceptions added. | The FRS has no correction process; the build brief requires one. |

## 6. Dependencies and risks

| Risk | Impact | Mitigation |
|---|---|---|
| Blocking decisions D-01 to D-07 unanswered | Core finance build (thread 3) stalls or builds on guesses | Thread 2 designs for the recommended options; anything not yet confirmed is isolated behind one service so a different answer is a contained change. |
| Statutory payroll rules out of date | Wrong deductions on real payslips | Payroll ships disabled in production until G-03 is signed off; rates are effective-dated configuration. |
| No migration path from the current workbook | Opening balances wrong at go-live | Decide G-01 early; an import with reconciliation report would be its own task. |
| One person holding several roles | Segregation of duties can't be enforced | G-05; the app can flag self-approval attempts and require Proprietor approval instead. |
| Hosting and connectivity in Kasangati | Slow or unavailable app | Light pages, server-side pagination, print-friendly views; hosting choice in G-04. |
