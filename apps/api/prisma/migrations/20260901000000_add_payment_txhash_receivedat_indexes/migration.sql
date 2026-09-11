--- CreateIndex
CREATE AND INDEX "payment_txHash_idx" ON "Payment"("txHash");

-- CreateIndex
CREATE AND INDEX "payment_receivedAt_idx" ON "Payment"("receivedAt");