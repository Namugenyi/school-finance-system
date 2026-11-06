# Specialist agents

Claude Code subagents for this app, in `.claude/agents/`. Each one is a specialist with its own instructions about this school's rules, code and conventions. Claude picks the right one on its own when a task matches its description, or you can name one.

| Agent | What it does | Changes files? |
|---|---|---|
| `code-reviewer` | Reviews a change for bugs, money and date handling, permissions, audit trail and missing tests | No |
| `security-reviewer` | Sign-in, sessions, roles, no self-approval, approval limit, data exposure, secrets (OWASP) | No |
| `finance-rules-auditor` | Checks the code against the FRS, the v14 workbook, decisions D-01 to D-07 and later school rules, and that all figures agree | No |
| `test-engineer` | Writes and runs Vitest API tests and Playwright journeys | Yes, tests only |
| `database-reviewer` | Prisma schema, migrations on existing data, the balance view, indexes and slow queries | No |
| `ui-accessibility-reviewer` | Plain language, UGX and DD/MM/YYYY formats, WCAG 2.2 AA, phone layout, printing, school colours | No |
| `release-checker` | Runs every check before release and gives a go or no-go with open go-live items | No |

## Using them

In Claude Code, from this repository:

- Ask in words: "Use the finance-rules-auditor to check the billing change", or "Have the security-reviewer look at this branch".
- Or type `@` and pick the agent by name.
- `/agents` lists them and lets you edit one.

A typical change goes: build it, `test-engineer` adds the tests, `code-reviewer` and `finance-rules-auditor` review it (plus `security-reviewer` for anything touching sign-in, roles or approvals, `database-reviewer` for schema changes, `ui-accessibility-reviewer` for screens), then `release-checker` before it goes to the school.

The reviewers only read and report, so they can't change the app by accident. Their findings are advice: a person decides what to fix.
