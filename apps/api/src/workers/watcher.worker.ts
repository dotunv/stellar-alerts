import * as StellarSdk from 'stellar-sdk';
import { prisma, connectWithRetry } from '../lib/prisma';
import { stellar, decodeHorizonAsset, parseSacTransferEvent } from '../lib/stellar';
import { enqueuePaymentAlert } from '../lib/queue';
import {
  getSorobanLatestLedger,
  loadContractRegistry,
  getActiveContractIds,
  parseSorobanTransferEvent,
  routeEventToUsers,
} from '../lib/soroban';
import { registerSupervisorHeartbeat } from './supervisor';
import { withWalletLock } from '../lib/lock';
import { shouldAlert, PaymentContext } from '../lib/rules-engine';
import { MemoryMonitor, MemorySnapshot } from '../utils/memory-monitor';
import { nonceAuditManager } from '../utils/nonce-audit';


let memoryMonitor: MemoryMonitor | null = null;

/**
 * Stops the memory monitor and exits the process so WorkerSupervisor
 * respawns it cleanly. process.exit is deferred a turn via setImmediate so
 * the log line above it actually flushes before the process goes down.
 */
export function gracefulRestart(reason: string, snapshot: MemorySnapshot): void {
  console.error(
    `[WatcherWorker] 🔁 Restarting worker: ${reason} (heap usage ${(snapshot.usageRatio * 100).toFixed(1)}%)`,
  );
  memoryMonitor?.stop();
  setImmediate(() => {
    process.exit(1);
  });
}

export function startMemoryMonitor(): MemoryMonitor {
  memoryMonitor = new MemoryMonitor({
    onRestartRequired: (snapshot) => gracefulRestart('memory usage exceeded restart threshold', snapshot),
    onCleanup: (snapshot, gcRan) => {
      console.log(
        `[WatcherWorker] 🧹 Ran memory cleanup pass at ${(snapshot.usageRatio * 100).toFixed(1)}% heap usage (gc ran: ${gcRan})`,
      );
    },
  });
  memoryMonitor.start();
  return memoryMonitor;
}

export async function processPaymentRecord(
  wallet: { id: string; publicKey: string; userId?: string },
  record: any
) {
  let amount: string | undefined;
  let asset: string = "XLM";
  let assetIssuer: string | null = null;
  let fromAddress: string = '';
  let memo: string | null = null;
  const txHash: string = record.transaction_hash || record.hash || '';
  const receivedAt: Date = new Date(record.created_at || Date.now());

  if (record.type === "payment") {
    const decodedAsset = decodeHorizonAsset(record);
    amount = record.amount;
    asset = decodedAsset.assetCode;
    assetIssuer = decodedAsset.assetIssuer;
    fromAddress = record.from || '';
    memo = record.memo || null;
  } else if (record.type === 'create_account') {
    amount = record.starting_balance;
    asset = "XLM";
    assetIssuer = null;
    fromAddress = record.funder || "";
  } else {
    const sacTransfer = parseSacTransferEvent(record);
    if (!sacTransfer) return;

    amount = sacTransfer.amount;
    asset = sacTransfer.assetCode ?? sacTransfer.contractId ?? "Unknown";
    assetIssuer = sacTransfer.assetIssuer;
    fromAddress = sacTransfer.from;
  }

  if (!amount || !txHash) return;

  // Deduplicate check
  const existing = await prisma.payment.findUnique({ where: { txHash } });
  if (!existing) {
    console.log(
      `[WatcherWorker] 💰 New ${record.type} detected for wallet (${wallet.publicKey.substring(
        0,
        8,
      )}...): ${amount} ${asset}`,
    );

    const payment = await prisma.payment.create({
      data: {
        walletId: wallet.id,
        txHash,
        fromAddress,
        amount: Number(amount),
        asset,
        assetIssuer,
        memo,
        receivedAt,
      },
    });

    // Apply filter rules to determine if we should alert
    let shouldSendAlert = true;
    
    if (wallet.userId) {
      const notifyPrefs = await prisma.notificationPreference.findUnique({
        where: { userId: wallet.userId },
      });

      if ((notifyPrefs as any)?.filterRules) {
        const paymentContext: PaymentContext = {
          amount: Number(amount),
          asset,
          fromAddress,
          memo,
        };
        
        shouldSendAlert = shouldAlert((notifyPrefs as any)?.filterRules, paymentContext);
        
        if (!shouldSendAlert) {
          console.log(
            `[WatcherWorker] 🔕 Payment filtered by rules for wallet (${wallet.publicKey.substring(
              0,
              8
            )}...): ${amount} ${asset}`
          );
        }
      }
    }

    // Enqueue off-chain alert dispatch job to BullMQ queue only if rules pass
    if (shouldSendAlert) {
      await enqueuePaymentAlert({
        paymentId: payment.id,
        txHash,
        walletId: wallet.id,
        amount,
        asset,
        assetIssuer,
        fromAddress,
        receivedAt: receivedAt.toISOString(),
      });
    }
  }
}

// Number of operations pulled from Horizon per cursor page
const CURSOR_PAGE_SIZE = 50;

// Upper bound on pages walked in a single catch-up pass, so a long outage
// cannot stall the poll loop indefinitely
const MAX_CATCHUP_PAGES = 20;

export async function saveCursor(walletId: string, pagingToken: string) {
  await prisma.ingestionCursor.upsert({
    where: { walletId },
    create: { walletId, pagingToken },
    update: { pagingToken },
  });
}

/**
 * Returns the persisted paging token for a wallet, creating the cursor record
 * on first sight. A fresh cursor is seeded from the wallet's latest Horizon
 * paging token so that registering a wallet does not replay its whole history.
 */
export async function ensureCursor(wallet: {
  id: string;
  publicKey: string;
}): Promise<string> {
  const existing = await prisma.ingestionCursor.findUnique({
    where: { walletId: wallet.id },
  });
  if (existing) return existing.pagingToken;

  const pagingToken = await stellar.getLatestPagingToken(wallet.publicKey);
  const created = await prisma.ingestionCursor.create({
    data: { walletId: wallet.id, pagingToken },
  });
  console.log(
    `[WatcherWorker] 🔖 Seeded ingestion cursor for wallet ${wallet.publicKey.substring(0, 8)}... at ${pagingToken}`,
  );
  return created.pagingToken;
}

export async function processWalletPayments(wallet: { id: string; publicKey: string; userId?: string }) {
  if (!wallet.publicKey || !StellarSdk.StrKey.isValidEd25519PublicKey(wallet.publicKey)) {
    console.warn(`[WatcherWorker] Skipping invalid public key checksum: "${wallet.publicKey}"`);
    return;
  }

  let cursor = await ensureCursor(wallet);

  for (let page = 0; page < MAX_CATCHUP_PAGES; page++) {
    const records = (await stellar.getPaymentsSince(
      wallet.publicKey,
      cursor,
      CURSOR_PAGE_SIZE,
    )) as any[];
    if (records.length === 0) return;

    for (const record of records) {
      await processPaymentRecord(wallet, record);
      if (record.paging_token) {
        cursor = record.paging_token;
        await saveCursor(wallet.id, cursor);
      }
    }

    if (records.length < CURSOR_PAGE_SIZE) return;
  }

  console.warn(
    `[WatcherWorker] Catch-up page limit reached for ${wallet.publicKey.substring(0, 8)}..., resuming next poll from ${cursor}`,
  );
}

export async function startHorizonSSEStream(wallet: { id: string; publicKey: string; userId?: string }) {
  console.log(`[WatcherWorker] 📡 Opening Multi-Node Horizon SSE payment streams for wallet ${wallet.publicKey.substring(0, 8)}...`);

  let timeoutId: NodeJS.Timeout;
  let closeStream: (() => void) | undefined;

  const resetHeartbeat = () => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      console.warn(`[WatcherStream] ⚠️ Heartbeat timeout for ${wallet.publicKey.substring(0, 8)}... Reconnecting multi-node cluster...`);
      if (closeStream) closeStream();
      startHorizonSSEStream(wallet);
    }, 60000);
  };

  try {
    const cursor = await ensureCursor(wallet);
    resetHeartbeat();

    closeStream = stellar.multiNode.streamPaymentsMultiNode(
      wallet.publicKey,
      cursor,
      async (record: any, nodeUrl: string) => {
        resetHeartbeat();
        console.log(
          `[WatcherStream] ⚡ Live SSE stream message received from ${nodeUrl}: ${record.type}`,
        );
        await processPaymentRecord(wallet, record);
        if (record.paging_token) {
          await saveCursor(wallet.id, record.paging_token);
        }
      },
      (error: any, nodeUrl: string) => {
        console.warn(
          `[WatcherStream] SSE stream error on node ${nodeUrl} for ${wallet.publicKey.substring(0, 8)}...:`,
          error?.message || error,
        );
      }
    );

    const originalClose = closeStream;
    closeStream = () => {
      clearTimeout(timeoutId);
      if (originalClose) originalClose();
    };

    return closeStream;
  } catch (err: any) {
    console.error(`[WatcherStream] Failed to open multi-node SSE stream: ${err.message}`);
    clearTimeout(timeoutId!);
    return null;
  }
}

/**
 * Runs a single payment-catchup + Soroban-event poll cycle. Any error from
 * a wallet/contract fetch (a chaos-injected network fault, a dropped DB
 * connection, Horizon timing out, ...) is caught here rather than left to
 * propagate — this is what keeps a transient upstream fault from becoming
 * an unhandled rejection that crashes the process; the next scheduled poll
 * simply tries again. Exported separately from runWatcher so this exact
 * fault-tolerance behavior is directly unit-testable —
 * see __tests__/chaos.test.ts.
 */
export async function pollOnce(): Promise<void> {
  try {
    const wallets = await prisma.wallet.findMany();
    if (wallets.length === 0) {
      console.log(
        "[WatcherWorker] No wallets registered in DB to watch. Waiting for next poll...",
      );
      return;
    }

    console.log(
      `[WatcherWorker] Checking ${wallets.length} registered wallet(s)...`,
    );
    for (const wallet of wallets) {
      await processWalletPayments({ id: wallet.id, publicKey: wallet.publicKey, userId: wallet.userId });
    }

    // Process multi-contract Soroban events
    const contractIds = getActiveContractIds();
    if (contractIds.length > 0) {
      console.log(
        `[WatcherWorker] Processing ${contractIds.length} Soroban contract subscriptions...`,
      );
      for (const contractId of contractIds) {
        await processSorobanContractEvents(contractId);
      }
    }
  } catch (error) {
    console.error("[WatcherWorker] Polling error:", error);
  }
}

export async function runWatcher() {
  console.log("[WatcherWorker] 🚀 Starting Stellar Testnet Watcher Worker...");

  // Load Soroban contract subscriptions
  await loadContractRegistry();

  // Initial payment catchup run
  await pollOnce();

  // Schedule periodic catchup poll every 30 seconds
  setInterval(pollOnce, 30000);

  // Reload contract registry every 5 minutes
  setInterval(() => {
    loadContractRegistry();
  }, 300000);
}

async function processSorobanContractEvents(contractId: string) {
  try {
    const latestLedger = await getSorobanLatestLedger();
    if (latestLedger === 0) return;

    const lastSnapshot = await prisma.sorobanEventSnapshot.findFirst({
      where: { contractId },
      orderBy: { ledgerSeq: "desc" },
      select: { ledgerSeq: true },
    });

    const startLedger = lastSnapshot
      ? lastSnapshot.ledgerSeq + 1
      : latestLedger - 1000;
    if (startLedger > latestLedger) return;

    const { fetchContractEventsInRange } = await import("../lib/soroban");

    for await (const eventBatch of fetchContractEventsInRange(
      contractId,
      startLedger,
      latestLedger,
    )) {
      for (const event of eventBatch) {
        const parsed = parseSacTransferEvent(event);
        if (!parsed) continue;

        const txHash = event.txHash || event.transactionHash || event.transaction_hash || event.hash || (event as any).id || '';
        const topic = (parsed as any).topic || (Array.isArray(event.topic) ? event.topic[0] : event.topic) || 'transfer';
        const sequence = (parsed as any).ledgerSeq || event.ledgerSeq || event.ledger || event.pagingToken || startLedger;

        // Replay Guard: Audit txHash + topic sequence pair against Redis cache
        const isValidNonce = await nonceAuditManager.validateAndRecordNonce({
          txHash,
          topic,
          sequence,
          contractId,
          details: {
            from: parsed.from,
            to: parsed.to,
            amount: parsed.amount,
          },
        });

        if (!isValidNonce) {
          console.warn(
            `[SorobanRouter] 🛡️ Event replay guard rejected replayed event (topic: ${topic}, txHash: ${txHash}, sequence: ${sequence})`,
          );
          continue;
        }

        const routes = routeEventToUsers(event);


        for (const route of routes) {
          console.log(
            `[SorobanRouter] Event ${route.topic} from ${contractId.substring(0, 8)}... routed to ${route.userIds.length} user(s)`,
          );

          try {
            await prisma.sorobanEventSnapshot.upsert({
              where: {
                contractId_ledgerSeq_from_to_amount: {
                  contractId: parsed.contractId,
                  ledgerSeq: (parsed as any).ledgerSeq || event.ledgerSeq || 0,
                  from: parsed.from,
                  to: parsed.to,
                  amount: parsed.amount,
                },
              },
              create: {
                contractId: parsed.contractId,
                from: parsed.from,
                to: parsed.to,
                amount: parsed.amount,
                ledgerSeq: (parsed as any).ledgerSeq || event.ledgerSeq || 0,
              },
              update: {},
            });
          } catch (err: any) {
            if (err.code !== "P2025") {
              console.warn(
                "[SorobanRouter] Error storing event snapshot:",
                err.message,
              );
            }
          }
        }
      }
    }
  } catch (error: any) {
    console.error(
      `[SorobanRouter] Error processing contract ${contractId}:`,
      error.message,
    );
  }
}

if (require.main === module) {
  registerSupervisorHeartbeat();
  startMemoryMonitor();
  runWatcher();
}
