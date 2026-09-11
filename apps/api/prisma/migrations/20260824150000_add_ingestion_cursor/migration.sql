-- CreateTable
CREATE TABLE "IngestionCursor" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "pagingToken" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestionCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IngestionCursor_walletId_key" ON "IngestionCursor"("walletId");

-- AddForeignKey
ALTER TABLE "IngestionCursor" ADD CONSTRAINT "IngestionCursor_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
