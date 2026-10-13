export interface Me {
  id: number;
  username: string;
  fullName: string;
  roles: string[];
  permissions: string[];
  csrfToken: string;
  mustChangePassword: boolean;
}

export interface RefValue { id: number; code: string; label: string; active: boolean; isSystem: boolean }
export interface Term { id: number; academicYearId: number; year: number; number: number; name: string; label: string; startDate: string; endDate: string; status: string }
export interface Lookups {
  lists: Record<string, RefValue[]>;
  years: Array<{ id: number; year: number; terms: Term[] }>;
  terms: Term[];
  currentTermId: number | null;
  sections: Array<{ id: number; code: string; name: string; active: boolean }>;
  classes: Array<{ id: number; name: string; sectionId: number; sectionName: string; active: boolean; sortOrder: number }>;
  feeItems: Array<{ id: number; code: string; name: string; defaultMandatory: boolean; frequency: string; isSystem: boolean; active: boolean }>;
  school: { name: string; payrollEnabled: boolean };
}

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }

export interface Charge {
  id: number; chargeNo: string; pupilId: number; pupilCode: string; pupilName: string; termId: number; termLabel: string; year: number;
  classId: number; className: string; feeItemId: number; feeItemName: string; isArrears: boolean; arrearsFrom: string | null;
  amountCharged: string; discount: string; pendingDiscount: string; netDue: string; totalPaid: string; carriedForward: string;
  balance: string; status: string; dueDate: string | null; notes: string | null; voided: boolean; postClose: boolean;
}

export type Figures = Record<string, string | number | null>;
