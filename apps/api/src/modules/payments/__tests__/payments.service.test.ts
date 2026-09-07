import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    payment: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
    sorobanEventSnapshot: {
      findMany: vi.fn(),
    },
    sorobanContractSubscription: {
      findMany: vi.fn(),
    },
  },
}));

import { PaymentsService } from '../payments.service';
import { prisma } from '../../../lib/prisma';

describe('PaymentsService', () => {
  let service: PaymentsService;

  beforeEach(() => {
    service = new PaymentsService();
    vi.clearAllMocks();
  });

  describe('getPayments', () => {
    it('scopes to every wallet the user owns when no walletId is given', async () => {
      (prisma.payment.findMany as any).mockResolvedValue([]);

      await service.getPayments('user-1');

      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { wallet: { userId: 'user-1' } } }),
      );
    });

    it('scopes to a single wallet, but still requires that wallet belong to the user', async () => {
      (prisma.payment.findMany as any).mockResolvedValue([]);

      await service.getPayments('user-1', 'wallet-9', 10);

      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { walletId: 'wallet-9', wallet: { userId: 'user-1' } },
          take: 10,
        }),
      );
    });
  });

  describe('getPaymentsSummary', () => {
    it('aggregates across all of the user\'s wallets when walletId is omitted', async () => {
      (prisma.payment.aggregate as any).mockResolvedValue({
        _sum: { amount: 42 },
        _count: { id: 3 },
      });

      const summary = await service.getPaymentsSummary('user-1');

      expect(prisma.payment.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { wallet: { userId: 'user-1' } } }),
      );
      expect(summary).toEqual({ totalReceived: 42, paymentCount: 3 });
    });

    it('scopes the aggregate to one wallet owned by the user when walletId is given', async () => {
      (prisma.payment.aggregate as any).mockResolvedValue({ _sum: {}, _count: {} });

      await service.getPaymentsSummary('user-1', 'wallet-9');

      expect(prisma.payment.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { walletId: 'wallet-9', wallet: { userId: 'user-1' } } }),
      );
    });
  });

  describe('getCrossLedgerAnalytics', () => {
    it('calculates combined daily volume, transaction count, and average payment size across Stellar streams', async () => {
      (prisma.payment.findMany as any).mockResolvedValue([
        {
          amount: '100.5',
          receivedAt: new Date('2026-08-30T10:00:00Z'),
        },
        {
          amount: '50.0',
          receivedAt: new Date('2026-08-30T14:00:00Z'),
        },
      ]);

      ((prisma as any).sorobanContractSubscription.findMany as any).mockResolvedValue([
        { contractId: 'C12345' },
      ]);

      ((prisma as any).sorobanEventSnapshot.findMany as any).mockResolvedValue([
        {
          amount: '200.0',
          createdAt: new Date('2026-08-30T11:00:00Z'),
        },
      ]);

      const result = await service.getCrossLedgerAnalytics('user-1');

      expect(result.summary.totalVolume).toBe(350.5);
      expect(result.summary.totalTransactionCount).toBe(3);
      expect(result.summary.averagePaymentSize).toBe(116.8333);

      expect(result.summary.breakdown.classic.volume).toBe(150.5);
      expect(result.summary.breakdown.classic.count).toBe(2);
      expect(result.summary.breakdown.classic.averageSize).toBe(75.25);

      expect(result.summary.breakdown.soroban.volume).toBe(200);
      expect(result.summary.breakdown.soroban.count).toBe(1);
      expect(result.summary.breakdown.soroban.averageSize).toBe(200);

      expect(result.daily).toHaveLength(1);
      expect(result.daily[0]).toEqual({
        date: '2026-08-30',
        totalVolume: 350.5,
        totalCount: 3,
        averagePaymentSize: 116.8333,
        classicVolume: 150.5,
        classicCount: 2,
        sorobanVolume: 200,
        sorobanCount: 1,
      });
    });
  });
});
