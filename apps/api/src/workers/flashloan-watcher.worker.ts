import { prisma } from '../lib/prisma';
import {
  fetchContractEvents,
  flashLoanDetector,
  getSorobanLatestLedger,
  parseFlashLoanOperationFromEvent,
  ParsedFlashLoanAlert,
} from '../lib/soroban';
import { registerSupervisorHeartbeat } from './supervisor';

const POLL_INTERVAL_MS = 30000;
const DEFAULT_LOOKBACK_LEDGERS = 100;

export interface FlashLoanAlertPayload extends ParsedFlashLoanAlert {
  protocolContractId: string;
}

export type FlashLoanNotifier = (payload: FlashLoanAlertPayload) => Promise<void> | void;

export const defaultFlashLoanNotifier: FlashLoanNotifier = (payload) => {
  console.log(
    `[FlashLoanWatcher] ⚡ Flash loan on ${payload.protocolContractId.slice(0, 8)}... ` +
      `borrowed ${payload.borrowedAmount} ${payload.borrowedAsset.slice(0, 8)} ` +
      `(fee ${payload.feeAmount}, profit ${payload.netArbitrageProfit}) tx=${payload.txHash.slice(0, 10)}...`,
  );
};

function groupEventsByTransaction(events: any[]): Map<string, any[]> {
  const grouped = new Map<string, any[]>();

  for (const event of events) {
    const txHash = event.txHash || event.transactionHash;
    if (!txHash) continue;

    if (!grouped.has(txHash)) {
      grouped.set(txHash, []);
    }
    grouped.get(txHash)!.push(event);
  }

  return grouped;
}

export function getFlashLoanContractIds(): string[] {
  const fromEnv = (process.env.FLASH_LOAN_CONTRACT_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  return Array.from(new Set(fromEnv));
}

/**
 * Parses and detects flash-loan sequences from a batch of Soroban events.
 */
export function detectFlashLoansFromEventBatch(
  events: any[],
  protocolContractId: string,
): FlashLoanAlertPayload[] {
  const alerts: FlashLoanAlertPayload[] = [];

  for (const [txHash, txEvents] of groupEventsByTransaction(events).entries()) {
    const ledgerSeq = txEvents[0]?.ledgerSeq || txEvents[0]?.ledger;
    const detected = flashLoanDetector.detectFromEvents(txEvents, txHash, ledgerSeq);
    if (!detected) continue;

    alerts.push({
      ...detected,
      protocolContractId,
    });
  }

  return alerts;
}

export async function processFlashLoanContract(
  contractId: string,
  latestLedger: number,
  notify: FlashLoanNotifier = defaultFlashLoanNotifier,
) {
  const lastSnapshot = await prisma.sorobanEventSnapshot.findFirst({
    where: { contractId, eventType: 'flash_loan' },
    orderBy: { ledgerSeq: 'desc' },
    select: { ledgerSeq: true },
  });

  const startLedger = lastSnapshot
    ? lastSnapshot.ledgerSeq + 1
    : Math.max(1, latestLedger - DEFAULT_LOOKBACK_LEDGERS);

  if (startLedger > latestLedger) return;

  const events = await fetchContractEvents(contractId, startLedger);
  const alerts = detectFlashLoansFromEventBatch(events, contractId);

  for (const alert of alerts) {
    const ledgerSeq = alert.ledgerSeq ?? startLedger;

    try {
      await prisma.sorobanEventSnapshot.create({
        data: {
          contractId,
          from: alert.borrowedAsset,
          to: alert.txHash,
          amount: alert.borrowedAmount,
          ledgerSeq,
          eventType: 'flash_loan',
          txHash: alert.txHash,
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') continue;
      console.error(
        `[FlashLoanWatcher] Failed to persist flash-loan snapshot for ${contractId}:`,
        error?.message || error,
      );
      continue;
    }

    await notify(alert);
  }
}

export async function runFlashLoanWatcherPass(
  notify: FlashLoanNotifier = defaultFlashLoanNotifier,
) {
  const contractIds = getFlashLoanContractIds();
  if (contractIds.length === 0) {
    const subscriptions = await prisma.sorobanContractSubscription.findMany({
      where: {
        isActive: true,
        topic: { in: ['flash_loan', 'borrow', 'flashloan'] },
      },
      select: { contractId: true },
    });

    for (const subscription of subscriptions) {
      if (!contractIds.includes(subscription.contractId)) {
        contractIds.push(subscription.contractId);
      }
    }
  }

  if (contractIds.length === 0) return;

  const latestLedger = await getSorobanLatestLedger();
  if (latestLedger === 0) {
    console.warn('[FlashLoanWatcher] Could not fetch latest Soroban ledger this pass, skipping');
    return;
  }

  for (const contractId of contractIds) {
    try {
      await processFlashLoanContract(contractId, latestLedger, notify);
    } catch (error: any) {
      console.error(
        `[FlashLoanWatcher] Failed to process contract ${contractId}:`,
        error?.message || error,
      );
    }
  }
}

export async function runFlashLoanWatcher() {
  console.log('[FlashLoanWatcher] 🚀 Starting Soroban Flash Loan & Arbitrage Alert Dispatcher...');

  const poll = async () => {
    try {
      await runFlashLoanWatcherPass();
    } catch (error: any) {
      console.error('[FlashLoanWatcher] Polling error:', error?.message || error);
    }
  };

  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

export { parseFlashLoanOperationFromEvent };

if (require.main === module) {
  registerSupervisorHeartbeat();
  runFlashLoanWatcher();
}
