-- CreateEnum
CREATE TYPE "ReturnOutcome" AS ENUM ('CREDIT', 'REPLACEMENT', 'REPAIR', 'OTHER');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('WITH_CUSTOMER', 'IN_REPAIR', 'REPLACED', 'RETURNED');

-- AlterEnum
ALTER TYPE "ReturnStatus" ADD VALUE 'IN_REPAIR';

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "serials" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ReturnRequest" ADD COLUMN     "inboundCarrier" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "inboundReference" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "outboundCarrier" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "outboundReference" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "outcome" "ReturnOutcome",
ADD COLUMN     "repairStartedAt" TIMESTAMP(3),
ADD COLUMN     "sentBackAt" TIMESTAMP(3),
ADD COLUMN     "supplierReference" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "wants" "ReturnOutcome";

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "serialKey" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "productId" TEXT,
    "userId" TEXT,
    "organisationId" TEXT,
    "description" TEXT NOT NULL,
    "mpn" TEXT NOT NULL DEFAULT '',
    "warrantyMonths" INTEGER,
    "warrantyTerms" TEXT NOT NULL DEFAULT '',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "status" "UnitStatus" NOT NULL DEFAULT 'WITH_CUSTOMER',
    "source" TEXT NOT NULL,
    "replacedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnUnit" (
    "id" TEXT NOT NULL,
    "returnLineId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,

    CONSTRAINT "ReturnUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "returnId" TEXT,
    "userId" TEXT,
    "organisationId" TEXT,
    "currency" TEXT NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "taxMinor" BIGINT NOT NULL,
    "lines" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "issuedByLabel" TEXT NOT NULL,
    "accessTokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderRefund" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "creditNoteId" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "paidOn" TIMESTAMP(3) NOT NULL,
    "recordedByLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Unit_replacedById_key" ON "Unit"("replacedById");

-- CreateIndex
CREATE INDEX "Unit_serialKey_idx" ON "Unit"("serialKey");

-- CreateIndex
CREATE INDEX "Unit_organisationId_createdAt_idx" ON "Unit"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "Unit_userId_createdAt_idx" ON "Unit"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_orderLineId_serialKey_key" ON "Unit"("orderLineId", "serialKey");

-- CreateIndex
CREATE INDEX "ReturnUnit_unitId_idx" ON "ReturnUnit"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnUnit_returnLineId_unitId_key" ON "ReturnUnit"("returnLineId", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_number_key" ON "CreditNote"("number");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_returnId_key" ON "CreditNote"("returnId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_accessTokenHash_key" ON "CreditNote"("accessTokenHash");

-- CreateIndex
CREATE INDEX "CreditNote_orderId_idx" ON "CreditNote"("orderId");

-- CreateIndex
CREATE INDEX "CreditNote_organisationId_issuedAt_idx" ON "CreditNote"("organisationId", "issuedAt");

-- CreateIndex
CREATE INDEX "CreditNote_userId_issuedAt_idx" ON "CreditNote"("userId", "issuedAt");

-- CreateIndex
CREATE INDEX "OrderRefund_orderId_idx" ON "OrderRefund"("orderId");

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnUnit" ADD CONSTRAINT "ReturnUnit_returnLineId_fkey" FOREIGN KEY ("returnLineId") REFERENCES "ReturnLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnUnit" ADD CONSTRAINT "ReturnUnit_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "ReturnRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRefund" ADD CONSTRAINT "OrderRefund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRefund" ADD CONSTRAINT "OrderRefund_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Credit note numbers: CN-100001 onwards.
CREATE SEQUENCE credit_note_number_seq START 100001;
