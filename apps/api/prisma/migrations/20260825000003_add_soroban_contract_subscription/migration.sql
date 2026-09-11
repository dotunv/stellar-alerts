-- CreateTable
CREATE TABLE "SorobanContractSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "topic" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SorobanContractSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SorobanContractSubscription_userId_contractId_topic_key" ON "SorobanContractSubscription"("userId", "contractId", "topic");

-- CreateIndex
CREATE INDEX "SorobanContractSubscription_contractId_idx" ON "SorobanContractSubscription"("contractId");

-- CreateIndex
CREATE INDEX "SorobanContractSubscription_userId_idx" ON "SorobanContractSubscription"("userId");

-- AddForeignKey
ALTER TABLE "SorobanContractSubscription" ADD CONSTRAINT "SorobanContractSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
