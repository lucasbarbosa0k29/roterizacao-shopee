-- CreateEnum
CREATE TYPE "SubscriptionPlanCode" AS ENUM ('FREE', 'BASIC', 'PRO');

-- CreateEnum
CREATE TYPE "UserSubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "SubscriptionSource" AS ENUM ('ADMIN_GRANT', 'TRIAL', 'INFINITEPAY_LINK', 'MANUAL_PAYMENT');

-- CreateEnum
CREATE TYPE "RouteUsageSource" AS ENUM ('SUBSCRIPTION_DAILY', 'EXTRA_CREDIT', 'ADMIN_OVERRIDE', 'FREE');

-- CreateEnum
CREATE TYPE "RouteCreditReason" AS ENUM ('ADMIN_GRANT', 'MANUAL_PAYMENT', 'ADJUSTMENT', 'CONSUMPTION');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accessBlockReason" TEXT,
ADD COLUMN     "accessBlockedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "code" "SubscriptionPlanCode" NOT NULL,
    "name" TEXT NOT NULL,
    "durationDays" INTEGER,
    "dailyRouteLimit" INTEGER NOT NULL DEFAULT 0,
    "isUnlimited" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "UserSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" "SubscriptionSource" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "grantedByAdminId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "importJobId" TEXT,
    "subscriptionId" TEXT,
    "source" "RouteUsageSource" NOT NULL,
    "usageDayKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouteUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteCredit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" "RouteCreditReason" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouteCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAccessLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_code_key" ON "SubscriptionPlan"("code");

-- CreateIndex
CREATE INDEX "SubscriptionPlan_isActive_idx" ON "SubscriptionPlan"("isActive");

-- CreateIndex
CREATE INDEX "UserSubscription_userId_status_expiresAt_idx" ON "UserSubscription"("userId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "UserSubscription_planId_idx" ON "UserSubscription"("planId");

-- CreateIndex
CREATE INDEX "UserSubscription_grantedByAdminId_idx" ON "UserSubscription"("grantedByAdminId");

-- CreateIndex
CREATE INDEX "UserSubscription_createdAt_idx" ON "UserSubscription"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RouteUsage_importJobId_key" ON "RouteUsage"("importJobId");

-- CreateIndex
CREATE INDEX "RouteUsage_userId_usageDayKey_idx" ON "RouteUsage"("userId", "usageDayKey");

-- CreateIndex
CREATE INDEX "RouteUsage_subscriptionId_idx" ON "RouteUsage"("subscriptionId");

-- CreateIndex
CREATE INDEX "RouteUsage_createdAt_idx" ON "RouteUsage"("createdAt");

-- CreateIndex
CREATE INDEX "RouteCredit_userId_createdAt_idx" ON "RouteCredit"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAccessLog_adminId_createdAt_idx" ON "AdminAccessLog"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAccessLog_targetUserId_createdAt_idx" ON "AdminAccessLog"("targetUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAccessLog_action_idx" ON "AdminAccessLog"("action");

-- CreateIndex
CREATE INDEX "User_accessBlockedAt_idx" ON "User"("accessBlockedAt");

-- AddForeignKey
ALTER TABLE "UserSubscription" ADD CONSTRAINT "UserSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSubscription" ADD CONSTRAINT "UserSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteUsage" ADD CONSTRAINT "RouteUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteUsage" ADD CONSTRAINT "RouteUsage_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteUsage" ADD CONSTRAINT "RouteUsage_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "UserSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteCredit" ADD CONSTRAINT "RouteCredit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAccessLog" ADD CONSTRAINT "AdminAccessLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAccessLog" ADD CONSTRAINT "AdminAccessLog_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
