import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';

export interface LedgerStatementPayment {
  txHash: string;
  fromAddress: string;
  amount: string | number;
  asset: string;
  receivedAt: Date | string;
}

export interface LedgerStatementInput {
  userEmail: string;
  walletLabel?: string | null;
  publicKey: string;
  periodStart: Date;
  periodEnd: Date;
  payments: LedgerStatementPayment[];
}

/**
 * Renders a PDF ledger statement for the given period and streams the bytes
 * back as a Buffer, so callers can attach it to an email without touching disk.
 */
export function generateLedgerStatementPdf(input: LedgerStatementInput): Promise<Buffer> {
  const { userEmail, walletLabel, publicKey, periodStart, periodEnd, payments } = input;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];

    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);

    doc.fontSize(18).text('Stellar Alerts — Ledger Statement', { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#555555');
    doc.text(`Account: ${userEmail}`);
    doc.text(`Wallet: ${walletLabel ? `${walletLabel} (${publicKey})` : publicKey}`);
    doc.text(`Period: ${periodStart.toISOString().slice(0, 10)} to ${periodEnd.toISOString().slice(0, 10)}`);
    doc.fillColor('#000000');
    doc.moveDown(1);

    doc.fontSize(12).text(`Transactions (${payments.length})`, { underline: true });
    doc.moveDown(0.5);

    const columns = { date: 50, hash: 140, from: 280, amount: 430 };
    doc.fontSize(9).fillColor('#333333');
    doc.text('Date', columns.date, doc.y, { continued: true });
    doc.text('Tx Hash', columns.hash, doc.y, { continued: true });
    doc.text('From', columns.from, doc.y, { continued: true });
    doc.text('Amount', columns.amount, doc.y);
    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.3);

    doc.fontSize(8).fillColor('#000000');
    let total = 0;
    for (const payment of payments) {
      const receivedAt = new Date(payment.receivedAt);
      const amount = Number(payment.amount);
      total += Number.isFinite(amount) ? amount : 0;

      const rowY = doc.y;
      doc.text(receivedAt.toISOString().slice(0, 10), columns.date, rowY, { continued: true });
      doc.text(payment.txHash.slice(0, 16) + '…', columns.hash, rowY, { continued: true });
      doc.text(payment.fromAddress.slice(0, 12) + '…', columns.from, rowY, { continued: true });
      doc.text(`${payment.amount} ${payment.asset}`, columns.amount, rowY);
    }

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Total received this period: ${total} (mixed assets shown per-row)`, { align: 'right' });

    doc.end();
  });
}
