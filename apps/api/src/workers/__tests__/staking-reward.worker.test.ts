import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    sorobanEventSnapshot: { findFirst: vi.fn(), create: vi.fn() },
    sorobanContractSubscription: { findMany: vi.fn() },
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
import { fetchContractEvents, getSorobanLatestLedger, StakingRewardTracker } from '../../lib/soroban';
import {
  processStakingRewardContract,
  runStakingRewardWorkerPass,
  getStakingRewardContractIds,
  StakingRewardNotificationCard,
} from '../staking-reward.worker';

const mockRewardEvent = {
  contractId: 'CSTAKINGPOOL1',
  topic: ['distribute'],
  value: {
    account: 'GUSERSTAKER123',
    reward_token: 'CREWARDTOKEN1',
    pool_contract_id: 'CSTAKINGPOOL1',
    amount: '1000000000', // 100.0
    epoch: 12,
  },
  ledger: 8888,
  txHash: 'tx-yield-dist-1',
};

describe('StakingRewardWorker (#212)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.sorobanEventSnapshot.findFirst as any).mockResolvedValue(null);
    (prisma.sorobanEventSnapshot.create as any).mockResolvedValue({ id: 'snapshot-1' });
  });

  it('processes reward events, persists snapshot, and dispatches yield distribution notification cards', async () => {
    (fetchContractEvents as any).mockResolvedValue([mockRewardEvent]);
    const notify = vi.fn();
    const tracker = new StakingRewardTracker();

    await processStakingRewardContract('CSTAKINGPOOL1', 9000, tracker, notify);

    expect(prisma.sorobanEventSnapshot.create).toHaveBeenCalledTimes(1);
    expect(prisma.sorobanEventSnapshot.create).toHaveBeenCalledWith({
      data: {
        contractId: 'CSTAKINGPOOL1',
        from: 'GUSERSTAKER123',
        to: 'CSTAKINGPOOL1',
        amount: '100',
        ledgerSeq: 8888,
        eventType: 'staking_reward',
        txHash: 'tx-yield-dist-1',
      },
    });

    expect(notify).toHaveBeenCalledTimes(1);
    const card: StakingRewardNotificationCard = notify.mock.calls[0][0];
    expect(card.cardType).toBe('yield_distribution_notification');
    expect(card.account).toBe('GUSERSTAKER123');
    expect(card.poolContractId).toBe('CSTAKINGPOOL1');
    expect(card.rewardToken).toBe('CREWARDTOKEN1');
    expect(card.distributionAmount).toBe('100');
    expect(card.cumulativeYield).toBe('100');
    expect(card.epoch).toBe(12);
    expect(card.txHash).toBe('tx-yield-dist-1');
  });

  it('ignores duplicate events gracefully when unique constraint fails (P2002)', async () => {
    (fetchContractEvents as any).mockResolvedValue([mockRewardEvent]);
    (prisma.sorobanEventSnapshot.create as any).mockRejectedValue({ code: 'P2002' });
    const notify = vi.fn();
    const tracker = new StakingRewardTracker();

    await expect(
      processStakingRewardContract('CSTAKINGPOOL1', 9000, tracker, notify),
    ).resolves.not.toThrow();

    expect(notify).not.toHaveBeenCalled();
  });

  it('runs worker pass over subscribed staking contracts and dispatches real-time yield cards', async () => {
    (prisma.sorobanContractSubscription.findMany as any).mockResolvedValue([
      { contractId: 'CSTAKINGPOOL1' },
    ]);
    (getSorobanLatestLedger as any).mockResolvedValue(9000);
    (fetchContractEvents as any).mockResolvedValue([mockRewardEvent]);
    const notify = vi.fn();
    const tracker = new StakingRewardTracker();

    await runStakingRewardWorkerPass(tracker, notify);

    expect(fetchContractEvents).toHaveBeenCalledWith('CSTAKINGPOOL1', expect.any(Number));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('extracts contract IDs from STAKING_REWARD_CONTRACT_IDS env variable if provided', () => {
    process.env.STAKING_REWARD_CONTRACT_IDS = ' CPOOL1 , CPOOL2 ';
    const ids = getStakingRewardContractIds();
    expect(ids).toEqual(['CPOOL1', 'CPOOL2']);
    delete process.env.STAKING_REWARD_CONTRACT_IDS;
  });
});
