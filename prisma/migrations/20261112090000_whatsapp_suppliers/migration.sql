-- CreateEnum
CREATE TYPE "WhatsAppDirection" AS ENUM ('OUT', 'IN');

-- CreateEnum
CREATE TYPE "WhatsAppStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED', 'HANDLED', 'KEPT', 'IGNORED');

-- AlterTable
ALTER TABLE "QuoteSettings" ADD COLUMN     "whatsappRequests" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "SupplierQuoteResponse" ADD COLUMN     "freightMinor" BIGINT;

-- CreateTable
CREATE TABLE "SupplierReplyFile" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "channel" "ReachChannel" NOT NULL,
    "name" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierReplyFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "direction" "WhatsAppDirection" NOT NULL,
    "number" TEXT NOT NULL,
    "status" "WhatsAppStatus" NOT NULL,
    "waMessageId" TEXT,
    "requestId" TEXT,
    "supplierId" TEXT,
    "contextId" TEXT,
    "payload" JSONB NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierReplyFile_requestId_idx" ON "SupplierReplyFile"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_waMessageId_key" ON "WhatsAppMessage"("waMessageId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_status_nextAttemptAt_idx" ON "WhatsAppMessage"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_requestId_idx" ON "WhatsAppMessage"("requestId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_number_createdAt_idx" ON "WhatsAppMessage"("number", "createdAt");

-- AddForeignKey
ALTER TABLE "SupplierReplyFile" ADD CONSTRAINT "SupplierReplyFile_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SupplierPriceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SupplierPriceRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
