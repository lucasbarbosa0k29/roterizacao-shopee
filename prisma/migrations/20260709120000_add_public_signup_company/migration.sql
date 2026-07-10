-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CnpjProvider" AS ENUM ('BRASILAPI', 'RECEITAWS');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Company" (
  "id" TEXT NOT NULL,
  "cnpj" TEXT NOT NULL,
  "razaoSocial" TEXT NOT NULL,
  "nomeFantasia" TEXT,
  "situacaoCadastral" TEXT NOT NULL,
  "cidade" TEXT,
  "uf" TEXT,
  "provider" "CnpjProvider" NOT NULL,
  "rawData" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "whatsapp" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "companyId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Company_cnpj_key" ON "Company"("cnpj");
CREATE INDEX IF NOT EXISTS "Company_createdAt_idx" ON "Company"("createdAt");
CREATE INDEX IF NOT EXISTS "Company_situacaoCadastral_idx" ON "Company"("situacaoCadastral");
CREATE INDEX IF NOT EXISTS "Company_uf_cidade_idx" ON "Company"("uf", "cidade");
CREATE INDEX IF NOT EXISTS "User_companyId_idx" ON "User"("companyId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
