-- CreateTable
CREATE TABLE "GoianiaPoiShadowAudit" (
    "id" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT,
    "userId" TEXT,
    "userEmail" TEXT,
    "spreadsheetName" TEXT,
    "stopSequence" TEXT,
    "originalAddress" TEXT NOT NULL,
    "normalizedAddress" TEXT,
    "bairro" TEXT,
    "poiId" TEXT,
    "poiName" TEXT NOT NULL,
    "poiCategory" TEXT NOT NULL,
    "poiConfidence" TEXT NOT NULL,
    "poiLat" DOUBLE PRECISION,
    "poiLng" DOUBLE PRECISION,
    "poiSources" JSONB,
    "poiReason" TEXT,
    "finalSource" TEXT,
    "finalMatchType" TEXT,
    "finalStatus" TEXT,
    "finalLat" DOUBLE PRECISION,
    "finalLng" DOUBLE PRECISION,
    "poiShadowWouldHelpCurrentResult" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "isCorrect" BOOLEAN,
    "reviewNotes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoianiaPoiShadowAudit_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "GoianiaPoiShadowAudit" ADD CONSTRAINT "GoianiaPoiShadowAudit_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ImportJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoianiaPoiShadowAudit" ADD CONSTRAINT "GoianiaPoiShadowAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "GoianiaPoiShadowAudit_occurredAt_idx" ON "GoianiaPoiShadowAudit"("occurredAt");

-- CreateIndex
CREATE INDEX "GoianiaPoiShadowAudit_jobId_idx" ON "GoianiaPoiShadowAudit"("jobId");

-- CreateIndex
CREATE INDEX "GoianiaPoiShadowAudit_userId_idx" ON "GoianiaPoiShadowAudit"("userId");

-- CreateIndex
CREATE INDEX "GoianiaPoiShadowAudit_poiConfidence_idx" ON "GoianiaPoiShadowAudit"("poiConfidence");

-- CreateIndex
CREATE INDEX "GoianiaPoiShadowAudit_poiCategory_idx" ON "GoianiaPoiShadowAudit"("poiCategory");

-- CreateIndex
CREATE INDEX "GoianiaPoiShadowAudit_poiName_idx" ON "GoianiaPoiShadowAudit"("poiName");

-- CreateIndex
CREATE INDEX "GoianiaPoiShadowAudit_poiShadowWouldHelpCurrentResult_idx" ON "GoianiaPoiShadowAudit"("poiShadowWouldHelpCurrentResult");

-- CreateIndex
CREATE INDEX "GoianiaPoiShadowAudit_reviewStatus_idx" ON "GoianiaPoiShadowAudit"("reviewStatus");
