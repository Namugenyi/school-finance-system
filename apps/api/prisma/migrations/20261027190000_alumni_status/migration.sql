-- The school keeps two pupil statuses: Active and Alumni.
-- Withdrawn, Completed and Transferred pupils become Alumni. Their reason for leaving is kept,
-- so why each pupil left is still on record.
UPDATE "Pupil" SET "status" = 'ALUMNI' WHERE "status" IN ('WITHDRAWN', 'COMPLETED', 'TRANSFERRED');
UPDATE "PupilHistory" SET "status" = 'ALUMNI' WHERE "status" IN ('WITHDRAWN', 'COMPLETED', 'TRANSFERRED');

DELETE FROM "ReferenceValue"
WHERE "code" IN ('WITHDRAWN', 'COMPLETED', 'TRANSFERRED')
  AND "listId" = (SELECT "id" FROM "ReferenceList" WHERE "code" = 'PUPIL_STATUS');

UPDATE "ReferenceValue" SET "sortOrder" = 2
WHERE "code" = 'ALUMNI'
  AND "listId" = (SELECT "id" FROM "ReferenceList" WHERE "code" = 'PUPIL_STATUS');
