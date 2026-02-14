-- AlterTable
ALTER TABLE "ImportJob" ADD COLUMN     "resultJson" JSONB,
ADD COLUMN     "resultSavedAt" TIMESTAMP(3);
