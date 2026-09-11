-- CreateTable
CREATE TABLE "MultisigTreasury" (
    "id" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "label" TEXT,
    "thresholdLevel" TEXT NOT NULL DEFAULT 'medium',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MultisigTreasury_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultisigSignerWatcher" (
    "id" TEXT NOT NULL,
    "treasuryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "signerPublicKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MultisigSignerWatcher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingMultisigTransaction" (
    "id" TEXT NOT NULL,
    "treasuryId" TEXT NOT NULL,
    "innerTxHash" TEXT NOT NULL,
    "envelopeXdr" TEXT NOT NULL,
    "requiredThreshold" INTEGER NOT NULL,
    "collectedWeight" INTEGER NOT NULL DEFAULT 0,
    "signedByJson" JSONB NOT NULL DEFAULT '[]',
    "notifiedJson" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingMultisigTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MultisigTreasury_publicKey_key" ON "MultisigTreasury"("publicKey");

-- CreateIndex
CREATE UNIQUE INDEX "MultisigSignerWatcher_treasuryId_signerPublicKey_key" ON "MultisigSignerWatcher"("treasuryId", "signerPublicKey");

-- CreateIndex
CREATE INDEX "MultisigSignerWatcher_treasuryId_idx" ON "MultisigSignerWatcher"("treasuryId");

-- CreateIndex
CREATE INDEX "MultisigSignerWatcher_userId_idx" ON "MultisigSignerWatcher"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PendingMultisigTransaction_innerTxHash_key" ON "PendingMultisigTransaction"("innerTxHash");

-- CreateIndex
CREATE INDEX "PendingMultisigTransaction_treasuryId_idx" ON "PendingMultisigTransaction"("treasuryId");

-- CreateIndex
CREATE INDEX "PendingMultisigTransaction_status_idx" ON "PendingMultisigTransaction"("status");

-- AddForeignKey
ALTER TABLE "MultisigSignerWatcher" ADD CONSTRAINT "MultisigSignerWatcher_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "MultisigTreasury"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultisigSignerWatcher" ADD CONSTRAINT "MultisigSignerWatcher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingMultisigTransaction" ADD CONSTRAINT "PendingMultisigTransaction_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "MultisigTreasury"("id") ON DELETE CASCADE ON UPDATE CASCADE;
