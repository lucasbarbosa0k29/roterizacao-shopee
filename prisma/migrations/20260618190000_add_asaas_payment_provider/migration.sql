-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'ASAAS';

-- AlterTable
ALTER TABLE "PaymentTransaction" ADD COLUMN IF NOT EXISTS "asaasPaymentId" TEXT;
ALTER TABLE "PaymentTransaction" ADD COLUMN IF NOT EXISTS "asaasCustomerId" TEXT;
ALTER TABLE "PaymentTransaction" ADD COLUMN IF NOT EXISTS "asaasSubscriptionId" TEXT;
ALTER TABLE "PaymentTransaction" ADD COLUMN IF NOT EXISTS "asaasCheckoutUrl" TEXT;
ALTER TABLE "PaymentTransaction" ADD COLUMN IF NOT EXISTS "asaasInvoiceUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentTransaction_asaasPaymentId_key" ON "PaymentTransaction"("asaasPaymentId");
