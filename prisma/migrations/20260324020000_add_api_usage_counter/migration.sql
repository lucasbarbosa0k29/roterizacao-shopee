-- CreateEnum
CREATE TYPE "ApiUsagePeriodType" AS ENUM ('MONTH', 'DAY');

-- CreateTable
CREATE TABLE "ApiUsageCounter" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "periodType" "ApiUsagePeriodType" NOT NULL,
    "periodKey" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiUsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiUsageCounter_service_periodType_periodKey_key"
ON "ApiUsageCounter"("service", "periodType", "periodKey");

-- CreateIndex
CREATE INDEX "ApiUsageCounter_service_periodType_periodKey_idx"
ON "ApiUsageCounter"("service", "periodType", "periodKey");

-- CreateIndex
CREATE INDEX "ApiUsageCounter_createdAt_idx"
ON "ApiUsageCounter"("createdAt");
