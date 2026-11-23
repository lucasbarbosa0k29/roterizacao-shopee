-- CreateTable
CREATE TABLE "NotificationMessage" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "eventKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRecipient" (
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "readAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "NotificationRecipient_pkey" PRIMARY KEY ("userId","messageId")
);

-- CreateTable
CREATE TABLE "NotificationCampaign" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "target" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "recipientCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationMessage_eventKey_key" ON "NotificationMessage"("eventKey");

-- CreateIndex
CREATE INDEX "NotificationMessage_expiresAt_idx" ON "NotificationMessage"("expiresAt");

-- CreateIndex
CREATE INDEX "NotificationRecipient_userId_deletedAt_createdAt_messageId_idx" ON "NotificationRecipient"("userId", "deletedAt", "createdAt", "messageId");

-- CreateIndex
CREATE INDEX "NotificationRecipient_userId_deletedAt_readAt_expiresAt_idx" ON "NotificationRecipient"("userId", "deletedAt", "readAt", "expiresAt");

-- CreateIndex
CREATE INDEX "NotificationRecipient_messageId_idx" ON "NotificationRecipient"("messageId");

-- CreateIndex
CREATE INDEX "NotificationCampaign_createdAt_id_idx" ON "NotificationCampaign"("createdAt", "id");

-- CreateIndex
CREATE INDEX "NotificationCampaign_authorId_createdAt_id_idx" ON "NotificationCampaign"("authorId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "NotificationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

