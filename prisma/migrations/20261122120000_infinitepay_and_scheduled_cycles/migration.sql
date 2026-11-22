BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- CreateEnum
CREATE TYPE "PaymentEventStatus" AS ENUM ('PENDING', 'PROCESSED', 'REVIEW');

-- AlterEnum
ALTER TYPE "UserSubscriptionStatus" ADD VALUE 'SCHEDULED';

-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'INFINITEPAY';

-- AlterTable
ALTER TABLE "UserSubscription" ADD COLUMN     "paymentTransactionId" TEXT;

-- AlterTable
ALTER TABLE "RouteCredit" ADD COLUMN     "paymentTransactionId" TEXT;

-- AlterTable
ALTER TABLE "PaymentTransaction" ADD COLUMN     "checkoutAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "checkoutExpiresAt" TIMESTAMP(3),
ADD COLUMN     "checkoutRetryAt" TIMESTAMP(3),
ADD COLUMN     "fulfillmentReviewReason" TEXT,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "infinitePayCheckoutInput" JSONB,
ADD COLUMN     "infinitePayCheckoutUrl" TEXT,
ADD COLUMN     "infinitePaySlug" TEXT,
ADD COLUMN     "infinitePayTransactionId" TEXT,
ADD COLUMN     "paidAmountCents" INTEGER;

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "paymentTransactionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "transactionNsu" TEXT NOT NULL,
    "status" "PaymentEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentEvent_status_nextAttemptAt_idx" ON "PaymentEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_signal_key" ON "PaymentEvent"("paymentTransactionId", "kind", "slug", "transactionNsu");

-- CreateIndex
CREATE UNIQUE INDEX "UserSubscription_paymentTransactionId_key" ON "UserSubscription"("paymentTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "RouteCredit_paymentTransactionId_key" ON "RouteCredit"("paymentTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_infinitePayTransactionId_key" ON "PaymentTransaction"("infinitePayTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_userId_idempotencyKey_key" ON "PaymentTransaction"("userId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "UserSubscription" ADD CONSTRAINT "UserSubscription_paymentTransactionId_fkey" FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteCredit" ADD CONSTRAINT "RouteCredit_paymentTransactionId_fkey" FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentTransactionId_fkey" FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
