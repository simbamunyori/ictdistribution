-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('REGISTRATION', 'TAX', 'DIRECTOR_ID', 'ADDRESS', 'OTHER');

-- CreateEnum
CREATE TYPE "CreditApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'WITHDRAWN');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'ON_ACCOUNT';

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'ACCOUNT';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "customerReference" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "address" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "creditLimitMinor" BIGINT,
ADD COLUMN     "creditOnHold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "creditTermsDays" INTEGER,
ADD COLUMN     "directors" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "verification" "VerificationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
ADD COLUMN     "verificationNote" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedByLabel" TEXT;

-- CreateTable
CREATE TABLE "CategoryMarkup" (
    "id" TEXT NOT NULL,
    "customerType" "CustomerTypeCode" NOT NULL,
    "categoryId" TEXT NOT NULL,
    "markupBps" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryMarkup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolumeBreak" (
    "id" TEXT NOT NULL,
    "customerType" "CustomerTypeCode" NOT NULL,
    "categoryId" TEXT,
    "minQuantity" INTEGER NOT NULL,
    "discountBps" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VolumeBreak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganisationDocument" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedByLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganisationDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPrice" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "marketCode" TEXT NOT NULL,
    "priceMinor" BIGINT NOT NULL,
    "validUntil" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',
    "createdByLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditApplication" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "status" "CreditApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "requestedLimitMinor" BIGINT NOT NULL,
    "requestedTermsDays" INTEGER NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "appliedByLabel" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decidedByLabel" TEXT,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CategoryMarkup_customerType_categoryId_key" ON "CategoryMarkup"("customerType", "categoryId");

-- CreateIndex
CREATE INDEX "VolumeBreak_customerType_idx" ON "VolumeBreak"("customerType");

-- CreateIndex
CREATE INDEX "OrganisationDocument_organisationId_idx" ON "OrganisationDocument"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPrice_organisationId_productId_marketCode_key" ON "CustomerPrice"("organisationId", "productId", "marketCode");

-- CreateIndex
CREATE INDEX "CreditApplication_status_createdAt_idx" ON "CreditApplication"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_organisationId_paymentMethod_idx" ON "Order"("organisationId", "paymentMethod");

-- CreateIndex
CREATE INDEX "Organisation_verification_idx" ON "Organisation"("verification");

-- AddForeignKey
ALTER TABLE "CategoryMarkup" ADD CONSTRAINT "CategoryMarkup_customerType_fkey" FOREIGN KEY ("customerType") REFERENCES "CustomerType"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryMarkup" ADD CONSTRAINT "CategoryMarkup_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolumeBreak" ADD CONSTRAINT "VolumeBreak_customerType_fkey" FOREIGN KEY ("customerType") REFERENCES "CustomerType"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolumeBreak" ADD CONSTRAINT "VolumeBreak_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationDocument" ADD CONSTRAINT "OrganisationDocument_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPrice" ADD CONSTRAINT "CustomerPrice_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPrice" ADD CONSTRAINT "CustomerPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPrice" ADD CONSTRAINT "CustomerPrice_marketCode_fkey" FOREIGN KEY ("marketCode") REFERENCES "Market"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditApplication" ADD CONSTRAINT "CreditApplication_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

