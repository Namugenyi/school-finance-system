-- Approval limit (school rule, 27/10/2026): anything above UGX 200,000 is approved by the school owner.
ALTER TABLE "SchoolSettings" ADD COLUMN "approvalLimit" DECIMAL(14,2) DEFAULT 200000;
UPDATE "SchoolSettings" SET "approvalLimit" = 200000;

-- The owner role decides amounts over the limit, including discounts and payment reversals.
INSERT INTO "RolePermission" ("roleId", "permission")
SELECT r."id", p.permission
FROM "Role" r
CROSS JOIN (VALUES ('approvals.overLimit'), ('discounts.approve'), ('payments.reverse.approve')) AS p(permission)
WHERE r."code" = 'PROPRIETOR'
ON CONFLICT DO NOTHING;
