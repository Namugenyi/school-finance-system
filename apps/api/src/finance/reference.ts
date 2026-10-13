/**
 * Reference lists (FR-105). Codes are stored on records; labels are what people see and can be
 * relabelled in Setup. Lists marked locked hold vocabularies the FRS fixes (e.g. FR-204, FR-603).
 * Academic years, terms, sections, classes and fee items have their own tables because the
 * system needs more than a label for them (dates, section of a class, fee frequency).
 */
export interface RefSeed {
  code: string;
  name: string;
  description: string;
  locked: boolean;
  values: Array<{ code: string; label: string; system?: boolean }>;
}

export const REFERENCE_LISTS: RefSeed[] = [
  {
    code: 'SEX', name: 'Sex', description: 'Pupil sex', locked: false,
    values: [{ code: 'MALE', label: 'Male' }, { code: 'FEMALE', label: 'Female' }],
  },
  {
    code: 'PUPIL_STATUS', name: 'Pupil Status', description: 'Enrolment status (FR-204). Only Active pupils are billed.', locked: true,
    values: [
      { code: 'ACTIVE', label: 'Active', system: true },
      { code: 'WITHDRAWN', label: 'Withdrawn', system: true },
      { code: 'COMPLETED', label: 'Completed', system: true },
      { code: 'TRANSFERRED', label: 'Transferred', system: true },
      { code: 'ALUMNI', label: 'Alumni', system: true },
    ],
  },
  {
    code: 'MANDATORY_OPTIONAL', name: 'Mandatory/Optional', description: 'Fee classification (FR-402)', locked: true,
    values: [{ code: 'MANDATORY', label: 'Mandatory', system: true }, { code: 'OPTIONAL', label: 'Optional', system: true }],
  },
  {
    code: 'CHARGE_FREQUENCY', name: 'Charge Frequency', description: 'How often a fee item is charged (FR-403)', locked: true,
    values: [
      { code: 'ONCE', label: 'Once Only', system: true },
      { code: 'TERM', label: 'Every Term', system: true },
      { code: 'YEAR', label: 'Every Year', system: true },
    ],
  },
  {
    code: 'PAYMENT_METHOD', name: 'Payment Method', description: 'How money was paid (FR-603)', locked: true,
    values: [
      { code: 'CASH', label: 'Cash', system: true },
      { code: 'MOBILE_MONEY', label: 'Mobile Money', system: true },
      { code: 'BANK_TRANSFER', label: 'Bank Transfer', system: true },
      { code: 'CHEQUE', label: 'Cheque', system: true },
    ],
  },
  {
    code: 'PAYMENT_STATUS', name: 'Payment Status', description: 'Derived status of a charge (FR-505)', locked: true,
    values: [
      { code: 'PAID', label: 'Paid', system: true },
      { code: 'PARTIAL', label: 'Partial', system: true },
      { code: 'UNPAID', label: 'Unpaid', system: true },
      { code: 'CARRIED_FORWARD', label: 'Carried forward', system: true },
      { code: 'VOID', label: 'Void', system: true },
    ],
  },
  {
    code: 'EXPENSE_CATEGORY', name: 'Expense Category', description: 'Expenditure categories (FR-705)', locked: false,
    values: [
      { code: 'RENT', label: 'Rent' },
      { code: 'ELECTRICITY', label: 'Electricity' },
      { code: 'WATER', label: 'Water' },
      { code: 'SALARIES', label: 'Salaries', system: true },
      { code: 'TAXES', label: 'Taxes' },
      { code: 'DISTRICT_LICENSES', label: 'District Licenses' },
      { code: 'TRANSPORT', label: 'Transport' },
      { code: 'CONSTRUCTION', label: 'Construction' },
      { code: 'FOOD_AND_DRINKS', label: 'Food and Drinks' },
      { code: 'COOKING_CHARCOAL', label: 'Cooking Charcoal' },
      { code: 'REPAIRS_AND_MAINTENANCE', label: 'Repairs and Maintenance' },
      { code: 'MISCELLANEOUS', label: 'Miscellaneous' },
    ],
  },
  {
    code: 'FUNDING_SOURCE', name: 'Funding Source', description: 'Where money for an expense came from (FR-702)', locked: true,
    values: [
      { code: 'SCHOOL_FUNDS', label: 'School Funds', system: true },
      { code: 'OWNER_CONTRIBUTION', label: 'Owner Contribution', system: true },
      { code: 'OWNER_LOAN', label: 'Owner Loan', system: true },
      { code: 'DONATION', label: 'Donation', system: true },
      { code: 'OTHER', label: 'Other', system: true },
    ],
  },
  {
    code: 'CONTRIBUTION_TYPE', name: 'Contribution Type', description: 'Owner contribution types (FR-801)', locked: true,
    values: [
      { code: 'CASH', label: 'Cash Contribution', system: true },
      { code: 'EXPENSE_PAID_DIRECTLY', label: 'Expense Paid Directly', system: true },
      { code: 'LOAN', label: 'Loan', system: true },
    ],
  },
  {
    code: 'LEAVING_REASON', name: 'Reason for Leaving', description: 'Why a pupil left (A-06)', locked: false,
    values: [
      { code: 'TRANSFERRED', label: 'Transferred' },
      { code: 'COMPLETED', label: 'Completed' },
      { code: 'WITHDRAWN_BY_PARENT', label: 'Withdrawn by parent' },
      { code: 'OTHER', label: 'Other' },
    ],
  },
  {
    code: 'EMPLOYMENT_TYPE', name: 'Employment Type', description: 'Staff employment types (FR-901)', locked: false,
    values: [
      { code: 'PERMANENT', label: 'Permanent' },
      { code: 'CONTRACT', label: 'Contract' },
      { code: 'PART_TIME', label: 'Part-time' },
      { code: 'CASUAL', label: 'Casual' },
    ],
  },
];

export const FEE_ITEMS: Array<{ code: string; name: string; defaultMandatory: boolean; frequency: 'ONCE' | 'TERM' | 'YEAR'; isSystem?: boolean }> = [
  { code: 'ADMISSION', name: 'Admission Fees', defaultMandatory: true, frequency: 'ONCE' },
  { code: 'SCHOOL_FEES', name: 'School Fees', defaultMandatory: true, frequency: 'TERM' },
  { code: 'REQUIREMENTS', name: 'Requirements', defaultMandatory: true, frequency: 'TERM' },
  { code: 'UNIFORM', name: 'School Uniform', defaultMandatory: false, frequency: 'YEAR' },
  { code: 'HOLIDAY_PACKAGE', name: 'Holiday Package', defaultMandatory: false, frequency: 'TERM' },
  { code: 'MEALS', name: 'Breakfast and Lunch', defaultMandatory: true, frequency: 'TERM' },
  { code: 'READING_MATERIALS', name: 'Reading Materials', defaultMandatory: false, frequency: 'YEAR' },
  { code: 'SWIMMING', name: 'Swimming', defaultMandatory: false, frequency: 'TERM' },
  { code: 'KIDS_DAY_OUT', name: 'Kids Day Out', defaultMandatory: false, frequency: 'TERM' },
  { code: 'AFTERNOON_STAY', name: 'Afternoon Stay', defaultMandatory: false, frequency: 'TERM' },
  { code: 'BOARDING', name: 'Boarding Fee', defaultMandatory: false, frequency: 'TERM' },
  { code: 'ARREARS_BF', name: 'Arrears B/F', defaultMandatory: true, frequency: 'TERM', isSystem: true },
];

export const ARREARS_FEE_CODE = 'ARREARS_BF';
