-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "accountCode" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "FinanceSettings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "remindersOn" BOOLEAN NOT NULL DEFAULT true,
    "firstReminderDays" INTEGER NOT NULL DEFAULT 3,
    "reminderEveryDays" INTEGER NOT NULL DEFAULT 7,
    "maxReminders" INTEGER NOT NULL DEFAULT 3,
    "salesAccountCode" TEXT NOT NULL DEFAULT '4000',
    "taxCode" TEXT NOT NULL DEFAULT 'T1',
    "zeroTaxCode" TEXT NOT NULL DEFAULT 'T0',
    "cashAccountCode" TEXT NOT NULL DEFAULT 'CASHSALE',
    "bankAccountCode" TEXT NOT NULL DEFAULT '1200',
    "updatedByLabel" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceReminder" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "outstandingMinor" BIGINT NOT NULL,
    "accessTokenHash" TEXT NOT NULL,
    "sentByLabel" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceReminder_accessTokenHash_key" ON "InvoiceReminder"("accessTokenHash");

-- CreateIndex
CREATE INDEX "InvoiceReminder_sentAt_idx" ON "InvoiceReminder"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceReminder_invoiceId_sequence_key" ON "InvoiceReminder"("invoiceId", "sequence");

-- AddForeignKey
ALTER TABLE "InvoiceReminder" ADD CONSTRAINT "InvoiceReminder_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

