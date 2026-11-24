-- Tina, 24/11/2026: the school's name is "Supreme Tower Junior School", not "Junior Academy".
-- Rename it in databases that were seeded with the old name. Any other name an admin typed is left alone.
UPDATE "SchoolSettings" SET "schoolName" = REPLACE("schoolName", 'Supreme Tower Junior Academy', 'Supreme Tower Junior School')
WHERE "schoolName" LIKE '%Supreme Tower Junior Academy%';
