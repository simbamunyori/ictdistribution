-- CreateEnum
CREATE TYPE "ShipMode" AS ENUM ('AIR', 'SEA', 'ROAD', 'COURIER');

-- CreateEnum
CREATE TYPE "ShipmentSource" AS ENUM ('HISTORY', 'LIVE');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('BOOKED', 'IN_TRANSIT', 'AT_CUSTOMS', 'CLEARED', 'ARRIVED');

-- CreateEnum
CREATE TYPE "LineTracking" AS ENUM ('ORDERED', 'SHIPPED', 'IN_TRANSIT', 'AT_CUSTOMS', 'CLEARED', 'IN_WAREHOUSE', 'OUT_FOR_DELIVERY', 'DELIVERED');

-- CreateEnum
CREATE TYPE "StockMovementKind" AS ENUM ('RECEIVED', 'ALLOCATED', 'ISSUED', 'ADJUSTED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PREPARED', 'DISPATCHED', 'DELIVERED');

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "hsCode" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "fromStock" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tracking" "LineTracking";

-- AlterTable
ALTER TABLE "ProcurementSettings" ADD COLUMN     "dropShipByDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "useStock" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "heightMm" INTEGER,
ADD COLUMN     "lengthMm" INTEGER,
ADD COLUMN     "weightGrams" INTEGER,
ADD COLUMN     "widthMm" INTEGER;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "dropShip" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shipmentId" TEXT,
ADD COLUMN     "warehouseId" TEXT;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "freightMode" "ShipMode" NOT NULL DEFAULT 'ROAD';

-- CreateTable
CREATE TABLE "LogisticsSettings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "homeCountry" TEXT NOT NULL DEFAULT 'BW',
    "defaultWarehouseId" TEXT,
    "airKgPerM3" INTEGER NOT NULL DEFAULT 167,
    "courierKgPerM3" INTEGER NOT NULL DEFAULT 200,
    "roadKgPerM3" INTEGER NOT NULL DEFAULT 333,
    "seaKgPerM3" INTEGER NOT NULL DEFAULT 1000,
    "insuranceBps" INTEGER NOT NULL DEFAULT 50,
    "sampleSize" INTEGER NOT NULL DEFAULT 20,
    "incoterm" TEXT NOT NULL DEFAULT 'DAP',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LogisticsSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "source" "ShipmentSource" NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'BOOKED',
    "mode" "ShipMode" NOT NULL,
    "originCountry" TEXT NOT NULL,
    "destinationCountry" TEXT NOT NULL,
    "carrier" TEXT NOT NULL DEFAULT '',
    "reference" TEXT NOT NULL DEFAULT '',
    "weightGrams" INTEGER NOT NULL,
    "volumeCm3" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "goodsValueMinor" BIGINT,
    "freightMinor" BIGINT NOT NULL DEFAULT 0,
    "insuranceMinor" BIGINT NOT NULL DEFAULT 0,
    "dutiesMinor" BIGINT NOT NULL DEFAULT 0,
    "clearingMinor" BIGINT NOT NULL DEFAULT 0,
    "otherMinor" BIGINT NOT NULL DEFAULT 0,
    "shippedOn" TIMESTAMP(3),
    "arrivedOn" TIMESTAMP(3),
    "transitDays" INTEGER,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdByLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FreightOverride" (
    "id" TEXT NOT NULL,
    "originCountry" TEXT NOT NULL,
    "destinationCountry" TEXT NOT NULL,
    "mode" "ShipMode" NOT NULL,
    "perKgMinor" BIGINT,
    "feesPerKgMinor" BIGINT,
    "transitDays" INTEGER,
    "note" TEXT NOT NULL DEFAULT '',
    "updatedByLabel" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FreightOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DutyRule" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT,
    "destinationCountry" TEXT NOT NULL,
    "dutyBps" INTEGER NOT NULL DEFAULT 0,
    "leviesBps" INTEGER NOT NULL DEFAULT 0,
    "exemptOrigins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DutyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingEvent" (
    "id" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "status" "LineTracking" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "byLabel" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLevel" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "allocated" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" "StockMovementKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "orderLineId" TEXT,
    "purchaseOrderId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "byLabel" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PREPARED',
    "carrier" TEXT NOT NULL DEFAULT '',
    "reference" TEXT NOT NULL DEFAULT '',
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "receivedBy" TEXT NOT NULL DEFAULT '',
    "podFilename" TEXT,
    "podContentType" TEXT,
    "podBytes" BYTEA,
    "createdByLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryLine" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "DeliveryLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_number_key" ON "Shipment"("number");

-- CreateIndex
CREATE INDEX "Shipment_originCountry_destinationCountry_mode_status_idx" ON "Shipment"("originCountry", "destinationCountry", "mode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FreightOverride_originCountry_destinationCountry_mode_key" ON "FreightOverride"("originCountry", "destinationCountry", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "DutyRule_categoryId_destinationCountry_key" ON "DutyRule"("categoryId", "destinationCountry");

-- CreateIndex
CREATE INDEX "TrackingEvent_orderLineId_at_idx" ON "TrackingEvent"("orderLineId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");

-- CreateIndex
CREATE UNIQUE INDEX "StockLevel_warehouseId_productId_key" ON "StockLevel"("warehouseId", "productId");

-- CreateIndex
CREATE INDEX "StockMovement_warehouseId_productId_at_idx" ON "StockMovement"("warehouseId", "productId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_number_key" ON "Delivery"("number");

-- CreateIndex
CREATE INDEX "Delivery_orderId_idx" ON "Delivery"("orderId");

-- CreateIndex
CREATE INDEX "Delivery_status_createdAt_idx" ON "Delivery"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryLine_deliveryId_orderLineId_key" ON "DeliveryLine"("deliveryId", "orderLineId");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyRule" ADD CONSTRAINT "DutyRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryLine" ADD CONSTRAINT "DeliveryLine_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryLine" ADD CONSTRAINT "DeliveryLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Shipment and delivery note numbers.
CREATE SEQUENCE "shipment_number_seq" START WITH 100001;
CREATE SEQUENCE "delivery_number_seq" START WITH 100001;

-- AlterTable
ALTER TABLE "PurchaseOrderLine" ADD COLUMN "productId" TEXT;
