ALTER TABLE "RouteCredit" ADD COLUMN "reversalOfCreditId" TEXT;

CREATE UNIQUE INDEX "RouteCredit_reversalOfCreditId_key" ON "RouteCredit"("reversalOfCreditId");

ALTER TABLE "RouteCredit" ADD CONSTRAINT "RouteCredit_reversalOfCreditId_fkey"
    FOREIGN KEY ("reversalOfCreditId") REFERENCES "RouteCredit"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
