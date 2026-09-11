import type { LedgerStatementPayment } from './pdf-generator';

const CSV_HEADERS = ['Date', 'Transaction Hash', 'From Address', 'Amount', 'Asset'];

function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Renders a CSV ledger statement matching the PDF's transaction rows, so the
 * two attachments reconcile for tax auditing.
 */
export function generateLedgerStatementCsv(payments: LedgerStatementPayment[]): string {
  const rows = payments.map((payment) => {
    const receivedAt = new Date(payment.receivedAt).toISOString().slice(0, 10);
    return [
      receivedAt,
      payment.txHash,
      payment.fromAddress,
      String(payment.amount),
      payment.asset,
    ]
      .map(escapeCsvField)
      .join(',');
  });

  return [CSV_HEADERS.join(','), ...rows].join('\n');
}
