/**
 * Every permission the API checks. Roles are configurable in the app (WR-01); this list is
 * fixed because each key guards specific server code.
 */
export const PERMISSIONS = {
  'setup.view': 'View setup and reference data',
  'setup.manage': 'Change setup, reference lists, years, terms, classes and fee items',
  'users.manage': 'Manage user accounts and roles',
  'audit.view': 'View the audit log',
  'pupils.view': 'View pupils',
  'pupils.contacts': 'View parent and guardian contact details',
  'pupils.manage': 'Register and edit pupils, change status and class',
  'fees.view': 'View the fee structure',
  'fees.manage': 'Change the fee structure',
  'charges.view': 'View charges',
  'charges.manage': 'Raise and void individual charges',
  'discounts.request': 'Request discounts and waivers',
  'discounts.approve': 'Approve or reject discounts and waivers',
  'billing.run': 'Run term billing',
  'payments.view': 'View payments and receipts',
  'payments.record': 'Record payments and issue receipts',
  'payments.reverse.request': 'Request a payment reversal',
  'payments.reverse.approve': 'Approve or reject payment reversals',
  'arrears.view': 'View the arrears list',
  'statements.view': 'View pupil statements',
  'expenses.view': 'View expenses',
  'expenses.manage': 'Record expenses',
  'expenses.approve': 'Approve or reject expenses',
  'owner.view': 'View owner contributions and loans',
  'owner.manage': 'Record owner contributions and loans',
  'payroll.view': 'View staff, salaries and payroll',
  'payroll.manage': 'Manage staff and prepare payroll runs',
  'payroll.approve': 'Approve payroll runs and post them to expenses',
  'payroll.rates': 'Change PAYE and NSSF rates',
  'carryforward.run': 'Carry unpaid balances forward',
  'termclose.prepare': 'Prepare term close snapshots',
  'termclose.approve': 'Approve term close',
  'term.postClosed': 'Record transactions in a closed term (post-close exceptions)',
  'reports.view': 'View financial reports',
  'dashboard.view': 'View the dashboard',
  'snapshots.view': 'View term snapshots',
  'approvals.view': 'See the approvals inbox',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

const VIEW_FINANCE: Permission[] = [
  'pupils.view', 'fees.view', 'charges.view', 'payments.view', 'arrears.view', 'statements.view',
  'expenses.view', 'owner.view', 'reports.view', 'dashboard.view', 'snapshots.view', 'setup.view',
];

/** Starting role design (WR-01, D-05). Administrators can change any of it in Users & roles. */
export const DEFAULT_ROLES: Array<{ code: string; name: string; description: string; permissions: Permission[] }> = [
  {
    code: 'ADMIN',
    name: 'School Administrator',
    description: 'School configuration, reference data, users, pupil records.',
    permissions: [
      'setup.view', 'setup.manage', 'users.manage', 'audit.view',
      'pupils.view', 'pupils.contacts', 'pupils.manage', 'fees.view', 'fees.manage',
      'charges.view', 'payments.view', 'arrears.view', 'statements.view', 'expenses.view',
      'owner.view', 'reports.view', 'dashboard.view', 'snapshots.view',
    ],
  },
  {
    code: 'BURSAR',
    name: 'Bursar / Finance Officer',
    description: 'Billing, payments, receipts, arrears, expenses, payroll preparation, period tasks.',
    permissions: [
      ...VIEW_FINANCE, 'pupils.contacts', 'pupils.manage', 'fees.manage', 'charges.manage',
      'discounts.request', 'billing.run', 'payments.record', 'payments.reverse.request',
      'expenses.manage', 'owner.manage', 'payroll.view', 'payroll.manage', 'carryforward.run',
      'termclose.prepare', 'approvals.view',
    ],
  },
  {
    code: 'HEAD_TEACHER',
    name: 'Head Teacher / Principal',
    description: 'Reviews performance and approves discounts, reversals, expenses, payroll and term close.',
    permissions: [
      ...VIEW_FINANCE, 'pupils.contacts', 'discounts.approve', 'payments.reverse.approve',
      'expenses.approve', 'payroll.view', 'payroll.approve', 'termclose.approve', 'term.postClosed',
      'approvals.view', 'audit.view',
    ],
  },
  {
    code: 'PROPRIETOR',
    name: 'Proprietor / Owner',
    description: 'Financial summaries, owner funds, collection performance, surplus and deficit.',
    permissions: [...VIEW_FINANCE, 'expenses.approve', 'payroll.view', 'payroll.approve', 'approvals.view'],
  },
  {
    code: 'AUDITOR',
    name: 'Auditor (read only)',
    description: 'Read-only access to records, reports, snapshots and the audit trail.',
    permissions: [...VIEW_FINANCE, 'payroll.view', 'audit.view'],
  },
];
