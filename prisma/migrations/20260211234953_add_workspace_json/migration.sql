-- AlterTable
ALTER TABLE "ImportJob" ADD COLUMN     "workspaceJson" JSONB;

-- CreateIndex
CREATE INDEX "ImportJob_resultSavedAt_idx" ON "ImportJob"("resultSavedAt");
