-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CnpjVerificationStatus" AS ENUM ('VERIFIED', 'PENDING_VERIFICATION');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "cnpjVerificationStatus" "CnpjVerificationStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION';
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "cnpjVerificationReason" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "cnpjVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Company" ALTER COLUMN "provider" DROP NOT NULL;

-- Backfill existing API-created companies as verified when they are active.
UPDATE "Company"
SET "cnpjVerificationStatus" = 'VERIFIED',
    "cnpjVerifiedAt" = COALESCE("cnpjVerifiedAt", "createdAt")
WHERE "situacaoCadastral" = 'ATIVA'
  AND "provider" IS NOT NULL
  AND "cnpjVerificationStatus" = 'PENDING_VERIFICATION';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Company_cnpjVerificationStatus_idx" ON "Company"("cnpjVerificationStatus");
