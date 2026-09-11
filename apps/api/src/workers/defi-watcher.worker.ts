import { prisma } from '../lib/prisma';
import { fetchContractEvents, getSorobanLatestLedger, parseSwapEvent, ParsedSorobanSwap } from '../lib/soroban';
import { registerSupervisorHeartbeat } from './supervisor';

// How often the watcher polls tracked DEX pools for new swap events.
const POLL_INTERVAL_MS = 30000;
// How many ledgers back to look on the very first pass for a pool with no
// prior cursor — keeps a freshly-added watch from trying to backfill from
// ledger 1.
const DEFAULT_LOOKBACK_LEDGERS = 100;

export interface DexSwapAlert {
  poolContractId: string;
  swap: ParsedSorobanSwap;
  ledgerSeq: number;
  matchedByAmount: boolean;
  matchedBySlippage: boolean;
}

/** Pluggable so tests (and future channel wiring) don't have to touch real notification infra. */
export type DexSwapNotifier = (payload: DexSwapAlert) => Promise<void> | void;

export const defaultDexSwapNotifier: DexSwapNotifier = (payload) => {
  console.log(
    `[DefiWatcher] 🔔 Swap on pool ${payload.poolContractId.slice(0, 8)}...: ` +
      `${payload.swap.amountIn} ${payload.swap.tokenIn.slice(0, 6)} -> ${payload.swap.amountOut} ${payload.swap.tokenOut.slice(0, 6)}` +
      (payload.swap.priceImpactPct ? ` (impact ${payload.swap.priceImpactPct}%)` : ''),
  );
};

interface PoolWatchGroup {
  poolContractId: string;
  watches: { userId: string; minAmountThreshold: string | null; minSlippagePercent: string | null }[];
}

/**
 * Decides whether a parsed swap crosses at least one watcher's alert
 * threshold for this pool. A pool can have several watchers with different
 * thresholds; the swap is alerted once per pool if it clears *any* of them
 * (per-user filtering/dispatch is left to the alert/notification layer that
 * consumes `DexSwapAlert`, same separation of concerns as the payment
 * watcher's rules-engine step).
 */
export function evaluateSwapAgainstThresholds(
  swap: ParsedSorobanSwap,
  watches: { minAmountThreshold: string | null; minSlippagePercent: string | null }[],
): { matchedByAmount: boolean; matchedBySlippage: boolean } {
  const amountOut = Number(swap.amountOut);
  const slippage = swap.priceImpactPct !== null ? Number(swap.priceImpactPct) : null;

  let matchedByAmount = false;
  let matchedBySlippage = false;

  for (const watch of watches) {
    if (watch.minAmountThreshold === null || watch.minAmountThreshold === undefined) {
      matchedByAmount = true;
    } else if (!Number.isNaN(amountOut) && amountOut >= Number(watch.minAmountThreshold)) {
      matchedByAmount = true;
    }

    if (
      slippage !== null &&
      watch.minSlippagePercent !== null &&
      watch.minSlippagePercent !== undefined &&
      !Number.isNaN(slippage) &&
      slippage >= Number(watch.minSlippagePercent)
    ) {
      matchedBySlippage = true;
    }
  }

  return { matchedByAmount, matchedBySlippage };
}

/**
 * Fetches and dedupe-stores new swap events for a single tracked pool since
 * its last-seen ledger, notifying once per swap that clears a watcher's
 * threshold. Free of any polling/timer concerns so it can be unit tested
 * directly against fixture data.
 */
export async function processPoolWatchGroup(
  group: PoolWatchGroup,
  latestLedger: number,
  notify: DexSwapNotifier = defaultDexSwapNotifier,
) {
  const lastEvent = await prisma.dexSwapEvent.findFirst({
    where: { poolContractId: group.poolContractId },
    orderBy: { ledgerSeq: 'desc' },
    select: { ledgerSeq: true },
  });

  const startLedger = lastEvent ? lastEvent.ledgerSeq + 1 : Math.max(1, latestLedger - DEFAULT_LOOKBACK_LEDGERS);
  if (startLedger > latestLedger) return;

  const events = await fetchContractEvents(group.poolContractId, startLedger);

  for (const rawEvent of events) {
    const swap = parseSwapEvent(rawEvent);
    if (!swap) continue;

    const ledgerSeq = swap.ledgerSeq ?? startLedger;

    try {
      await prisma.dexSwapEvent.create({
        data: {
          poolContractId: group.poolContractId,
          ledgerSeq,
          txHash: swap.txHash ?? null,
          tokenInAddress: swap.tokenIn,
          tokenOutAddress: swap.tokenOut,
          amountIn: swap.amountIn,
          amountOut: swap.amountOut,
          priceImpactPct: swap.priceImpactPct,
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') continue; // already-seen swap, skip
      console.error(`[DefiWatcher] Error storing swap event for ${group.poolContractId}:`, error?.message || error);
      continue;
    }

    const { matchedByAmount, matchedBySlippage } = evaluateSwapAgainstThresholds(swap, group.watches);
    if (matchedByAmount || matchedBySlippage) {
      await notify({ poolContractId: group.poolContractId, swap, ledgerSeq, matchedByAmount, matchedBySlippage });
    }
  }
}

/** One poll pass over every actively-watched DEX pool. */
export async function runDefiWatcherPass(notify: DexSwapNotifier = defaultDexSwapNotifier) {
  const activeWatches = await prisma.dexSwapWatch.findMany({ where: { isActive: true } });
  if (activeWatches.length === 0) return;

  const grouped = new Map<string, PoolWatchGroup>();
  for (const watch of activeWatches) {
    if (!grouped.has(watch.poolContractId)) {
      grouped.set(watch.poolContractId, { poolContractId: watch.poolContractId, watches: [] });
    }
    grouped.get(watch.poolContractId)!.watches.push({
      userId: watch.userId,
      minAmountThreshold: watch.minAmountThreshold,
      minSlippagePercent: watch.minSlippagePercent,
    });
  }

  const latestLedger = await getSorobanLatestLedger();
  if (latestLedger === 0) {
    console.warn('[DefiWatcher] Could not fetch latest Soroban ledger this pass, skipping');
    return;
  }

  for (const group of grouped.values()) {
    try {
      await processPoolWatchGroup(group, latestLedger, notify);
    } catch (error: any) {
      console.error(`[DefiWatcher] Failed to process pool ${group.poolContractId}:`, error?.message || error);
    }
  }
}

export async function runDefiWatcher() {
  console.log('[DefiWatcher] 🚀 Starting Soroban Liquidity Pool Swap & Arbitrage Trade Alert Detector...');

  const poll = async () => {
    try {
      await runDefiWatcherPass();
    } catch (error: any) {
      console.error('[DefiWatcher] Polling error:', error?.message || error);
    }
  };

  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

if (require.main === module) {
  registerSupervisorHeartbeat();
  runDefiWatcher();
}
