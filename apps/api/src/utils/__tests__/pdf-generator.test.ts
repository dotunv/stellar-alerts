import { describe, it, expect } from 'vitest';
import { generateLedgerStatementPdf } from '../pdf-generator';

describe('generateLedgerStatementPdf', () => {
  const basePayments = [
    {
      txHash: 'abcdef1234567890abcdef1234567890',
      fromAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
      amount: '100.5',
      asset: 'XLM',
      receivedAt: new Date('2026-08-01T00:00:00Z'),
    },
    {
      txHash: 'fedcba0987654321fedcba0987654321',
      fromAddress: 'GZYXWVUTSRQPONMLKJIHGFEDCBA765432',
      amount: '50',
      asset: 'USDC',
      receivedAt: new Date('2026-08-10T00:00:00Z'),
    },
  ];

  it('resolves a non-empty PDF buffer that starts with the PDF file signature', async () => {
    const buffer = await generateLedgerStatementPdf({
      userEmail: 'user@example.com',
      walletLabel: 'Main Wallet',
      publicKey: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
      periodStart: new Date('2026-08-01T00:00:00Z'),
      periodEnd: new Date('2026-08-31T00:00:00Z'),
      payments: basePayments,
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString('utf-8')).toBe('%PDF-');
  });

  it('produces output even when there are no transactions in the period', async () => {
    const buffer = await generateLedgerStatementPdf({
      userEmail: 'empty@example.com',
      walletLabel: null,
      publicKey: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
      periodStart: new Date('2026-08-01T00:00:00Z'),
      periodEnd: new Date('2026-08-31T00:00:00Z'),
      payments: [],
    });

    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString('utf-8')).toBe('%PDF-');
  });
});
