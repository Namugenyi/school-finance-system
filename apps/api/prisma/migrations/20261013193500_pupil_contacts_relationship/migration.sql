-- Separate the emergency contact from the parent / guardian and record how each is related to the pupil.
ALTER TABLE "Pupil" RENAME COLUMN "emergencyContact" TO "emergencyName";
ALTER TABLE "Pupil" ADD COLUMN "guardianRelationship" TEXT,
ADD COLUMN "emergencyRelationship" TEXT,
ADD COLUMN "emergencyPhone" TEXT;

-- Relationship reference list, so existing installs get it without re-seeding.
INSERT INTO "ReferenceList" ("code", "name", "description", "locked", "sortOrder")
SELECT 'RELATIONSHIP', 'Relationship to Pupil', 'How a parent / guardian or emergency contact is related to the pupil', false,
       COALESCE((SELECT MAX("sortOrder") + 1 FROM "ReferenceList"), 0)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "ReferenceValue" ("listId", "code", "label", "sortOrder", "active", "isSystem")
SELECT l."id", v.code, v.label, v.sort, true, false
FROM "ReferenceList" l
CROSS JOIN (VALUES ('MOTHER', 'Mother', 1), ('FATHER', 'Father', 2), ('GUARDIAN', 'Guardian', 3), ('GRANDPARENT', 'Grandparent', 4),
                   ('SIBLING', 'Sibling', 5), ('AUNT_UNCLE', 'Aunt / Uncle', 6), ('OTHER', 'Other', 7)) AS v(code, label, sort)
WHERE l."code" = 'RELATIONSHIP'
ON CONFLICT ("listId", "code") DO NOTHING;
