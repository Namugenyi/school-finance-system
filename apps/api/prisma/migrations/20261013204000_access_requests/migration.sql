-- Sign-in help: requests from the sign-in page and the administrator's contact details.
ALTER TABLE "SchoolSettings" ADD COLUMN "adminContactName" TEXT,
ADD COLUMN "adminContactPhone" TEXT,
ADD COLUMN "adminContactEmail" TEXT;

CREATE TABLE "AccessRequest" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "userId" INTEGER,
    "reason" TEXT NOT NULL,
    "contactPhone" TEXT,
    "note" TEXT,
    "ip" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedById" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,

    CONSTRAINT "AccessRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccessRequest_status_idx" ON "AccessRequest"("status");

ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
