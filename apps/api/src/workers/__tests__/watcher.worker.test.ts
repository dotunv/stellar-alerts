import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    payment: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    ingestionCursor: {
      findUnique: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock('../../lib/stellar', () => ({
  decodeHorizonAsset: vi.fn((record: any) => ({
    assetCode: record?.asset_type === 'native' ? 'XLM' : record?.asset_code || 'XLM',
    assetIssuer: record?.asset_issuer || null,
  })),
  stellar: {
    server: {},
    getRecentPayments: vi.fn(),
    getPaymentsSince: vi.fn(),
    getLatestPagingToken: vi.fn(),
  },
}));

vi.mock('../../lib/queue', () => ({
  enqueuePaymentAlert: vi.fn(),
}));

vi.mock('../../lib/lock', () => ({
  withWalletLock: vi.fn(async (_walletId: string, fn: () => Promise<any>) => fn()),
}));

import { prisma } from '../../lib/prisma';
import { stellar } from '../../lib/stellar';
import { ensureCursor, processWalletPayments, saveCursor } from '../watcher.worker';

const wallet = {
  id: 'wallet-1',
  publicKey: 'GBPDX2DPUHABCGNHXQRNK5A6NGV5R7T244HJ5CXAWSWVRTZR4WMADE72',
};

const paymentRecord = (pagingToken: string, txHash: string) => ({
  id: pagingToken,
  paging_token: pagingToken,
  type: 'payment',
  amount: '10.5',
  asset_type: 'native',
  from: 'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSFMG4BVI',
  transaction_hash: txHash,
  created_at: '2026-08-24T10:00:00Z',
});

describe('Watcher ingestion cursor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.payment.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.payment.create).mockResolvedValue({ id: 'payment-1' } as any);
  });

  describe('ensureCursor', () => {
    it('creates a cursor record seeded from the latest paging token on first sight', async () => {
      vi.mocked(prisma.ingestionCursor.findUnique).mockResolvedValue(null as any);
      vi.mocked(stellar.getLatestPagingToken).mockResolvedValue('4000');
      vi.mocked(prisma.ingestionCursor.create).mockResolvedValue({ pagingToken: '4000' } as any);

      const cursor = await ensureCursor(wallet);

      expect(prisma.ingestionCursor.create).toHaveBeenCalledWith({
        data: { walletId: wallet.id, pagingToken: '4000' },
      });
      expect(cursor).toBe('4000');
    });

    it('returns the persisted paging token without touching Horizon', async () => {
      vi.mocked(prisma.ingestionCursor.findUnique).mockResolvedValue({ pagingToken: '4200' } as any);

      const cursor = await ensureCursor(wallet);

      expect(cursor).toBe('4200');
      expect(stellar.getLatestPagingToken).not.toHaveBeenCalled();
      expect(prisma.ingestionCursor.create).not.toHaveBeenCalled();
    });
  });

  describe('saveCursor', () => {
    it('upserts the paging token keyed by wallet', async () => {
      await saveCursor(wallet.id, '4300');

      expect(prisma.ingestionCursor.upsert).toHaveBeenCalledWith({
        where: { walletId: wallet.id },
        create: { walletId: wallet.id, pagingToken: '4300' },
        update: { pagingToken: '4300' },
      });
    });
  });

  describe('processWalletPayments', () => {
    it('resumes the Horizon query from the persisted cursor', async () => {
      vi.mocked(prisma.ingestionCursor.findUnique).mockResolvedValue({ pagingToken: '4200' } as any);
      vi.mocked(stellar.getPaymentsSince).mockResolvedValue([] as any);

      await processWalletPayments(wallet);

      expect(stellar.getPaymentsSince).toHaveBeenCalledWith(wallet.publicKey, '4200', 50);
    });

    it('advances the cursor to the paging token of every processed record', async () => {
      vi.mocked(prisma.ingestionCursor.findUnique).mockResolvedValue({ pagingToken: '4200' } as any);
      vi.mocked(stellar.getPaymentsSince).mockResolvedValue([
        paymentRecord('4201', 'hash-a'),
        paymentRecord('4202', 'hash-b'),
      ] as any);

      await processWalletPayments(wallet);

      expect(vi.mocked(prisma.ingestionCursor.upsert).mock.calls.map((call) => call[0].update)).toEqual([
        { pagingToken: '4201' },
        { pagingToken: '4202' },
      ]);
    });

    it('pages through a backlog until Horizon returns a partial page', async () => {
      vi.mocked(prisma.ingestionCursor.findUnique).mockResolvedValue({ pagingToken: '4200' } as any);
      const fullPage = Array.from({ length: 50 }, (_, i) =>
        paymentRecord(String(4201 + i), `hash-${i}`)
      );
      vi.mocked(stellar.getPaymentsSince)
        .mockResolvedValueOnce(fullPage as any)
        .mockResolvedValueOnce([paymentRecord('4251', 'hash-tail')] as any);

      await processWalletPayments(wallet);

      expect(stellar.getPaymentsSince).toHaveBeenCalledTimes(2);
      expect(vi.mocked(stellar.getPaymentsSince).mock.calls[1]).toEqual([wallet.publicKey, '4250', 50]);
    });

    it('skips wallets with an invalid public key', async () => {
      await processWalletPayments({ id: 'wallet-2', publicKey: 'not-a-key' });

      expect(prisma.ingestionCursor.findUnique).not.toHaveBeenCalled();
      expect(stellar.getPaymentsSince).not.toHaveBeenCalled();
    });
  });
});
