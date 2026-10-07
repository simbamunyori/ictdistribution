-- CreateEnum
CREATE TYPE "QuoteType" AS ENUM ('STANDARD', 'RESELLER_PROJECT', 'TENDER');

-- CreateEnum
CREATE TYPE "QuoteSource" AS ENUM ('PORTAL', 'EMAIL', 'STAFF');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('RECEIVED', 'WAITING_ON_SUPPLIERS', 'REVIEW', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CostSource" AS ENUM ('CATALOGUE', 'SUPPLIER', 'STAFF');

-- CreateEnum
CREATE TYPE "ReachChannel" AS ENUM ('EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "PriceRequestStatus" AS ENUM ('SENT', 'TO_SEND_BY_HAND', 'RESPONDED', 'EXPIRED', 'CLOSED');

-- CreateTable
CREATE TABLE "QuoteSettings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "automationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "maxAutoValueMinor" BIGINT NOT NULL DEFAULT 500000,
    "minMarginBps" INTEGER NOT NULL DEFAULT 800,
    "minMatchConfidence" INTEGER NOT NULL DEFAULT 90,
    "supplierHours" INTEGER NOT NULL DEFAULT 24,
    "urgentSupplierHours" INTEGER NOT NULL DEFAULT 6,
    "validityDays" INTEGER NOT NULL DEFAULT 14,
    "tenderMarkupBps" INTEGER,
    "projectMarkupBps" INTEGER,
    "tenderReminderHours" INTEGER NOT NULL DEFAULT 72,
    "quotePrefix" TEXT NOT NULL DEFAULT 'Q',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" "QuoteType" NOT NULL DEFAULT 'STANDARD',
    "source" "QuoteSource" NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'RECEIVED',
    "marketCode" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "customerType" "CustomerTypeCode" NOT NULL,
    "userId" TEXT,
    "organisationId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "companyName" TEXT NOT NULL DEFAULT '',
    "customerReference" TEXT NOT NULL DEFAULT '',
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "tenderReference" TEXT NOT NULL DEFAULT '',
    "tenderDeadline" TIMESTAMP(3),
    "requiredDocuments" TEXT NOT NULL DEFAULT '',
    "includeDocuments" BOOLEAN NOT NULL DEFAULT false,
    "requestText" TEXT NOT NULL DEFAULT '',
    "fileName" TEXT,
    "fileType" TEXT,
    "file" BYTEA,
    "reviewReasons" TEXT,
    "supplierDeadline" TIMESTAMP(3),
    "subtotalMinor" BIGINT,
    "taxMinor" BIGINT,
    "totalMinor" BIGINT,
    "taxName" TEXT NOT NULL DEFAULT 'VAT',
    "taxRateBps" INTEGER NOT NULL DEFAULT 0,
    "costBaseMinor" BIGINT,
    "marginBps" INTEGER,
    "leadTimeDays" INTEGER,
    "paymentTerms" TEXT NOT NULL DEFAULT '',
    "bankDetails" TEXT NOT NULL DEFAULT '',
    "validUntil" TIMESTAMP(3),
    "accessTokenHash" TEXT,
    "readAt" TIMESTAMP(3),
    "pricedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "sentByLabel" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "original" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "mpn" TEXT NOT NULL DEFAULT '',
    "quantity" INTEGER NOT NULL,
    "productId" TEXT,
    "categoryId" TEXT,
    "matchConfidence" INTEGER NOT NULL DEFAULT 0,
    "flagReason" TEXT,
    "costSource" "CostSource",
    "supplierId" TEXT,
    "unitCostBaseMinor" BIGINT,
    "leadTimeDays" INTEGER,
    "priceOverride" BIGINT,
    "unitPriceMinor" BIGINT,
    "lineTotalMinor" BIGINT,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPriceRequest" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "channel" "ReachChannel" NOT NULL,
    "status" "PriceRequestStatus" NOT NULL,
    "lineIds" TEXT[],
    "tokenHash" TEXT NOT NULL,
    "tokenSealed" TEXT NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',
    "replyText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPriceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierQuoteResponse" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "noOffer" BOOLEAN NOT NULL DEFAULT false,
    "costMinor" BIGINT,
    "currency" TEXT NOT NULL,
    "available" INTEGER,
    "leadTimeDays" INTEGER,
    "validUntil" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierQuoteResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEmail" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "quoteId" TEXT,
    "requestId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Quote_number_key" ON "Quote"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_accessTokenHash_key" ON "Quote"("accessTokenHash");

-- CreateIndex
CREATE INDEX "Quote_status_createdAt_idx" ON "Quote"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Quote_organisationId_idx" ON "Quote"("organisationId");

-- CreateIndex
CREATE INDEX "Quote_userId_idx" ON "Quote"("userId");

-- CreateIndex
CREATE INDEX "Quote_email_idx" ON "Quote"("email");

-- CreateIndex
CREATE INDEX "QuoteLine_quoteId_position_idx" ON "QuoteLine"("quoteId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPriceRequest_reference_key" ON "SupplierPriceRequest"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPriceRequest_tokenHash_key" ON "SupplierPriceRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "SupplierPriceRequest_quoteId_idx" ON "SupplierPriceRequest"("quoteId");

-- CreateIndex
CREATE INDEX "SupplierPriceRequest_status_deadline_idx" ON "SupplierPriceRequest"("status", "deadline");

-- CreateIndex
CREATE INDEX "SupplierQuoteResponse_lineId_idx" ON "SupplierQuoteResponse"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierQuoteResponse_requestId_lineId_key" ON "SupplierQuoteResponse"("requestId", "lineId");

-- CreateIndex
CREATE UNIQUE INDEX "InboundEmail_messageId_key" ON "InboundEmail"("messageId");

-- CreateIndex
CREATE INDEX "InboundEmail_fromAddress_createdAt_idx" ON "InboundEmail"("fromAddress", "createdAt");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_marketCode_fkey" FOREIGN KEY ("marketCode") REFERENCES "Market"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceRequest" ADD CONSTRAINT "SupplierPriceRequest_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceRequest" ADD CONSTRAINT "SupplierPriceRequest_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuoteResponse" ADD CONSTRAINT "SupplierQuoteResponse_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SupplierPriceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuoteResponse" ADD CONSTRAINT "SupplierQuoteResponse_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "QuoteLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Quote numbers, as for orders.
CREATE SEQUENCE "quote_number_seq" START WITH 100001;
