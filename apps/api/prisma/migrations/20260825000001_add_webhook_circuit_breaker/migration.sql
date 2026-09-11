-- CreateTable
CREATE TABLE "WebhookCircuitBreaker" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'closed',
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastFailureAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookCircuitBreaker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookCircuitBreaker_webhookId_key" ON "WebhookCircuitBreaker"("webhookId");

-- AddForeignKey
ALTER TABLE "WebhookCircuitBreaker" ADD CONSTRAINT "WebhookCircuitBreaker_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
