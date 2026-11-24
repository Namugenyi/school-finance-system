-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" INTEGER NOT NULL,
    "permission" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permission")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" INTEGER NOT NULL,
    "roleId" INTEGER NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" SERIAL NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER,
    "username" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdSequence" (
    "key" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL,

    CONSTRAINT "IdSequence_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SchoolSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "schoolName" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "registrationNo" TEXT,
    "pupilIdStartYear" INTEGER NOT NULL,
    "receiptFooter" TEXT,
    "payrollEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceList" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReferenceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceValue" (
    "id" SERIAL NOT NULL,
    "listId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferenceValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademicYear" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcademicYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademicTerm" (
    "id" SERIAL NOT NULL,
    "academicYearId" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "AcademicTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Section" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolClass" (
    "id" SERIAL NOT NULL,
    "sectionId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SchoolClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pupil" (
    "id" SERIAL NOT NULL,
    "pupilCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "sex" TEXT NOT NULL,
    "dateOfBirth" DATE,
    "dateJoined" DATE NOT NULL,
    "classId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "guardianName" TEXT,
    "phonePrimary" TEXT,
    "phoneAlt" TEXT,
    "address" TEXT,
    "emergencyContact" TEXT,
    "notes" TEXT,
    "dateLeft" DATE,
    "leavingReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" INTEGER,

    CONSTRAINT "Pupil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PupilHistory" (
    "id" SERIAL NOT NULL,
    "pupilId" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "termId" INTEGER,
    "classId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "leavingReason" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "correctedAt" TIMESTAMP(3),
    "correctedById" INTEGER,

    CONSTRAINT "PupilHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeItem" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultMandatory" BOOLEAN NOT NULL DEFAULT true,
    "frequency" TEXT NOT NULL DEFAULT 'TERM',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FeeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeStructure" (
    "id" SERIAL NOT NULL,
    "termId" INTEGER NOT NULL,
    "classId" INTEGER NOT NULL,
    "feeItemId" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "mandatory" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" INTEGER,

    CONSTRAINT "FeeStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" SERIAL NOT NULL,
    "chargeNo" TEXT NOT NULL,
    "pupilId" INTEGER NOT NULL,
    "termId" INTEGER NOT NULL,
    "classId" INTEGER NOT NULL,
    "feeItemId" INTEGER NOT NULL,
    "amountCharged" DECIMAL(14,2) NOT NULL,
    "dueDate" DATE,
    "billingBatchId" INTEGER,
    "sourceChargeId" INTEGER,
    "carriedForwardAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "carryForwardBatchId" INTEGER,
    "frequencyOverrideReason" TEXT,
    "postClose" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" INTEGER,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" INTEGER,

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeDiscount" (
    "id" SERIAL NOT NULL,
    "chargeId" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedById" INTEGER NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" INTEGER,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "ChargeDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingBatch" (
    "id" SERIAL NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "termId" INTEGER NOT NULL,
    "classId" INTEGER NOT NULL,
    "createdCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER NOT NULL,

    CONSTRAINT "BillingBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" SERIAL NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "pupilId" INTEGER NOT NULL,
    "paymentDate" DATE NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "total" DECIMAL(14,2) NOT NULL,
    "receivedById" INTEGER NOT NULL,
    "receivedByName" TEXT NOT NULL,
    "postClose" BOOLEAN NOT NULL DEFAULT false,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentLine" (
    "id" SERIAL NOT NULL,
    "receiptId" INTEGER NOT NULL,
    "chargeId" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "PaymentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentReversal" (
    "id" SERIAL NOT NULL,
    "receiptId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedById" INTEGER NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" INTEGER,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "PaymentReversal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" SERIAL NOT NULL,
    "expenseNo" TEXT NOT NULL,
    "expenseDate" DATE NOT NULL,
    "termId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "supplier" TEXT,
    "method" TEXT NOT NULL,
    "invoiceRef" TEXT,
    "fundingSource" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "enteredById" INTEGER NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" INTEGER,
    "approvedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "postClose" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerContribution" (
    "id" SERIAL NOT NULL,
    "contributionNo" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "termId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "ownerName" TEXT NOT NULL,
    "description" TEXT,
    "method" TEXT,
    "reference" TEXT,
    "expenseId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER NOT NULL,

    CONSTRAINT "OwnerContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" SERIAL NOT NULL,
    "staffCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "jobRole" TEXT NOT NULL,
    "department" TEXT,
    "employmentType" TEXT NOT NULL,
    "basicSalary" DECIMAL(14,2) NOT NULL,
    "startDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "phone" TEXT,
    "nssfNo" TEXT,
    "tin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatutoryRateSet" (
    "id" SERIAL NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "nssfEmployeeRate" DECIMAL(6,4) NOT NULL,
    "nssfEmployerRate" DECIMAL(6,4) NOT NULL,
    "notes" TEXT,
    "validated" BOOLEAN NOT NULL DEFAULT false,
    "validatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatutoryRateSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayeBand" (
    "id" SERIAL NOT NULL,
    "rateSetId" INTEGER NOT NULL,
    "lowerBound" DECIMAL(14,2) NOT NULL,
    "upperBound" DECIMAL(14,2),
    "rate" DECIMAL(6,4) NOT NULL,

    CONSTRAINT "PayeBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "rateSetId" INTEGER NOT NULL,
    "termId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "totalBasic" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalNssfEmployee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalNssfEmployer" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalPaye" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalOther" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalNet" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "preparedById" INTEGER NOT NULL,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "approvedById" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "expenseId" INTEGER,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollEntry" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "staffId" INTEGER NOT NULL,
    "basic" DECIMAL(14,2) NOT NULL,
    "nssfEmployee" DECIMAL(14,2) NOT NULL,
    "nssfEmployer" DECIMAL(14,2) NOT NULL,
    "paye" DECIMAL(14,2) NOT NULL,
    "otherDeductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "otherNote" TEXT,
    "net" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "PayrollEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarryForwardBatch" (
    "id" SERIAL NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "sourceTermId" INTEGER NOT NULL,
    "destTermId" INTEGER NOT NULL,
    "chargeCount" INTEGER NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER NOT NULL,

    CONSTRAINT "CarryForwardBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TermSnapshot" (
    "id" SERIAL NOT NULL,
    "termId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "supersedesId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "activePupils" INTEGER NOT NULL,
    "totalBilled" DECIMAL(14,2) NOT NULL,
    "totalDiscounts" DECIMAL(14,2) NOT NULL,
    "arrearsBroughtForward" DECIMAL(14,2) NOT NULL,
    "totalCollected" DECIMAL(14,2) NOT NULL,
    "carriedForwardOut" DECIMAL(14,2) NOT NULL,
    "outstanding" DECIMAL(14,2) NOT NULL,
    "schoolFundedExpenses" DECIMAL(14,2) NOT NULL,
    "ownerFundedExpenses" DECIMAL(14,2) NOT NULL,
    "otherFundedExpenses" DECIMAL(14,2) NOT NULL,
    "totalExpenses" DECIMAL(14,2) NOT NULL,
    "netResult" DECIMAL(14,2) NOT NULL,
    "collectionRate" DECIMAL(7,4),
    "detail" JSONB NOT NULL,
    "notes" TEXT,
    "recordedById" INTEGER NOT NULL,
    "recordedByName" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" INTEGER,
    "approvedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "TermSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceList_code_key" ON "ReferenceList"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceValue_listId_code_key" ON "ReferenceValue"("listId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceValue_listId_label_key" ON "ReferenceValue"("listId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "AcademicYear_year_key" ON "AcademicYear"("year");

-- CreateIndex
CREATE UNIQUE INDEX "AcademicTerm_academicYearId_number_key" ON "AcademicTerm"("academicYearId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Section_code_key" ON "Section"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Section_name_key" ON "Section"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolClass_name_key" ON "SchoolClass"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Pupil_pupilCode_key" ON "Pupil"("pupilCode");

-- CreateIndex
CREATE INDEX "Pupil_fullName_idx" ON "Pupil"("fullName");

-- CreateIndex
CREATE INDEX "Pupil_status_idx" ON "Pupil"("status");

-- CreateIndex
CREATE INDEX "Pupil_classId_idx" ON "Pupil"("classId");

-- CreateIndex
CREATE INDEX "PupilHistory_pupilId_effectiveDate_idx" ON "PupilHistory"("pupilId", "effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "FeeItem_code_key" ON "FeeItem"("code");

-- CreateIndex
CREATE UNIQUE INDEX "FeeItem_name_key" ON "FeeItem"("name");

-- CreateIndex
CREATE UNIQUE INDEX "FeeStructure_termId_classId_feeItemId_key" ON "FeeStructure"("termId", "classId", "feeItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_chargeNo_key" ON "Charge"("chargeNo");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_sourceChargeId_key" ON "Charge"("sourceChargeId");

-- CreateIndex
CREATE INDEX "Charge_pupilId_idx" ON "Charge"("pupilId");

-- CreateIndex
CREATE INDEX "Charge_termId_idx" ON "Charge"("termId");

-- CreateIndex
CREATE INDEX "Charge_feeItemId_idx" ON "Charge"("feeItemId");

-- CreateIndex
CREATE INDEX "ChargeDiscount_chargeId_idx" ON "ChargeDiscount"("chargeId");

-- CreateIndex
CREATE INDEX "ChargeDiscount_status_idx" ON "ChargeDiscount"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BillingBatch_idempotencyKey_key" ON "BillingBatch"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_receiptNo_key" ON "Receipt"("receiptNo");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_idempotencyKey_key" ON "Receipt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Receipt_pupilId_idx" ON "Receipt"("pupilId");

-- CreateIndex
CREATE INDEX "Receipt_paymentDate_idx" ON "Receipt"("paymentDate");

-- CreateIndex
CREATE INDEX "PaymentLine_chargeId_idx" ON "PaymentLine"("chargeId");

-- CreateIndex
CREATE INDEX "PaymentLine_receiptId_idx" ON "PaymentLine"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReversal_receiptId_key" ON "PaymentReversal"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_expenseNo_key" ON "Expense"("expenseNo");

-- CreateIndex
CREATE INDEX "Expense_termId_idx" ON "Expense"("termId");

-- CreateIndex
CREATE INDEX "Expense_status_idx" ON "Expense"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerContribution_contributionNo_key" ON "OwnerContribution"("contributionNo");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerContribution_expenseId_key" ON "OwnerContribution"("expenseId");

-- CreateIndex
CREATE INDEX "OwnerContribution_termId_idx" ON "OwnerContribution"("termId");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_staffCode_key" ON "Staff"("staffCode");

-- CreateIndex
CREATE UNIQUE INDEX "StatutoryRateSet_effectiveFrom_key" ON "StatutoryRateSet"("effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_expenseId_key" ON "PayrollRun"("expenseId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_year_month_key" ON "PayrollRun"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollEntry_runId_staffId_key" ON "PayrollEntry"("runId", "staffId");

-- CreateIndex
CREATE UNIQUE INDEX "CarryForwardBatch_idempotencyKey_key" ON "CarryForwardBatch"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "TermSnapshot_supersedesId_key" ON "TermSnapshot"("supersedesId");

-- CreateIndex
CREATE UNIQUE INDEX "TermSnapshot_termId_version_key" ON "TermSnapshot"("termId", "version");

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceValue" ADD CONSTRAINT "ReferenceValue_listId_fkey" FOREIGN KEY ("listId") REFERENCES "ReferenceList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademicTerm" ADD CONSTRAINT "AcademicTerm_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolClass" ADD CONSTRAINT "SchoolClass_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pupil" ADD CONSTRAINT "Pupil_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PupilHistory" ADD CONSTRAINT "PupilHistory_pupilId_fkey" FOREIGN KEY ("pupilId") REFERENCES "Pupil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PupilHistory" ADD CONSTRAINT "PupilHistory_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PupilHistory" ADD CONSTRAINT "PupilHistory_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeStructure" ADD CONSTRAINT "FeeStructure_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeStructure" ADD CONSTRAINT "FeeStructure_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeStructure" ADD CONSTRAINT "FeeStructure_feeItemId_fkey" FOREIGN KEY ("feeItemId") REFERENCES "FeeItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_pupilId_fkey" FOREIGN KEY ("pupilId") REFERENCES "Pupil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_feeItemId_fkey" FOREIGN KEY ("feeItemId") REFERENCES "FeeItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_billingBatchId_fkey" FOREIGN KEY ("billingBatchId") REFERENCES "BillingBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_sourceChargeId_fkey" FOREIGN KEY ("sourceChargeId") REFERENCES "Charge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_carryForwardBatchId_fkey" FOREIGN KEY ("carryForwardBatchId") REFERENCES "CarryForwardBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeDiscount" ADD CONSTRAINT "ChargeDiscount_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingBatch" ADD CONSTRAINT "BillingBatch_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingBatch" ADD CONSTRAINT "BillingBatch_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_pupilId_fkey" FOREIGN KEY ("pupilId") REFERENCES "Pupil"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLine" ADD CONSTRAINT "PaymentLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLine" ADD CONSTRAINT "PaymentLine_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReversal" ADD CONSTRAINT "PaymentReversal_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerContribution" ADD CONSTRAINT "OwnerContribution_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerContribution" ADD CONSTRAINT "OwnerContribution_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayeBand" ADD CONSTRAINT "PayeBand_rateSetId_fkey" FOREIGN KEY ("rateSetId") REFERENCES "StatutoryRateSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_rateSetId_fkey" FOREIGN KEY ("rateSetId") REFERENCES "StatutoryRateSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarryForwardBatch" ADD CONSTRAINT "CarryForwardBatch_sourceTermId_fkey" FOREIGN KEY ("sourceTermId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarryForwardBatch" ADD CONSTRAINT "CarryForwardBatch_destTermId_fkey" FOREIGN KEY ("destTermId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermSnapshot" ADD CONSTRAINT "TermSnapshot_termId_fkey" FOREIGN KEY ("termId") REFERENCES "AcademicTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermSnapshot" ADD CONSTRAINT "TermSnapshot_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "TermSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Hand-written additions ─────────────

-- FR-501: one charge per pupil, fee item and term. Arrears B/F charges (with a source charge) are
-- exempt because each carried charge keeps its own line (D-01). Voided charges do not count.
CREATE UNIQUE INDEX "Charge_one_per_pupil_item_term"
  ON "Charge" ("pupilId", "termId", "feeItemId")
  WHERE "sourceChargeId" IS NULL AND "voidedAt" IS NULL;

-- Money must be positive where the FRS implies it.
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_amount_positive" CHECK ("amountCharged" > 0);
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_carried_nonnegative" CHECK ("carriedForwardAmount" >= 0);
ALTER TABLE "ChargeDiscount" ADD CONSTRAINT "ChargeDiscount_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "PaymentLine" ADD CONSTRAINT "PaymentLine_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "OwnerContribution" ADD CONSTRAINT "OwnerContribution_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "FeeStructure" ADD CONSTRAINT "FeeStructure_amount_nonnegative" CHECK ("amount" >= 0);
ALTER TABLE "AcademicYear" ADD CONSTRAINT "AcademicYear_four_digits" CHECK ("year" BETWEEN 1000 AND 9999);
ALTER TABLE "AcademicTerm" ADD CONSTRAINT "AcademicTerm_dates" CHECK ("endDate" >= "startDate");

-- Derived charge figures (BR-01 to BR-06). Only approved discounts count (D-05); payments on
-- reversed receipts do not count (WR-09); amounts carried to a later term close the balance (D-01).
CREATE VIEW "ChargeBalance" AS
SELECT
  c."id" AS "chargeId",
  c."pupilId",
  c."termId",
  t."academicYearId",
  c."classId",
  sc."sectionId",
  c."feeItemId",
  (c."sourceChargeId" IS NOT NULL) AS "isArrears",
  (c."voidedAt" IS NOT NULL) AS "voided",
  c."amountCharged",
  COALESCE(d."approved", 0)::DECIMAL(14,2) AS "discount",
  COALESCE(d."pending", 0)::DECIMAL(14,2) AS "pendingDiscount",
  (c."amountCharged" - COALESCE(d."approved", 0))::DECIMAL(14,2) AS "netDue",
  COALESCE(p."paid", 0)::DECIMAL(14,2) AS "totalPaid",
  c."carriedForwardAmount" AS "carriedForward",
  (c."amountCharged" - COALESCE(d."approved", 0) - COALESCE(p."paid", 0) - c."carriedForwardAmount")::DECIMAL(14,2) AS "balance",
  CASE
    WHEN c."voidedAt" IS NOT NULL THEN 'VOID'
    WHEN c."carriedForwardAmount" > 0 THEN 'CARRIED_FORWARD'
    WHEN c."amountCharged" - COALESCE(d."approved", 0) - COALESCE(p."paid", 0) <= 0 THEN 'PAID'
    WHEN COALESCE(p."paid", 0) > 0 THEN 'PARTIAL'
    ELSE 'UNPAID'
  END AS "status"
FROM "Charge" c
JOIN "AcademicTerm" t ON t."id" = c."termId"
JOIN "SchoolClass" sc ON sc."id" = c."classId"
LEFT JOIN (
  SELECT "chargeId",
    SUM("amount") FILTER (WHERE "status" = 'APPROVED') AS "approved",
    SUM("amount") FILTER (WHERE "status" = 'PENDING') AS "pending"
  FROM "ChargeDiscount" GROUP BY "chargeId"
) d ON d."chargeId" = c."id"
LEFT JOIN (
  SELECT pl."chargeId", SUM(pl."amount") AS "paid"
  FROM "PaymentLine" pl JOIN "Receipt" r ON r."id" = pl."receiptId"
  WHERE r."reversedAt" IS NULL
  GROUP BY pl."chargeId"
) p ON p."chargeId" = c."id";

-- FR-1502, FR-1504, BR-22: an approved snapshot is permanent. Only the link to a newer
-- version may be added; the figures can never change and the row can never be deleted.
CREATE FUNCTION "freeze_approved_snapshot"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'APPROVED' THEN
      RAISE EXCEPTION 'Approved term snapshots cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'APPROVED' THEN
    RAISE EXCEPTION 'Approved term snapshots cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TermSnapshot_freeze"
  BEFORE UPDATE OR DELETE ON "TermSnapshot"
  FOR EACH ROW EXECUTE FUNCTION "freeze_approved_snapshot"();
