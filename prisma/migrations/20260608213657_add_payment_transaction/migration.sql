-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('MERCADOPAGO');

-- CreateEnum
CREATE TYPE "PaymentProductType" AS ENUM ('EXTRA_ROUTE', 'BASIC_PLAN', 'PRO_PLAN');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'REQUIRES_ACTION', 'APPROVED', 'REJECTED', 'CANCELED', 'REFUNDED', 'EXPIRED', 'FULFILLED');

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'MERCADOPAGO',
    "productType" "PaymentProductType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "mercadoPagoPreferenceId" TEXT,
    "mercadoPagoPaymentId" TEXT,
    "externalReference" TEXT NOT NULL,
    "initPoint" TEXT,
    "sandboxInitPoint" TEXT,
    "approvedAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "fulfilledSourceId" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_mercadoPagoPaymentId_key" ON "PaymentTransaction"("mercadoPagoPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_externalReference_key" ON "PaymentTransaction"("externalReference");

-- CreateIndex
CREATE INDEX "PaymentTransaction_userId_createdAt_idx" ON "PaymentTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentTransaction_provider_status_idx" ON "PaymentTransaction"("provider", "status");

-- CreateIndex
CREATE INDEX "PaymentTransaction_productType_status_idx" ON "PaymentTransaction"("productType", "status");

-- CreateIndex
CREATE INDEX "PaymentTransaction_approvedAt_idx" ON "PaymentTransaction"("approvedAt");

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
