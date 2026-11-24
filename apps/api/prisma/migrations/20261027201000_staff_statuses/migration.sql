-- v14 staff statuses (Tina, 27/10/2026): Active, On Leave, Resigned, Terminated. Staff marked Inactive become Resigned.
UPDATE "Staff" SET "status" = 'RESIGNED' WHERE "status" = 'INACTIVE';
