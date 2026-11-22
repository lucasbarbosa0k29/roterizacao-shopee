BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE "PaymentCheckoutIntent" (
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "paymentTransactionId" TEXT NOT NULL,
    CONSTRAINT "PaymentCheckoutIntent_pkey" PRIMARY KEY ("userId", "key"),
    CONSTRAINT "PaymentCheckoutIntent_paymentTransactionId_fkey"
        FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PaymentCheckoutIntent_paymentTransactionId_idx" ON "PaymentCheckoutIntent"("paymentTransactionId");
COMMIT;
