-- CreateEnum
CREATE TYPE "SpecialKind" AS ENUM ('PRODUCT', 'CATEGORY', 'BUNDLE');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('AWAITING_PAYMENT', 'PAID', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Fulfilment" AS ENUM ('DELIVERY', 'COLLECTION');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CARD');

-- AlterTable
ALTER TABLE "Market" ADD COLUMN     "bankDetails" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "deliveryEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deliveryFeeMinor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "freeDeliveryMinor" BIGINT,
ADD COLUMN     "taxName" TEXT NOT NULL DEFAULT 'VAT',
ADD COLUMN     "taxRateBps" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "costRefreshedAt" TIMESTAMP(3),
ADD COLUMN     "landedCostMinor" BIGINT,
ADD COLUMN     "leadTimeDays" INTEGER;

-- CreateTable
CREATE TABLE "CollectionPoint" (
    "id" TEXT NOT NULL,
    "marketCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "hours" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CollectionPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "heroTitle" TEXT NOT NULL DEFAULT 'ICT for work and home, delivered across Southern Africa',
    "heroText" TEXT NOT NULL DEFAULT 'Laptops, phones, monitors and the rest, at clear prices. Businesses get trade pricing and quotes.',
    "payDays" INTEGER NOT NULL DEFAULT 3,
    "maxLineQuantity" INTEGER NOT NULL DEFAULT 10,
    "orderPrefix" TEXT NOT NULL DEFAULT 'ICT',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeaturedProduct" (
    "productId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeaturedProduct_pkey" PRIMARY KEY ("productId")
);

-- CreateTable
CREATE TABLE "Special" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "kind" "SpecialKind" NOT NULL,
    "categoryId" TEXT,
    "discountBps" INTEGER,
    "priceMinor" BIGINT,
    "marketCode" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "quantityLimit" INTEGER,
    "quantityUsed" INTEGER NOT NULL DEFAULT 0,
    "perOrderLimit" INTEGER,
    "customerTypes" "CustomerTypeCode"[],
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Special_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecialItem" (
    "specialId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SpecialItem_pkey" PRIMARY KEY ("specialId","productId")
);

-- CreateTable
CREATE TABLE "Cart" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartLine" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "productId" TEXT,
    "bundleId" TEXT,
    "quantity" INTEGER NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CartLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "marketCode" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "customerType" "CustomerTypeCode" NOT NULL,
    "userId" TEXT,
    "organisationId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "fulfilment" "Fulfilment" NOT NULL,
    "addressLine1" TEXT NOT NULL DEFAULT '',
    "addressLine2" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "postalCode" TEXT NOT NULL DEFAULT '',
    "collectionPointId" TEXT,
    "collectionText" TEXT NOT NULL DEFAULT '',
    "paymentMethod" "PaymentMethod" NOT NULL,
    "bankDetails" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "subtotalMinor" BIGINT NOT NULL,
    "deliveryMinor" BIGINT NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "taxMinor" BIGINT NOT NULL,
    "taxName" TEXT NOT NULL,
    "taxRateBps" INTEGER NOT NULL,
    "accessTokenHash" TEXT NOT NULL,
    "payBy" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "bundleId" TEXT,
    "description" TEXT NOT NULL,
    "mpn" TEXT NOT NULL DEFAULT '',
    "quantity" INTEGER NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL,
    "listUnitPriceMinor" BIGINT,
    "lineTotalMinor" BIGINT NOT NULL,
    "specialId" TEXT,
    "specialName" TEXT,
    "specialUnits" INTEGER NOT NULL DEFAULT 0,
    "unitCostBaseMinor" BIGINT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderPayment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "receivedOn" TIMESTAMP(3) NOT NULL,
    "recordedByLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CollectionPoint_marketCode_idx" ON "CollectionPoint"("marketCode");

-- CreateIndex
CREATE UNIQUE INDEX "Special_slug_key" ON "Special"("slug");

-- CreateIndex
CREATE INDEX "Special_active_endsAt_idx" ON "Special"("active", "endsAt");

-- CreateIndex
CREATE INDEX "SpecialItem_productId_idx" ON "SpecialItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Cart_tokenHash_key" ON "Cart"("tokenHash");

-- CreateIndex
CREATE INDEX "Cart_updatedAt_idx" ON "Cart"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CartLine_cartId_productId_key" ON "CartLine"("cartId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "CartLine_cartId_bundleId_key" ON "CartLine"("cartId", "bundleId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Order_accessTokenHash_key" ON "Order"("accessTokenHash");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_userId_idx" ON "Order"("userId");

-- CreateIndex
CREATE INDEX "Order_email_idx" ON "Order"("email");

-- CreateIndex
CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");

-- CreateIndex
CREATE INDEX "OrderPayment_orderId_idx" ON "OrderPayment"("orderId");

-- AddForeignKey
ALTER TABLE "CollectionPoint" ADD CONSTRAINT "CollectionPoint_marketCode_fkey" FOREIGN KEY ("marketCode") REFERENCES "Market"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturedProduct" ADD CONSTRAINT "FeaturedProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Special" ADD CONSTRAINT "Special_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Special" ADD CONSTRAINT "Special_marketCode_fkey" FOREIGN KEY ("marketCode") REFERENCES "Market"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialItem" ADD CONSTRAINT "SpecialItem_specialId_fkey" FOREIGN KEY ("specialId") REFERENCES "Special"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialItem" ADD CONSTRAINT "SpecialItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartLine" ADD CONSTRAINT "CartLine_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartLine" ADD CONSTRAINT "CartLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartLine" ADD CONSTRAINT "CartLine_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Special"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_marketCode_fkey" FOREIGN KEY ("marketCode") REFERENCES "Market"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_collectionPointId_fkey" FOREIGN KEY ("collectionPointId") REFERENCES "CollectionPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Order numbers: ICT-100001 onwards, never reused.
CREATE SEQUENCE "order_number_seq" START WITH 100001;

-- Launch values, edited at /admin/markets. Standard rates on 2026-10-07: Botswana VAT 14%, South Africa VAT 15%, Zimbabwe VAT 15.5%.
UPDATE "Market" SET "taxRateBps" = 1400 WHERE "code" = 'bw';
UPDATE "Market" SET "taxRateBps" = 1500 WHERE "code" = 'za';
UPDATE "Market" SET "taxRateBps" = 1550 WHERE "code" = 'zw';
