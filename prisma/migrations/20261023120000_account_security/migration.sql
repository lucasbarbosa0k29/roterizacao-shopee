-- Additive migration. Existing accounts remain exempt; new accounts require verification.
-- This pending migration must commit atomically; never leave a partially expanded schema.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TYPE "DocumentType" AS ENUM ('CPF', 'CNPJ');
CREATE TYPE "AuthChallengePurpose" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');
ALTER TYPE "RouteCreditReason" ADD VALUE 'PROMOTIONAL';

ALTER TABLE "User"
  ADD COLUMN "documentType" "DocumentType",
  ADD COLUMN "cpf" TEXT,
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "emailVerificationRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ALTER COLUMN "emailVerificationRequired" SET DEFAULT true;
CREATE UNIQUE INDEX "User_cpf_key" ON "User"("cpf");
ALTER TABLE "User" ADD CONSTRAINT "User_cpf_shape_check"
  CHECK ("cpf" IS NULL OR ("cpf" ~ '^[0-9]{11}$' AND "documentType" IS NOT DISTINCT FROM 'CPF'::"DocumentType"));
ALTER TABLE "User" ADD CONSTRAINT "User_document_shape_check"
  CHECK ("documentType" IS NULL OR
    ("documentType" = 'CPF' AND "cpf" IS NOT NULL AND "companyId" IS NULL) OR
    ("documentType" = 'CNPJ' AND "cpf" IS NULL AND "companyId" IS NOT NULL));

CREATE TABLE "AuthChallenge" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "purpose" "AuthChallengePurpose" NOT NULL,
  "generation" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "delivered" BOOLEAN NOT NULL DEFAULT false,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumedAt" TIMESTAMP(3),
  "resetTokenHash" TEXT
);
CREATE UNIQUE INDEX "AuthChallenge_userId_purpose_key" ON "AuthChallenge"("userId", "purpose");
CREATE INDEX "AuthChallenge_expiresAt_idx" ON "AuthChallenge"("expiresAt");

CREATE TABLE "SignupBenefit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "documentFingerprint" TEXT NOT NULL,
  "documentType" "DocumentType" NOT NULL,
  "quantity" INTEGER NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SignupBenefit_documentFingerprint_key" ON "SignupBenefit"("documentFingerprint");

COMMIT;
