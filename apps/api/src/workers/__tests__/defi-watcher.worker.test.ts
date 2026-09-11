import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    dexSwapWatch: { findMany: vi.fn() },
    dexSwapEvent: { findFirst: vi.fn(), create: vi.fn() },
  },
}));

vi.mock('../../lib/soroban', async () => {
  const actual = await vi.importActual<typeof import('../../lib/soroban')>('../../lib/soroban');
  return {
    ...actual,
    fetchContractEvents: vi.fn(),
    getSorobanLatestLedger: vi.fn(),
  };
});

import { prisma } from '../../lib/prisma';
import { fetchContractEvents, getSorobanLatestLedger } from '../../lib/soroban';
import {
  evaluateSwapAgainstThresholds,
  processPoolWatchGroup,
  runDefiWatcherPass,
} from '../defi-watcher.worker';

const swapEvent = {
  contractId: 'CPOOL',
  topic: ['swap'],
  value: {
    token_in: 'CTOKENA',
    token_out: 'CTOKENB',
    amount_in: '10000000',
    amount_out: '9900000',
    price_impact: '3.5',
  },
  ledger: 1000,
  txHash: 'tx-hash-1',
};

describe('evaluateSwapAgainstThresholds', () => {
  it('matches by amount when the swap output clears an unset (any-amount) threshold', () => {
    const swap = { amountOut: '5', priceImpactPct: null } as any;
    const result = evaluateSwapAgainstThresholds(swap, [{ minAmountThreshold: null, minSlippagePercent: null }]);
    expect(result.matchedByAmount).toBe(true);
    expect(result.matchedBySlippage).toBe(false);
  });

  it('matches by amount only when the swap output meets or exceeds the threshold', () => {
    const swap = { amountOut: '100', priceImpactPct: null } as any;
    expect(
      evaluateSwapAgainstThresholds(swap, [{ minAmountThreshold: '100', minSlippagePercent: null }]).matchedByAmount,
    ).toBe(true);
    expect(
      evaluateSwapAgainstThresholds(swap, [{ minAmountThreshold: '101', minSlippagePercent: null }]).matchedByAmount,
    ).toBe(false);
  });

  it('matches by slippage when price impact meets or exceeds the threshold', () => {
    const swap = { amountOut: '1', priceImpactPct: '5.0' } as any;
    expect(
      evaluateSwapAgainstThresholds(swap, [{ minAmountThreshold: '999999', minSlippagePercent: '5.0' }])
        .matchedBySlippage,
    ).toBe(true);
    expect(
      evaluateSwapAgainstThresholds(swap, [{ minAmountThreshold: '999999', minSlippagePercent: '5.1' }])
        .matchedBySlippage,
    ).toBe(false);
  });

  it('does not match by slippage when the swap reports no price impact', () => {
    const swap = { amountOut: '1', priceImpactPct: null } as any;
    expect(
      evaluateSwapAgainstThresholds(swap, [{ minAmountThreshold: '999999', minSlippagePercent: '1' }])
        .matchedBySlippage,
    ).toBe(false);
  });
});

describe('processPoolWatchGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.dexSwapEvent.findFirst as any).mockResolvedValue(null);
    (prisma.dexSwapEvent.create as any).mockResolvedValue({ id: 'event-1' });
  });

  it('stores a new swap event and notifies when it clears a watcher threshold', async () => {
    (fetchContractEvents as any).mockResolvedValue([swapEvent]);
    const notify = vi.fn();

    await processPoolWatchGroup(
      { poolContractId: 'CPOOL', watches: [{ userId: 'user-a', minAmountThreshold: '0.5', minSlippagePercent: null }] },
      2000,
      notify,
    );

    expect(prisma.dexSwapEvent.create).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].poolContractId).toBe('CPOOL');
  });

  it('does not notify when the swap does not clear any watcher threshold', async () => {
    (fetchContractEvents as any).mockResolvedValue([swapEvent]);
    const notify = vi.fn();

    await processPoolWatchGroup(
      {
        poolContractId: 'CPOOL',
        watches: [{ userId: 'user-a', minAmountThreshold: '999999', minSlippagePercent: '99' }],
      },
      2000,
      notify,
    );

    expect(prisma.dexSwapEvent.create).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('skips non-swap events silently', async () => {
    (fetchContractEvents as any).mockResolvedValue([
      { contractId: 'CPOOL', topic: ['transfer'], value: { from: 'GAAA', to: 'GBBB', amount: '1' } },
    ]);
    const notify = vi.fn();

    await processPoolWatchGroup(
      { poolContractId: 'CPOOL', watches: [{ userId: 'user-a', minAmountThreshold: null, minSlippagePercent: null }] },
      2000,
      notify,
    );

    expect(prisma.dexSwapEvent.create).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('treats a unique-constraint violation on create as an already-seen duplicate and continues', async () => {
    (fetchContractEvents as any).mockResolvedValue([swapEvent]);
    (prisma.dexSwapEvent.create as any).mockRejectedValue({ code: 'P2002' });
    const notify = vi.fn();

    await expect(
      processPoolWatchGroup(
        { poolContractId: 'CPOOL', watches: [{ userId: 'user-a', minAmountThreshold: null, minSlippagePercent: null }] },
        2000,
        notify,
      ),
    ).resolves.not.toThrow();

    expect(notify).not.toHaveBeenCalled();
  });

  it('resumes from one ledger past the last stored event for this pool', async () => {
    (prisma.dexSwapEvent.findFirst as any).mockResolvedValue({ ledgerSeq: 1500 });
    (fetchContractEvents as any).mockResolvedValue([]);

    await processPoolWatchGroup(
      { poolContractId: 'CPOOL', watches: [{ userId: 'user-a', minAmountThreshold: null, minSlippagePercent: null }] },
      2000,
      vi.fn(),
    );

    expect(fetchContractEvents).toHaveBeenCalledWith('CPOOL', 1501);
  });

  it('does nothing if the resume ledger is already past the latest known ledger', async () => {
    (prisma.dexSwapEvent.findFirst as any).mockResolvedValue({ ledgerSeq: 2500 });

    await processPoolWatchGroup(
      { poolContractId: 'CPOOL', watches: [{ userId: 'user-a', minAmountThreshold: null, minSlippagePercent: null }] },
      2000,
      vi.fn(),
    );

    expect(fetchContractEvents).not.toHaveBeenCalled();
  });
});

describe('runDefiWatcherPass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.dexSwapEvent.findFirst as any).mockResolvedValue(null);
    (prisma.dexSwapEvent.create as any).mockResolvedValue({ id: 'event-1' });
  });

  it('does nothing when there are no active watches', async () => {
    (prisma.dexSwapWatch.findMany as any).mockResolvedValue([]);

    await runDefiWatcherPass(vi.fn());

    expect(getSorobanLatestLedger).not.toHaveBeenCalled();
  });

  it('groups multiple watches on the same pool into a single fetch pass', async () => {
    (prisma.dexSwapWatch.findMany as any).mockResolvedValue([
      { poolContractId: 'CPOOL', userId: 'user-a', minAmountThreshold: null, minSlippagePercent: null },
      { poolContractId: 'CPOOL', userId: 'user-b', minAmountThreshold: '1000', minSlippagePercent: null },
    ]);
    (getSorobanLatestLedger as any).mockResolvedValue(2000);
    (fetchContractEvents as any).mockResolvedValue([swapEvent]);
    const notify = vi.fn();

    await runDefiWatcherPass(notify);

    expect(fetchContractEvents).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('skips the pass entirely when the latest ledger cannot be fetched', async () => {
    (prisma.dexSwapWatch.findMany as any).mockResolvedValue([
      { poolContractId: 'CPOOL', userId: 'user-a', minAmountThreshold: null, minSlippagePercent: null },
    ]);
    (getSorobanLatestLedger as any).mockResolvedValue(0);

    await runDefiWatcherPass(vi.fn());

    expect(fetchContractEvents).not.toHaveBeenCalled();
  });

  it('continues processing other pools if one throws', async () => {
    (prisma.dexSwapWatch.findMany as any).mockResolvedValue([
      { poolContractId: 'CPOOL-A', userId: 'user-a', minAmountThreshold: null, minSlippagePercent: null },
      { poolContractId: 'CPOOL-B', userId: 'user-b', minAmountThreshold: null, minSlippagePercent: null },
    ]);
    (getSorobanLatestLedger as any).mockResolvedValue(2000);
    (fetchContractEvents as any)
      .mockRejectedValueOnce(new Error('rpc blip'))
      .mockResolvedValueOnce([swapEvent]);
    const notify = vi.fn();

    await runDefiWatcherPass(notify);

    expect(fetchContractEvents).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
