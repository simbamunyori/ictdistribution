-- CreateEnum
CREATE TYPE "AssistantChatStatus" AS ENUM ('OPEN', 'HANDED_OVER', 'CLOSED');

-- CreateTable
CREATE TABLE "AssistantSettings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "handoverEmail" TEXT NOT NULL DEFAULT '',
    "maxMessages" INTEGER NOT NULL DEFAULT 30,
    "updatedByLabel" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantChat" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT,
    "organisationId" TEXT,
    "marketCode" TEXT NOT NULL,
    "standing" TEXT NOT NULL,
    "status" "AssistantChatStatus" NOT NULL DEFAULT 'OPEN',
    "messages" JSONB NOT NULL DEFAULT '[]',
    "userMessages" INTEGER NOT NULL DEFAULT 0,
    "quoteDraft" JSONB,
    "handoverName" TEXT NOT NULL DEFAULT '',
    "handoverEmail" TEXT NOT NULL DEFAULT '',
    "handoverPhone" TEXT NOT NULL DEFAULT '',
    "handoverNote" TEXT NOT NULL DEFAULT '',
    "handedOverAt" TIMESTAMP(3),
    "closedByLabel" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantChat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssistantChat_tokenHash_key" ON "AssistantChat"("tokenHash");

-- CreateIndex
CREATE INDEX "AssistantChat_status_updatedAt_idx" ON "AssistantChat"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "AssistantChat_userId_idx" ON "AssistantChat"("userId");

