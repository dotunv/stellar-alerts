import { prisma } from '../lib/prisma';
import {
  fetchContractEvents,
  getSorobanLatestLedger,
  parseStakingRewardEvent,
  ParsedStakingRewardEvent,
  stakingRewardTracker,
  StakingRewardTracker,
} from '../lib/soroban';
import { registerSupervisorHeartbeat } from './supervisor';

const POLL_INTERVAL_MS = 30000;
const DEFAULT_LOOKBACK_LEDGERS = 100;

export interface StakingRewardNotificationCard {
  cardType: 'yield_distribution_notification';
  account: string;
  poolContractId: string;
  rewardToken: string;
  distributionAmount: string;
  cumulativeYield: string;
  epoch?: number;
  ledgerSeq: number;
  txHash?: string;
  timestamp: string;
}

export type StakingRewardNotifier = (payload: StakingRewardNotificationCard) => Promise<void> | void;

export const defaultStakingRewardNotifier: StakingRewardNotifier = (payload) => {
  console.log(
    `[StakingRewardWorker] 🌾 Yield Distribution Card: account=${payload.account.slice(0, 8)}... ` +
      `reward=${payload.distributionAmount} ${payload.rewardToken.slice(0, 6)} ` +
      `(cumulative: ${payload.cumulativeYield}) pool=${payload.poolContractId.slice(0, 8)}... ` +
      `epoch=${payload.epoch ?? 'N/A'} tx=${payload.txHash ? payload.txHash.slice(0, 10) : 'N/A'}`,
  );
};

export function getStakingRewardContractIds(): string[] {
  const fromEnv = (process.env.STAKING_REWARD_CONTRACT_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  return Array.from(new Set(fromEnv));
}

export async function processStakingRewardContract(
  contractId: string,
  latestLedger: number,
  tracker: StakingRewardTracker = stakingRewardTracker,
  notify: StakingRewardNotifier = defaultStakingRewardNotifier,
) {
  const lastSnapshot = await prisma.sorobanEventSnapshot.findFirst({
    where: { contractId, eventType: 'staking_reward' },
    orderBy: { ledgerSeq: 'desc' },
    select: { ledgerSeq: true },
  });

  const startLedger = lastSnapshot
    ? lastSnapshot.ledgerSeq + 1
    : Math.max(1, latestLedger - DEFAULT_LOOKBACK_LEDGERS);

  if (startLedger > latestLedger) return;

  const events = await fetchContractEvents(contractId, startLedger);
  const processedBatch = tracker.processEventBatch(events);

  for (const { event, poolCumulativeAmount } of processedBatch) {
    const ledgerSeq = event.ledgerSeq ?? startLedger;

    try {
      await prisma.sorobanEventSnapshot.create({
        data: {
          contractId,
          from: event.account,
          to: event.poolContractId,
          amount: event.amount,
          ledgerSeq,
          eventType: 'staking_reward',
          txHash: event.txHash ?? null,
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') continue; // Skip duplicate events already stored
      console.error(
        `[StakingRewardWorker] Failed to persist reward snapshot for ${contractId}:`,
        error?.message || error,
      );
      continue;
    }

    const card: StakingRewardNotificationCard = {
      cardType: 'yield_distribution_notification',
      account: event.account,
      poolContractId: event.poolContractId,
      rewardToken: event.rewardToken,
      distributionAmount: event.amount,
      cumulativeYield: poolCumulativeAmount,
      epoch: event.epoch,
      ledgerSeq,
      txHash: event.txHash,
      timestamp: new Date().toISOString(),
    };

    await notify(card);
  }
}

export async function runStakingRewardWorkerPass(
  tracker: StakingRewardTracker = stakingRewardTracker,
  notify: StakingRewardNotifier = defaultStakingRewardNotifier,
) {
  let contractIds = getStakingRewardContractIds();

  if (contractIds.length === 0) {
    const subscriptions = await prisma.sorobanContractSubscription.findMany({
      where: {
        isActive: true,
        topic: { in: ['distribute', 'reward', 'claim', 'yield', 'stake_reward', 'yield_distribution'] },
      },
      select: { contractId: true },
    });

    for (const sub of subscriptions) {
      if (!contractIds.includes(sub.contractId)) {
        contractIds.push(sub.contractId);
      }
    }
  }

  if (contractIds.length === 0) return;

  const latestLedger = await getSorobanLatestLedger();
  if (latestLedger === 0) {
    console.warn('[StakingRewardWorker] Could not fetch latest Soroban ledger this pass, skipping');
    return;
  }

  for (const contractId of contractIds) {
    try {
      await processStakingRewardContract(contractId, latestLedger, tracker, notify);
    } catch (error: any) {
      console.error(
        `[StakingRewardWorker] Error processing contract ${contractId}:`,
        error?.message || error,
      );
    }
  }
}

export async function runStakingRewardWorker() {
  console.log('[StakingRewardWorker] 🚀 Starting Soroban SAC Token Staking & LP Reward Distribution Tracker...');

  const poll = async () => {
    try {
      await runStakingRewardWorkerPass();
    } catch (error: any) {
      console.error('[StakingRewardWorker] Polling error:', error?.message || error);
    }
  };

  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

if (require.main === module) {
  registerSupervisorHeartbeat();
  runStakingRewardWorker();
}
