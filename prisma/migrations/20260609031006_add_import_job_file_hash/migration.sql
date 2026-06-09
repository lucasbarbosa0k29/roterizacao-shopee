-- AlterTable
ALTER TABLE "ImportJob" ADD COLUMN     "fileHash" TEXT;

-- CreateIndex
CREATE INDEX "ImportJob_userId_fileHash_idx" ON "ImportJob"("userId", "fileHash");
