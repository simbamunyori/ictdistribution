-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('AWAITING_APPROVAL', 'TO_SEND_BY_HAND', 'SENT', 'CONFIRMED', 'SHIPPED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PoDocumentKind" AS ENUM ('INVOICE', 'PACKING_LIST', 'OTHER');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "pricesIncludeTax" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "procuredAt" TIMESTAMP(3),
ADD COLUMN     "quoteId" TEXT;

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "supplierCostMinor" BIGINT,
ADD COLUMN     "supplierCurrency" TEXT,
ADD COLUMN     "supplierId" TEXT;

-- CreateTable
CREATE TABLE "ProcurementSettings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "autoSend" BOOLEAN NOT NULL DEFAULT false,
    "maxAutoValueMinor" BIGINT NOT NULL DEFAULT 200000,
    "onlyPreferred" BOOLEAN NOT NULL DEFAULT true,
    "poPrefix" TEXT NOT NULL DEFAULT 'PO',
    "deliverTo" TEXT NOT NULL DEFAULT '',
    "paymentTerms" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcurementSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL,
    "channel" "ReachChannel" NOT NULL,
    "currency" TEXT NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "totalBaseMinor" BIGINT,
    "reviewReasons" TEXT,
    "tokenHash" TEXT NOT NULL,
    "tokenSealed" TEXT NOT NULL,
    "approvedByLabel" TEXT,
    "sentAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "supplierReference" TEXT NOT NULL DEFAULT '',
    "expectedShipDate" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "shippingReference" TEXT NOT NULL DEFAULT '',
    "supplierNote" TEXT NOT NULL DEFAULT '',
    "receivedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "orderLineId" TEXT,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "mpn" TEXT NOT NULL DEFAULT '',
    "quantity" INTEGER NOT NULL,
    "unitCostMinor" BIGINT NOT NULL,
    "lineTotalMinor" BIGINT NOT NULL,
    "confirmedQuantity" INTEGER,
    "shipDate" TIMESTAMP(3),
    "serials" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderDocument" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "kind" "PoDocumentKind" NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "uploadedByLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_number_key" ON "PurchaseOrder"("number");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_tokenHash_key" ON "PurchaseOrder"("tokenHash");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_createdAt_idx" ON "PurchaseOrder"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseOrder_orderId_idx" ON "PurchaseOrder"("orderId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_purchaseOrderId_position_idx" ON "PurchaseOrderLine"("purchaseOrderId", "position");

-- CreateIndex
CREATE INDEX "PurchaseOrderDocument_purchaseOrderId_idx" ON "PurchaseOrderDocument"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_quoteId_key" ON "Order"("quoteId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderDocument" ADD CONSTRAINT "PurchaseOrderDocument_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Purchase order numbers.
CREATE SEQUENCE "po_number_seq" START WITH 100001;
