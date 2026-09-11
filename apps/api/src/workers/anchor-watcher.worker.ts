import { prisma } from '../lib/prisma';
import { fetchAnchorTransactionStatus, isTerminalAnchorStatus, AnchorProtocol } from '../lib/anchor';
import { registerSupervisorHeartbeat } from './supervisor';

// How often the watcher re-checks tracked anchor transactions for a status change.
const POLL_INTERVAL_MS = 30000;

export interface AnchorStatusChanged {
  watchId: string;
  userId: string;
  anchorEndpoint: string;
  anchorTxId: string;
  protocol: AnchorProtocol;
  previousStatus: string | null;
  newStatus: string;
  amountIn?: string | null;
  amountOut?: string | null;
  moreInfoUrl?: string | null;
}

/** Pluggable so tests (and future channel wiring) don't have to touch real notification infra. */
export type AnchorNotifier = (payload: AnchorStatusChanged) => Promise<void> | void;

export const defaultAnchorNotifier: AnchorNotifier = (payload) => {
  console.log(
    `[AnchorWatcher] 🔔 Transaction ${payload.anchorTxId} on ${payload.anchorEndpoint} moved ` +
      `${payload.previousStatus ?? '(new)'} -> ${payload.newStatus}`,
  );
};

interface AnchorWatchRecord {
  id: string;
  userId: string;
  anchorEndpoint: string;
  anchorTxId: string;
  protocol: string;
  lastKnownStatus: string | null;
}

/**
 * Checks a single tracked anchor transaction against the anchor's transfer
 * server, and — if its status has moved since the last pass — persists the
 * new status and fires the notifier. Free of any polling/timer concerns so
 * it can be unit tested directly against fixture data.
 *
 * Returns the freshly fetched status, or null if the anchor could not be
 * reached this pass (the watch is left untouched so the next pass retries).
 */
export async function processAnchorWatch(
  watch: AnchorWatchRecord,
  notify: AnchorNotifier = defaultAnchorNotifier,
  authToken?: string,
) {
  const protocol = watch.protocol as AnchorProtocol;
  const status = await fetchAnchorTransactionStatus(protocol, watch.anchorEndpoint, watch.anchorTxId, authToken);

  if (!status) {
    return null;
  }

  if (status.status === watch.lastKnownStatus) {
    return status;
  }

  await prisma.anchorTransactionWatch.update({
    where: { id: watch.id },
    data: { lastKnownStatus: status.status },
  });

  await notify({
    watchId: watch.id,
    userId: watch.userId,
    anchorEndpoint: watch.anchorEndpoint,
    anchorTxId: watch.anchorTxId,
    protocol,
    previousStatus: watch.lastKnownStatus,
    newStatus: status.status,
    amountIn: status.amountIn,
    amountOut: status.amountOut,
    moreInfoUrl: status.moreInfoUrl,
  });

  return status;
}

/**
 * One poll pass over every tracked anchor transaction that hasn't already
 * reached a terminal state. Terminal transactions (completed/refunded/
 * expired/error) are skipped entirely so a long-lived watch table doesn't
 * keep hammering anchors for transactions that will never change again.
 */
export async function runAnchorWatcherPass(notify: AnchorNotifier = defaultAnchorNotifier) {
  const watches = await prisma.anchorTransactionWatch.findMany();

  const authToken = process.env.ANCHOR_SEP31_AUTH_TOKEN;

  for (const watch of watches) {
    if (watch.lastKnownStatus && isTerminalAnchorStatus(watch.protocol as AnchorProtocol, watch.lastKnownStatus)) {
      continue;
    }

    try {
      await processAnchorWatch(watch, notify, authToken);
    } catch (error: any) {
      console.error(`[AnchorWatcher] Failed to process watch ${watch.id}:`, error?.message || error);
    }
  }
}

export async function runAnchorWatcher() {
  console.log('[AnchorWatcher] 🚀 Starting Stellar Anchor Protocol (SEP-24/SEP-31) Ingestion Watcher...');

  const poll = async () => {
    try {
      await runAnchorWatcherPass();
    } catch (error: any) {
      console.error('[AnchorWatcher] Polling error:', error?.message || error);
    }
  };

  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

if (require.main === module) {
  registerSupervisorHeartbeat();
  runAnchorWatcher();
}
