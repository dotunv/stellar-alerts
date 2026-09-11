import * as StellarSdk from 'stellar-sdk';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import {
  sorobanServer,
  getContractInstanceLedgerKey,
  getWasmHashFromContractInstance,
  getRemainingTtl,
  shouldRenew,
} from '../lib/soroban';
import { registerSupervisorHeartbeat } from './supervisor';

// Configuration
const POLL_INTERVAL_MS = parseInt(env.SOROBAN_RENT_WORKER_INTERVAL_MS || '60000', 10);
const RENEWAL_THRESHOLD = parseInt(env.SOROBAN_RENT_RENEWAL_THRESHOLD || '5000', 10);
const TARGET_TTL = parseInt(env.SOROBAN_RENT_TARGET_TTL || '10000', 10);
const SECRET_KEY = env.SOROBAN_RENT_WORKER_SECRET;
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE || StellarSdk.Networks.TESTNET;

let isProcessing = false;

/**
 * Checks rent status for a single contract, and extends TTL if below threshold.
 */
export async function processContractRent(
  contractId: string,
  latestLedger: number,
  threshold: number = RENEWAL_THRESHOLD,
  targetTtl: number = TARGET_TTL,
  secretKey: string | undefined = SECRET_KEY,
) {
  console.log(`[SorobanRentWorker] Checking rent status for contract: ${contractId}`);

  const instanceLedgerKey = getContractInstanceLedgerKey(contractId);
  const response = await sorobanServer.getLedgerEntries(instanceLedgerKey);

  if (!response || !response.entries || response.entries.length === 0) {
    console.warn(`[SorobanRentWorker] ⚠️ Contract instance entry not found for ${contractId}. Skipping.`);
    return;
  }

  const instanceEntry = response.entries[0];
  const instanceLiveUntil = instanceEntry.liveUntilLedgerSeq ?? 0;
  const instanceTtl = getRemainingTtl(instanceLiveUntil, latestLedger);

  let codeTtl: number | undefined;
  let codeLedgerKey: StellarSdk.xdr.LedgerKey | undefined;

  const wasmHash = getWasmHashFromContractInstance(instanceEntry.val);
  if (wasmHash) {
    console.log(`[SorobanRentWorker] WASM contract detected for ${contractId}. Hash: ${wasmHash.toString('hex')}`);
    codeLedgerKey = StellarSdk.xdr.LedgerKey.contractCode(
      new StellarSdk.xdr.LedgerKeyContractCode({ hash: wasmHash }),
    );
    const codeResponse = await sorobanServer.getLedgerEntries(codeLedgerKey);
    if (codeResponse && codeResponse.entries && codeResponse.entries.length > 0) {
      const codeEntry = codeResponse.entries[0];
      const codeLiveUntil = codeEntry.liveUntilLedgerSeq ?? 0;
      codeTtl = getRemainingTtl(codeLiveUntil, latestLedger);
    } else {
      console.warn(
        `[SorobanRentWorker] ⚠️ Contract code entry not found for ${contractId} with WASM hash ${wasmHash.toString(
          'hex',
        )}. Skipping code TTL check.`,
      );
    }
  }

  const keysToExtend: StellarSdk.xdr.LedgerKey[] = [];
  if (shouldRenew(instanceTtl, threshold)) {
    keysToExtend.push(instanceLedgerKey);
  }
  if (codeTtl !== undefined && codeLedgerKey && shouldRenew(codeTtl, threshold)) {
    keysToExtend.push(codeLedgerKey);
  }

  if (keysToExtend.length === 0) {
    console.log(
      `[SorobanRentWorker] ✅ Contract ${contractId} is safely above threshold (Instance TTL: ${instanceTtl}, Code TTL: ${
        codeTtl ?? 'N/A'
      }). No renewal needed.`,
    );
    return;
  }

  console.log(
    `[SorobanRentWorker] 🚨 Contract ${contractId} is below threshold. Instance TTL: ${instanceTtl}, Code TTL: ${
      codeTtl ?? 'N/A'
    }. Preparing renewal transaction.`,
  );

  if (!secretKey) {
    console.warn(
      `[SorobanRentWorker] ⚠️ Renewal required for contract ${contractId}, but SOROBAN_RENT_WORKER_SECRET is not configured. Skipping transaction submission.`,
    );
    return;
  }

  const workerKeypair = StellarSdk.Keypair.fromSecret(secretKey);
  const workerPublicKey = workerKeypair.publicKey();

  // Load fee-payer account sequence number
  const feePayerAccount = await sorobanServer.getAccount(workerPublicKey);

  // Construct absolute target ledger
  const targetLedger = latestLedger + targetTtl;

  const initialSorobanData = new StellarSdk.SorobanDataBuilder()
    .setReadOnly(keysToExtend)
    .build();

  const tx = new StellarSdk.TransactionBuilder(feePayerAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.extendFootprintTtl({
        extendTo: targetLedger,
      }),
    )
    .setSorobanData(initialSorobanData)
    .setTimeout(StellarSdk.TimeoutInfinite)
    .build();

  // Simulate
  console.log(`[SorobanRentWorker] Simulating rent renewal transaction for contract ${contractId}...`);
  const simResult = await sorobanServer.simulateTransaction(tx);

  if (!StellarSdk.rpc.Api.isSimulationSuccess(simResult)) {
    console.error(`[SorobanRentWorker] ❌ Simulation failed for contract ${contractId}:`, simResult.error);
    return;
  }

  // Assemble using simulation results
  const assembledTx = StellarSdk.rpc.assembleTransaction(tx, simResult).build();

  // Sign
  assembledTx.sign(workerKeypair);

  // Submit
  console.log(`[SorobanRentWorker] Submitting rent renewal transaction for contract ${contractId}...`);
  const sendResponse = await sorobanServer.sendTransaction(assembledTx);

  if (sendResponse.status === 'ERROR') {
    console.error(
      `[SorobanRentWorker] ❌ Submission rejected for contract ${contractId}: status ERROR. Result XDR: ${sendResponse.errorResultXdr}`,
    );
    return;
  }

  if (sendResponse.status === 'PENDING') {
    console.log(`[SorobanRentWorker] Transaction pending. Polling status for tx: ${sendResponse.hash}`);
    const pollResult = await sorobanServer.pollTransaction(sendResponse.hash);

    if (pollResult.status === 'SUCCESS') {
      console.log(`[SorobanRentWorker] 🎉 Successfully renewed rent for contract ${contractId}. Tx: ${sendResponse.hash}`);
    } else {
      console.error(
        `[SorobanRentWorker] ❌ Rent renewal transaction failed in polling. Status: ${pollResult.status}. Tx: ${sendResponse.hash}`,
      );
    }
  } else {
    console.warn(`[SorobanRentWorker] Submission status for contract ${contractId}: ${sendResponse.status}`);
  }
}

/**
 * One poll pass over every active Soroban contract subscription.
 */
export async function runRentRenewalPass() {
  console.log('[SorobanRentWorker] Starting Soroban rent renewal pass...');

  // Fetch active contract subscriptions from database
  const subscriptions = await prisma.sorobanContractSubscription.findMany({
    where: { isActive: true },
    select: { contractId: true },
  });

  const activeContractIds = Array.from(new Set(subscriptions.map((s) => s.contractId)));

  if (activeContractIds.length === 0) {
    console.log('[SorobanRentWorker] No active contract subscriptions found in DB. Pass complete.');
    return;
  }

  console.log(`[SorobanRentWorker] Found ${activeContractIds.length} active contract(s) to check.`);

  const latestLedger = await sorobanServer.getLatestLedger();
  const latestLedgerSeq = latestLedger.sequence;

  console.log(`[SorobanRentWorker] Current latest ledger sequence: ${latestLedgerSeq}`);

  // Process sequentially to prevent sequence number collisions from a single fee payer account
  for (const contractId of activeContractIds) {
    try {
      await processContractRent(contractId, latestLedgerSeq);
    } catch (error: any) {
      console.error(
        `[SorobanRentWorker] Error processing rent for contract ${contractId}:`,
        error.message || error,
      );
    }
  }

  console.log('[SorobanRentWorker] Finished Soroban rent renewal pass.');
}

/**
 * Main worker loop.
 */
export async function runRentWorker() {
  console.log('[SorobanRentWorker] 🚀 Starting Soroban Rent Renewal Automation Worker...');

  const poll = async () => {
    if (isProcessing) {
      console.log('[SorobanRentWorker] ⏳ Previous cycle is still running. Skipping this pass.');
      return;
    }
    isProcessing = true;
    try {
      await runRentRenewalPass();
    } catch (error: any) {
      console.error('[SorobanRentWorker] Polling pass error:', error?.message || error);
    } finally {
      isProcessing = false;
    }
  };

  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

if (require.main === module) {
  registerSupervisorHeartbeat();
  runRentWorker();
}
