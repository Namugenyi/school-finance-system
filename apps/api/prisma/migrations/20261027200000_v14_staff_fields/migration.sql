-- v14 workbook staff register: where pay goes, and notes.
ALTER TABLE "Staff" ADD COLUMN "payTo" TEXT;
ALTER TABLE "Staff" ADD COLUMN "notes" TEXT;

-- v14 employment types include Volunteer.
INSERT INTO "ReferenceValue" ("listId", "code", "label", "sortOrder", "active", "isSystem")
SELECT l."id", 'VOLUNTEER', 'Volunteer', COALESCE((SELECT MAX(v."sortOrder") FROM "ReferenceValue" v WHERE v."listId" = l."id"), 0) + 1, true, false
FROM "ReferenceList" l
WHERE l."code" = 'EMPLOYMENT_TYPE'
  AND NOT EXISTS (SELECT 1 FROM "ReferenceValue" v WHERE v."listId" = l."id" AND (v."code" = 'VOLUNTEER' OR lower(v."label") = 'volunteer'));
