-- Details typed when "Other" is chosen in a dropdown.
ALTER TABLE "Pupil" ADD COLUMN "guardianRelationshipOther" TEXT,
ADD COLUMN "emergencyRelationshipOther" TEXT,
ADD COLUMN "leavingReasonOther" TEXT;

ALTER TABLE "PupilHistory" ADD COLUMN "leavingReasonOther" TEXT;

ALTER TABLE "Expense" ADD COLUMN "fundingSourceOther" TEXT;
