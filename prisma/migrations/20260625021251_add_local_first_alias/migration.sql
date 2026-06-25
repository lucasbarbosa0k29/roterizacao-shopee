-- CreateEnum
CREATE TYPE "LocalFirstAliasType" AS ENUM ('BAIRRO', 'RUA', 'BAIRRO_RUA');

-- CreateEnum
CREATE TYPE "LocalFirstAliasStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'DISABLED');

-- CreateEnum
CREATE TYPE "LocalFirstAliasSource" AS ENUM ('AI', 'MANUAL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "LocalFirstAliasValidationStatus" AS ENUM ('NOT_VALIDATED', 'VALIDATED', 'FAILED', 'NEEDS_REVIEW');

-- CreateTable
CREATE TABLE "LocalFirstAlias" (
    "id" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "aliasType" "LocalFirstAliasType" NOT NULL,
    "sourceBairro" TEXT NOT NULL,
    "sourceRua" TEXT NOT NULL DEFAULT '',
    "targetBairro" TEXT,
    "targetRua" TEXT,
    "status" "LocalFirstAliasStatus" NOT NULL DEFAULT 'PENDING',
    "source" "LocalFirstAliasSource" NOT NULL DEFAULT 'AI',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "cooldownUntil" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastValidationStatus" "LocalFirstAliasValidationStatus" NOT NULL DEFAULT 'NOT_VALIDATED',
    "lastValidationReason" TEXT,
    "lastFailureReason" TEXT,
    "lastAiReason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalFirstAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LocalFirstAlias_city_status_idx" ON "LocalFirstAlias"("city", "status");

-- CreateIndex
CREATE INDEX "LocalFirstAlias_city_aliasType_status_idx" ON "LocalFirstAlias"("city", "aliasType", "status");

-- CreateIndex
CREATE INDEX "LocalFirstAlias_sourceBairro_idx" ON "LocalFirstAlias"("sourceBairro");

-- CreateIndex
CREATE INDEX "LocalFirstAlias_sourceBairro_sourceRua_idx" ON "LocalFirstAlias"("sourceBairro", "sourceRua");

-- CreateIndex
CREATE INDEX "LocalFirstAlias_cooldownUntil_idx" ON "LocalFirstAlias"("cooldownUntil");

-- CreateIndex
CREATE INDEX "LocalFirstAlias_lastUsedAt_idx" ON "LocalFirstAlias"("lastUsedAt");

-- CreateIndex
CREATE INDEX "LocalFirstAlias_createdAt_idx" ON "LocalFirstAlias"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LocalFirstAlias_city_aliasType_sourceBairro_sourceRua_key" ON "LocalFirstAlias"("city", "aliasType", "sourceBairro", "sourceRua");
