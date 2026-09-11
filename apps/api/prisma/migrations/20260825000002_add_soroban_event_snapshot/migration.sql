-- CreateTable
CREATE TABLE "SorobanEventSnapshot" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "ledgerSeq" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL DEFAULT 'transfer',
    "txHash" TEXT,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SorobanEventSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SorobanEventSnapshot_contractId_ledgerSeq_from_to_amount_key" ON "SorobanEventSnapshot"("contractId", "ledgerSeq", "from", "to", "amount");

-- CreateIndex
CREATE INDEX "SorobanEventSnapshot_contractId_idx" ON "SorobanEventSnapshot"("contractId");

-- CreateIndex
CREATE INDEX "SorobanEventSnapshot_ledgerSeq_idx" ON "SorobanEventSnapshot"("ledgerSeq");
