import { prisma } from '../../lib/prisma';
import { addDifferentialPrivacyNoise } from '../../utils/differential-privacy';
import {
  convertUsdToFiat,
  isSupportedFiatCurrency,
  type SupportedFiatCurrency,
} from '../../lib/exchange-rates';

export class PaymentsService {
  /**
   * Lists payments for `userId`. When `walletId` is given, results are
   * additionally scoped to a wallet owned by that user — a caller can no
   * longer read another user's payments by guessing/reusing a walletId.
   * When omitted (the dashboard's "All Wallets" view), every wallet the
   * user owns is included.
   */
  async getPayments(userId: string, walletId?: string, limit: number = 20) {
    console.log(
      `[PaymentsService] Fetching up to ${limit} payments for user ${userId}${walletId ? ` (wallet ${walletId})` : ' (all wallets)'}`,
    );
    return prisma.payment.findMany({
      where: walletId ? { walletId, wallet: { userId } } : { wallet: { userId } },
      orderBy: { receivedAt: 'desc' },
      take: limit,
    });
  }

  async getPaymentsSummary(userId: string, walletId?: string, fiatCurrency?: string) {
    console.log(
      `[PaymentsService] Fetching summary for user ${userId}${walletId ? ` (wallet ${walletId})` : ' (all wallets)'}`,
    );
    const result = await prisma.payment.aggregate({
      where: walletId ? { walletId, wallet: { userId } } : { wallet: { userId } },
      _sum: { amount: true },
      _count: { id: true },
    });

    const totalReceivedUsd = Number(result._sum.amount || 0);
    const paymentCount = result._count.id || 0;

    const summary: Record<string, unknown> = {
      totalReceived: totalReceivedUsd,
      paymentCount,
    };

    // Fiat conversion when requested
    if (fiatCurrency && isSupportedFiatCurrency(fiatCurrency)) {
      const conversion = await convertUsdToFiat(
        totalReceivedUsd,
        fiatCurrency as SupportedFiatCurrency,
      );
      summary.fiatConversion = {
        currency: conversion.currency,
        convertedTotal: conversion.convertedAmount,
        exchangeRate: conversion.rate,
      };
    }

    return summary;
  }

  /**
   * Fetches public volume statistics protected with Laplace differential privacy noise.
   * Epsilon parameter controls privacy budget (lower epsilon = more privacy/noise).
   */
  async getPublicVolumeStats(epsilon: number = 0.5) {
    console.log(`[PaymentsService] Fetching differentially private public volume stats (epsilon=${epsilon})`);
    const aggregate = await prisma.payment.aggregate({
      _sum: { amount: true },
      _count: { id: true },
    });

    const rawTotalVolume = Number(aggregate._sum.amount || 0);
    const noisyVolume = addDifferentialPrivacyNoise(rawTotalVolume, epsilon, 1.0);

    return {
      rawTotalVolume,
      noisyTotalVolume: noisyVolume,
      totalPayments: aggregate._count.id || 0,
      epsilon,
      anonymized: true,
    };
  }

  /**
   * Cross-Ledger Settlement Analytics aggregator combining Stellar Classic and Soroban streams.
   * Calculates combined daily volume, transaction count, and average payment size.
   */
  async getCrossLedgerAnalytics(userId?: string, walletId?: string) {
    console.log(
      `[PaymentsService] Fetching cross-ledger analytics for user ${userId || 'all'}${walletId ? ` (wallet ${walletId})` : ''}`,
    );

    const paymentsWhere = walletId
      ? { walletId, wallet: { userId } }
      : userId
        ? { wallet: { userId } }
        : {};

    const payments = await prisma.payment.findMany({
      where: paymentsWhere,
      orderBy: { receivedAt: 'asc' },
    });

    let sorobanEvents: Array<{ amount: string; createdAt: Date }> = [];
    if ((prisma as any).sorobanEventSnapshot?.findMany) {
      if (userId) {
        let contractIds: string[] = [];
        if ((prisma as any).sorobanContractSubscription?.findMany) {
          const subs = await (prisma as any).sorobanContractSubscription.findMany({
            where: { userId },
          });
          contractIds = subs.map((s: any) => s.contractId);
        }

        if (contractIds.length > 0) {
          sorobanEvents = await (prisma as any).sorobanEventSnapshot.findMany({
            where: { contractId: { in: contractIds } },
            orderBy: { createdAt: 'asc' },
          });
        } else {
          sorobanEvents = await (prisma as any).sorobanEventSnapshot.findMany({
            orderBy: { createdAt: 'asc' },
          });
        }
      } else {
        sorobanEvents = await (prisma as any).sorobanEventSnapshot.findMany({
          orderBy: { createdAt: 'asc' },
        });
      }
    }

    const dailyMap = new Map<
      string,
      { classicVolume: number; classicCount: number; sorobanVolume: number; sorobanCount: number }
    >();

    for (const p of payments) {
      const dateStr = (p.receivedAt || p.createdAt).toISOString().split('T')[0];
      const amt = Number(p.amount) || 0;
      const current = dailyMap.get(dateStr) || {
        classicVolume: 0,
        classicCount: 0,
        sorobanVolume: 0,
        sorobanCount: 0,
      };
      current.classicVolume += amt;
      current.classicCount += 1;
      dailyMap.set(dateStr, current);
    }

    for (const e of sorobanEvents) {
      const dateStr = e.createdAt.toISOString().split('T')[0];
      const amt = parseFloat(e.amount) || 0;
      const current = dailyMap.get(dateStr) || {
        classicVolume: 0,
        classicCount: 0,
        sorobanVolume: 0,
        sorobanCount: 0,
      };
      current.sorobanVolume += amt;
      current.sorobanCount += 1;
      dailyMap.set(dateStr, current);
    }

    let classicVolumeTotal = 0;
    let classicCountTotal = 0;
    let sorobanVolumeTotal = 0;
    let sorobanCountTotal = 0;

    const daily = Array.from(dailyMap.entries())
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .map(([date, data]) => {
        classicVolumeTotal += data.classicVolume;
        classicCountTotal += data.classicCount;
        sorobanVolumeTotal += data.sorobanVolume;
        sorobanCountTotal += data.sorobanCount;

        const totalVol = data.classicVolume + data.sorobanVolume;
        const totalCnt = data.classicCount + data.sorobanCount;
        const avgSize = totalCnt > 0 ? totalVol / totalCnt : 0;

        return {
          date,
          totalVolume: Number(totalVol.toFixed(4)),
          totalCount: totalCnt,
          averagePaymentSize: Number(avgSize.toFixed(4)),
          classicVolume: Number(data.classicVolume.toFixed(4)),
          classicCount: data.classicCount,
          sorobanVolume: Number(data.sorobanVolume.toFixed(4)),
          sorobanCount: data.sorobanCount,
        };
      });

    const totalVolume = classicVolumeTotal + sorobanVolumeTotal;
    const totalTransactionCount = classicCountTotal + sorobanCountTotal;
    const averagePaymentSize =
      totalTransactionCount > 0 ? totalVolume / totalTransactionCount : 0;

    const summary = {
      totalVolume: Number(totalVolume.toFixed(4)),
      totalTransactionCount,
      averagePaymentSize: Number(averagePaymentSize.toFixed(4)),
      breakdown: {
        classic: {
          volume: Number(classicVolumeTotal.toFixed(4)),
          count: classicCountTotal,
          averageSize:
            classicCountTotal > 0
              ? Number((classicVolumeTotal / classicCountTotal).toFixed(4))
              : 0,
        },
        soroban: {
          volume: Number(sorobanVolumeTotal.toFixed(4)),
          count: sorobanCountTotal,
          averageSize:
            sorobanCountTotal > 0
              ? Number((sorobanVolumeTotal / sorobanCountTotal).toFixed(4))
              : 0,
        },
      },
    };

    return { summary, daily };
  }
}

export const paymentsService = new PaymentsService();
