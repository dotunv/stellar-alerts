import * as StellarSdk from "stellar-sdk";
import { prisma } from "./prisma";
import {
  hashMerkleLeaf,
  verifyMerkleProof,
  MerkleProofStep,
} from "../utils/merkle-verifier";
import { decodeScAddress, decodeScAmount, formatTokenAmount } from "./stellar";

const SOROBAN_RPC_URL =
  process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const LEDGER_BATCH_SIZE = 100;
const MAX_EVENTS_PER_QUERY = 10000;
const MAX_ACTIVE_CONTRACTS = 100;

export const sorobanServer = new (StellarSdk as any).rpc.Server(
  SOROBAN_RPC_URL,
);

export interface ParsedSorobanTransfer {
  contractId: string;
  from: string;
  to: string;
  amount: string;
  topic: string;
  ledgerSeq?: number;
}

export interface ContractRegistry {
  contractId: string;
  topicRoutes: Map<string, string[]>;
  lastPolled?: number;
}

// In-memory registry for fast topic routing
const contractRegistry = new Map<string, ContractRegistry>();

/**
 * Loads active Soroban contract subscriptions into in-memory registry.
 * Maintains up to MAX_ACTIVE_CONTRACTS.
 */
export async function loadContractRegistry(): Promise<
  Map<string, ContractRegistry>
> {
  try {
    const subscriptions = await prisma.sorobanContractSubscription.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
      take: MAX_ACTIVE_CONTRACTS,
    });

    contractRegistry.clear();

    // Group by contractId
    const grouped = new Map<string, Map<string, Set<string>>>();

    for (const sub of subscriptions) {
      if (!grouped.has(sub.contractId)) {
        grouped.set(sub.contractId, new Map());
      }

      const topicMap = grouped.get(sub.contractId)!;
      const topic = sub.topic || "default";

      if (!topicMap.has(topic)) {
        topicMap.set(topic, new Set());
      }

      topicMap.get(topic)!.add(sub.userId);
    }

    // Convert to registry format
    for (const [contractId, topicMap] of grouped.entries()) {
      const topicRoutes = new Map<string, string[]>();

      for (const [topic, userIds] of topicMap.entries()) {
        topicRoutes.set(topic, Array.from(userIds));
      }

      contractRegistry.set(contractId, {
        contractId,
        topicRoutes,
        lastPolled: Date.now(),
      });
    }

    console.log(
      `[Registry] Loaded ${contractRegistry.size} active contracts (${subscriptions.length} subscriptions)`,
    );
    return contractRegistry;
  } catch (error: any) {
    console.error("[Registry] Error loading contract registry:", error.message);
    return contractRegistry;
  }
}

/**
 * Routes an event to matching subscribed users based on contract ID and topic.
 */
export function routeEventToUsers(
  event: any,
): { contractId: string; topic: string; userIds: string[] }[] {
  const routes: { contractId: string; topic: string; userIds: string[] }[] = [];
  const contractId = event.contractId;

  if (!contractId) return routes;

  const contract = contractRegistry.get(contractId);
  if (!contract) return routes;

  // Determine topic from event
  const topic = event.topic?.[0] || "default";

  // Check for exact topic match
  let matchedUserIds = contract.topicRoutes.get(topic);

  // Fall back to 'default' topic if no exact match
  if (!matchedUserIds || matchedUserIds.length === 0) {
    matchedUserIds = contract.topicRoutes.get("default");
  }

  if (matchedUserIds && matchedUserIds.length > 0) {
    routes.push({
      contractId,
      topic,
      userIds: matchedUserIds,
    });
  }

  return routes;
}

/**
 * Gets all active contract IDs from registry.
 */
export function getActiveContractIds(): string[] {
  return Array.from(contractRegistry.keys());
}

/**
 * Gets contract subscriber count for a specific contract.
 */
export function getContractSubscriberCount(contractId: string): number {
  const contract = contractRegistry.get(contractId);
  if (!contract) return 0;

  let total = 0;
  for (const userIds of contract.topicRoutes.values()) {
    total += userIds.length;
  }

  return total;
}

/**
 * Fetches latest ledger sequence from Soroban RPC endpoint.
 */
export interface SorobanContractStateProofInput {
  /** Base64-encoded XDR of the ledger entry's key (xdr.LedgerKey). */
  ledgerKeyXdr: string;
  /** Base64-encoded XDR of the ledger entry's value (xdr.LedgerEntryData). */
  ledgerEntryXdr: string;
  /** Inclusion proof path from the entry's leaf hash up to the ledger's state root. */
  proof: MerkleProofStep[];
  /**
   * Hex-encoded state root to verify against — the target ledger header's
   * bucketListHash (xdr.LedgerHeader.bucketListHash), the Stellar protocol's
   * cryptographic commitment to the full ledger state at that ledger.
   */
  ledgerStateRoot: string;
}

/**
 * Computes the canonical Merkle leaf hash for a Soroban contract storage
 * entry: the SHA-256 (leaf-domain-separated) hash of its key XDR
 * concatenated with its value XDR. Binding both means the proof commits to
 * the *exact* stored value, not just the fact that some value exists for
 * that key.
 */
export function hashSorobanLedgerEntry(ledgerKeyXdr: string, ledgerEntryXdr: string): string {
  const keyBytes = Buffer.from(ledgerKeyXdr, "base64");
  const entryBytes = Buffer.from(ledgerEntryXdr, "base64");
  return hashMerkleLeaf(Buffer.concat([keyBytes, entryBytes]));
}

/**
 * Cryptographically verifies that a Soroban contract storage entry is
 * included in a ledger's state, given an inclusion proof and that ledger's
 * state root — without needing to run a full node. Never throws: any
 * malformed input (bad base64/XDR, malformed proof, wrong root format)
 * simply fails verification.
 */
export function verifySorobanContractStateProof(input: SorobanContractStateProofInput): boolean {
  try {
    const leafHash = hashSorobanLedgerEntry(input.ledgerKeyXdr, input.ledgerEntryXdr);
    return verifyMerkleProof({ leafHash, path: input.proof }, input.ledgerStateRoot);
  } catch {
    return false;
  }
}

export async function getSorobanLatestLedger(): Promise<number> {
  try {
    const health = await sorobanServer.getLatestLedger();
    return health.sequence;
  } catch (error: any) {
    console.warn(
      `[SorobanRPC] Could not fetch latest ledger: ${error.message}`,
    );
    return 0;
  }
}

/**
 * Fetches contract events from Soroban RPC for a specific contract address.
 */
export async function fetchContractEvents(
  contractId: string,
  startLedger: number,
): Promise<any[]> {
  try {
    const response = await sorobanServer.getEvents({
      startLedger,
      filters: [
        {
          type: "contract",
          contractIds: [contractId],
        },
      ],
    });
    return response.events || [];
  } catch (error: any) {
    console.error(
      `[SorobanRPC] Error fetching contract events for ${contractId}:`,
      error.message,
    );
    return [];
  }
}

/**
 * Fetches contract events within a ledger range with pagination.
 */
export async function* fetchContractEventsInRange(
  contractId: string,
  startLedger: number,
  endLedger: number,
): AsyncGenerator<any[]> {
  let currentStart = startLedger;

  while (currentStart <= endLedger) {
    const batchEnd = Math.min(currentStart + LEDGER_BATCH_SIZE, endLedger);

    try {
      console.log(
        `[SorobanRPC] Fetching events for ${contractId} from ledger ${currentStart} to ${batchEnd}`,
      );

      const response = await sorobanServer.getEvents({
        startLedger: currentStart,
        endLedger: batchEnd,
        filters: [
          {
            type: "contract",
            contractIds: [contractId],
          },
        ],
      });

      const events = response.events || [];

      if (events.length > 0) {
        const enrichedEvents = events.map((evt: any) => ({
          ...evt,
          ledgerSeq: evt.ledger || currentStart,
        }));
        yield enrichedEvents;
      }

      if (events.length > 0 && events[events.length - 1]?.ledger) {
        currentStart = events[events.length - 1].ledger + 1;
      } else {
        currentStart = batchEnd + 1;
      }

      if (events.length === 0) break;
    } catch (error: any) {
      console.error(
        `[SorobanRPC] Error fetching events for ${contractId} in range [${currentStart}, ${batchEnd}]:`,
        error.message,
      );
      currentStart = batchEnd + 1;
    }
  }
}

export interface ParsedSorobanSwap {
  contractId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  /**
   * Price impact of the swap as a percentage string (e.g. "2.35" = 2.35%),
   * taken directly from the event when the contract reports it. Null when
   * the event doesn't include enough pricing context to know it.
   */
  priceImpactPct: string | null;
  ledgerSeq?: number;
  txHash?: string;
}

function extractSwapTopicValue(topicEntry: any): string | null {
  if (typeof topicEntry === "string") return topicEntry;
  if (topicEntry && typeof topicEntry === "object" && typeof topicEntry.symbol === "string") {
    return topicEntry.symbol;
  }
  return null;
}

function asAddressString(value: any): string {
  return decodeScAddress(value) ?? (typeof value === "string" ? value : "");
}

/**
 * Parses a raw Soroban RPC event into a DEX swap, if it looks like one.
 * Matches the `swap` topic emitted by Phoenix / Soroswap-style liquidity
 * pool contracts. The exact event shape varies slightly by DEX, so this
 * accepts a handful of common field name variants rather than committing to
 * one contract's ABI:
 *
 *   topic: ["swap", ...]
 *   value: {
 *     token_in | tokenIn | asset_in,
 *     token_out | tokenOut | asset_out,
 *     amount_in | amountIn,
 *     amount_out | amountOut,
 *     price_impact | priceImpact (optional, already a percentage),
 *   }
 *
 * Returns null for any event that isn't a swap or is missing the amounts
 * needed to describe one.
 */
export function parseSwapEvent(event: any): ParsedSorobanSwap | null {
  if (!event || !event.topic || event.topic.length === 0) {
    return null;
  }

  const action = extractSwapTopicValue(event.topic[0]);
  if (action !== "swap") {
    return null;
  }

  const value = event.value || event.data || {};

  const tokenIn = asAddressString(value.token_in ?? value.tokenIn ?? value.asset_in);
  const tokenOut = asAddressString(value.token_out ?? value.tokenOut ?? value.asset_out);

  const rawAmountIn = decodeScAmount(value.amount_in ?? value.amountIn);
  const rawAmountOut = decodeScAmount(value.amount_out ?? value.amountOut);

  if (rawAmountIn === null || rawAmountOut === null) {
    return null;
  }

  const rawPriceImpact = value.price_impact ?? value.priceImpact;
  const priceImpactPct =
    rawPriceImpact !== undefined && rawPriceImpact !== null && !Number.isNaN(Number(rawPriceImpact))
      ? String(rawPriceImpact)
      : null;

  return {
    contractId: event.contractId || "",
    tokenIn,
    tokenOut,
    amountIn: formatTokenAmount(rawAmountIn),
    amountOut: formatTokenAmount(rawAmountOut),
    priceImpactPct,
    ledgerSeq: event.ledgerSeq || event.ledger,
    txHash: event.txHash || event.transactionHash,
  };
}

/**
 * Parses raw Soroban RPC event data into a clean transfer object.
 */
export function parseSorobanTransferEvent(
  event: any,
): ParsedSorobanTransfer | null {
  if (!event || !event.topic || event.topic.length === 0) {
    return null;
  }

  const contractId = event.contractId || "";
  const topic = event.topic[0] || "";

  const value = event.value || {};
  const from = value.from || value.transfer?.from || "";
  const to = value.to || value.transfer?.to || "";
  const amount = value.amount ? String(value.amount) : "0";

  return {
    contractId,
    from,
    to,
    amount,
    topic,
    ledgerSeq: event.ledgerSeq || event.ledger,
  };
}

/**
 * Helper to build the LedgerKey for a contract instance.
 */
export function getContractInstanceLedgerKey(contractId: string): StellarSdk.xdr.LedgerKey {
  const address = StellarSdk.Address.fromString(contractId);
  const scAddress = address.toScAddress();

  const contractDataKey = new StellarSdk.xdr.LedgerKeyContractData({
    contract: scAddress,
    key: StellarSdk.xdr.ScVal.scvLedgerKeyContractInstance(),
    durability: StellarSdk.xdr.ContractDataDurability.persistent(),
  });

  return StellarSdk.xdr.LedgerKey.contractData(contractDataKey);
}

/**
 * Extracts the WASM code hash from a contract instance LedgerEntryData.
 * Returns null if not a WASM contract or if parsing fails.
 */
export function getWasmHashFromContractInstance(val: StellarSdk.xdr.LedgerEntryData): Buffer | null {
  try {
    if (val.switch() === StellarSdk.xdr.LedgerEntryType.contractData()) {
      const contractData = val.contractData();
      const value = contractData.val();
      if (value.switch() === StellarSdk.xdr.ScValType.scvContractInstance()) {
        const instance = value.instance();
        const executable = instance.executable();
        if (executable.switch() === StellarSdk.xdr.ContractExecutableType.contractExecutableWasm()) {
          return executable.wasmHash();
        }
      }
    }
  } catch (error: any) {
    console.error("[Soroban] Failed to parse contract instance WASM hash:", error.message || error);
  }
  return null;
}

/**
 * Deterministic calculation of remaining TTL in ledgers.
 */
export function getRemainingTtl(liveUntilLedgerSeq: number, currentLedger: number): number {
  return liveUntilLedgerSeq - currentLedger;
}

/**
 * Deterministic helper to check if renewal is needed.
 */
export function shouldRenew(remainingTtl: number, threshold: number): boolean {
  return remainingTtl <= threshold;
}

export type FlashLoanOperationType = "borrow" | "repay" | "swap" | "transfer" | "invoke";

export interface SorobanTransactionOperationInput {
  id: string;
  parentId?: string;
  type: string;
  asset?: string;
  amount?: string | number | bigint;
  contractId?: string;
  tokenIn?: string;
  tokenOut?: string;
  amountIn?: string | number | bigint;
  amountOut?: string | number | bigint;
  profit?: string | number | bigint;
  fee?: string | number | bigint;
}

export interface FlashLoanOperationNode {
  id: string;
  parentId?: string;
  type: FlashLoanOperationType;
  asset: string;
  amount: bigint;
  amountFormatted: string;
  contractId?: string;
  children: FlashLoanOperationNode[];
}

export interface ParsedFlashLoanAlert {
  txHash: string;
  ledgerSeq?: number;
  contractId: string;
  borrowedAsset: string;
  borrowedAmount: string;
  feeAmount: string;
  netArbitrageProfit: string;
}

const FLASH_LOAN_BORROW_TOPICS = new Set(["borrow", "flash_loan", "loan", "flashloan"]);
const FLASH_LOAN_REPAY_TOPICS = new Set(["repay", "flash_repay", "repay_loan", "repay_flash_loan"]);

function normalizeOperationType(rawType: string): FlashLoanOperationType {
  const normalized = rawType.toLowerCase();
  if (FLASH_LOAN_BORROW_TOPICS.has(normalized)) return "borrow";
  if (FLASH_LOAN_REPAY_TOPICS.has(normalized)) return "repay";
  if (normalized === "swap") return "swap";
  if (normalized === "transfer") return "transfer";
  return "invoke";
}

function toBigIntAmount(value: string | number | bigint | undefined | null): bigint | null {
  if (value === undefined || value === null) return null;
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") return BigInt(Math.trunc(value));
    const decoded = decodeScAmount(value);
    if (decoded !== null) return decoded;
    if (/^\d+$/.test(String(value))) return BigInt(String(value));
    return null;
  } catch {
    return null;
  }
}

function formatAmount(value: bigint): string {
  return formatTokenAmount(value);
}

/**
 * Parses a Soroban contract event into a normalized flash-loan operation node input.
 */
export function parseFlashLoanOperationFromEvent(event: any): SorobanTransactionOperationInput | null {
  if (!event?.topic?.length) return null;

  const topic = extractSwapTopicValue(event.topic[0]);
  if (!topic) return null;

  const normalized = topic.toLowerCase();
  if (
    !FLASH_LOAN_BORROW_TOPICS.has(normalized) &&
    !FLASH_LOAN_REPAY_TOPICS.has(normalized) &&
    normalized !== "swap" &&
    normalized !== "transfer"
  ) {
    return null;
  }

  const value = event.value || event.data || {};
  const contractId = event.contractId || value.contract_id || value.contractId;

  if (normalized === "swap") {
    const amountIn = decodeScAmount(value.amount_in ?? value.amountIn);
    const amountOut = decodeScAmount(value.amount_out ?? value.amountOut);
    if (amountIn === null || amountOut === null) return null;

    return {
      id: `${event.txHash || event.transactionHash || contractId || "swap"}:${event.id || event.eventIndex || `${value.token_in}-${value.token_out}`}`,
      parentId: value.parent_id || value.parentId,
      type: "swap",
      contractId,
      tokenIn: asAddressString(value.token_in ?? value.tokenIn ?? value.asset_in),
      tokenOut: asAddressString(value.token_out ?? value.tokenOut ?? value.asset_out),
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
    };
  }

  const asset = asAddressString(value.asset ?? value.token ?? value.currency);
  const amount = decodeScAmount(value.amount ?? value.borrowed_amount ?? value.repaid_amount);
  if (!asset || amount === null) return null;

  return {
    id: `${event.txHash || event.transactionHash || contractId}:${event.id || event.eventIndex || `${normalized}-${asset}`}`,
    parentId: value.parent_id || value.parentId,
    type: normalized,
    asset,
    amount: amount.toString(),
    contractId,
    fee: value.fee ?? value.flash_fee,
    profit: value.profit ?? value.arbitrage_profit ?? value.net_profit,
  };
}

/**
 * Builds an atomic transaction operation tree from flat Soroban invocation records.
 */
export function buildFlashLoanOperationTree(
  operations: SorobanTransactionOperationInput[],
): FlashLoanOperationNode[] {
  const nodes = new Map<string, FlashLoanOperationNode>();

  for (const operation of operations) {
    const type = normalizeOperationType(operation.type);
    const asset =
      operation.asset ||
      (type === "swap" ? operation.tokenIn || operation.tokenOut || "" : "");
    const amount =
      type === "swap"
        ? toBigIntAmount(operation.amountIn)
        : toBigIntAmount(operation.amount);

    if (!asset || amount === null) continue;

    nodes.set(operation.id, {
      id: operation.id,
      parentId: operation.parentId,
      type,
      asset,
      amount,
      amountFormatted: formatAmount(amount),
      contractId: operation.contractId,
      children: [],
    });
  }

  const roots: FlashLoanOperationNode[] = [];
  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function calculateNetArbitrageProfit(
  operations: SorobanTransactionOperationInput[],
  borrowedAsset: string,
  borrowAmount: bigint,
  repayAmount: bigint,
): bigint {
  for (const operation of operations) {
    const explicitProfit = toBigIntAmount(operation.profit);
    if (explicitProfit !== null && explicitProfit > 0n) {
      return explicitProfit;
    }
  }

  let swapDelta = 0n;
  for (const operation of operations) {
    if (normalizeOperationType(operation.type) !== "swap") continue;

    const tokenIn = operation.tokenIn || "";
    const tokenOut = operation.tokenOut || "";
    const amountIn = toBigIntAmount(operation.amountIn);
    const amountOut = toBigIntAmount(operation.amountOut);
    if (amountIn === null || amountOut === null) continue;

    if (tokenOut === borrowedAsset) swapDelta += amountOut;
    if (tokenIn === borrowedAsset) swapDelta -= amountIn;
  }

  const surplus = borrowAmount + swapDelta - repayAmount;
  return surplus > 0n ? surplus : 0n;
}

/**
 * Detects atomic flash-loan borrow/repay invariants within a single transaction tree.
 */
export function detectFlashLoanInTransaction(
  txHash: string,
  operations: SorobanTransactionOperationInput[],
  ledgerSeq?: number,
): ParsedFlashLoanAlert | null {
  if (!txHash || operations.length === 0) return null;

  buildFlashLoanOperationTree(operations);

  const borrowOps = operations.filter((op) => normalizeOperationType(op.type) === "borrow");
  const repayOps = operations.filter((op) => normalizeOperationType(op.type) === "repay");

  if (borrowOps.length === 0 || repayOps.length === 0) return null;

  for (const borrowOp of borrowOps) {
    const borrowedAsset = borrowOp.asset || "";
    const borrowAmount = toBigIntAmount(borrowOp.amount);
    if (!borrowedAsset || borrowAmount === null || borrowAmount <= 0n) continue;

    const matchingRepay = repayOps.find((repayOp) => (repayOp.asset || "") === borrowedAsset);
    if (!matchingRepay) continue;

    const repayAmount = toBigIntAmount(matchingRepay.amount);
    if (repayAmount === null || repayAmount < borrowAmount) continue;

    let feeAmount = repayAmount - borrowAmount;
    const explicitFee = toBigIntAmount(matchingRepay.fee ?? borrowOp.fee);
    if (explicitFee !== null && explicitFee >= 0n) {
      feeAmount = explicitFee;
    }

    const netArbitrageProfit = calculateNetArbitrageProfit(
      operations,
      borrowedAsset,
      borrowAmount,
      repayAmount,
    );

    return {
      txHash,
      ledgerSeq,
      contractId: borrowOp.contractId || matchingRepay.contractId || "",
      borrowedAsset,
      borrowedAmount: formatAmount(borrowAmount),
      feeAmount: formatAmount(feeAmount),
      netArbitrageProfit: formatAmount(netArbitrageProfit),
    };
  }

  return null;
}

/**
 * Parses atomic transaction operation trees for flash-loan borrow/repay invariants.
 */
export class FlashLoanDetector {
  parseOperationTree(operations: SorobanTransactionOperationInput[]): FlashLoanOperationNode[] {
    return buildFlashLoanOperationTree(operations);
  }

  detect(transaction: {
    txHash: string;
    ledgerSeq?: number;
    operations: SorobanTransactionOperationInput[];
  }): ParsedFlashLoanAlert | null {
    return detectFlashLoanInTransaction(
      transaction.txHash,
      transaction.operations,
      transaction.ledgerSeq,
    );
  }

  detectFromEvents(events: any[], txHash: string, ledgerSeq?: number): ParsedFlashLoanAlert | null {
    const operations = events
      .map((event) => parseFlashLoanOperationFromEvent(event))
      .filter((operation): operation is SorobanTransactionOperationInput => operation !== null);

    return this.detect({ txHash, ledgerSeq, operations });
  }
}

export const flashLoanDetector = new FlashLoanDetector();

export interface ParsedStakingRewardEvent {
  contractId: string;
  account: string;
  rewardToken: string;
  poolContractId: string;
  amount: string;
  rawAmount: bigint;
  topic: string;
  epoch?: number;
  ledgerSeq?: number;
  txHash?: string;
}

const STAKING_REWARD_TOPICS = new Set([
  "distribute",
  "reward",
  "claim",
  "emitted",
  "emission",
  "stake_reward",
  "yield_distribution",
  "reward_distributed",
  "yield",
  "reward_emission",
  "staking_reward",
]);

/**
 * Parses a raw Soroban RPC event into a staking / LP yield reward distribution event.
 */
export function parseStakingRewardEvent(event: any): ParsedStakingRewardEvent | null {
  if (!event || !event.topic || event.topic.length === 0) {
    return null;
  }

  const rawTopic = extractSwapTopicValue(event.topic[0]);
  if (!rawTopic) return null;

  const topicNormalized = rawTopic.toLowerCase();
  if (!STAKING_REWARD_TOPICS.has(topicNormalized)) {
    return null;
  }

  const value = event.value || event.data || {};
  const contractId = event.contractId || "";

  const account = asAddressString(
    value.account ??
      value.recipient ??
      value.staker ??
      value.user ??
      value.to ??
      (value.distribute && (value.distribute.account || value.distribute.recipient))
  );

  if (!account) return null;

  const rewardToken = asAddressString(
    value.reward_token ??
      value.rewardToken ??
      value.asset ??
      value.token ??
      value.reward_asset ??
      value.rewardAsset ??
      contractId
  );

  const poolContractId = asAddressString(
    value.pool_contract_id ??
      value.poolContractId ??
      value.pool ??
      value.lp_token ??
      value.lpToken ??
      value.staking_pool ??
      contractId
  );

  const rawAmount = decodeScAmount(
    value.amount ??
      value.reward_amount ??
      value.rewardAmount ??
      value.yield ??
      value.emission ??
      value.reward_emission
  );

  if (rawAmount === null || rawAmount <= 0n) {
    return null;
  }

  const epoch =
    value.epoch !== undefined && value.epoch !== null && !Number.isNaN(Number(value.epoch))
      ? Number(value.epoch)
      : undefined;

  return {
    contractId,
    account,
    rewardToken,
    poolContractId,
    amount: formatTokenAmount(rawAmount),
    rawAmount,
    topic: topicNormalized,
    epoch,
    ledgerSeq: event.ledgerSeq || event.ledger,
    txHash: event.txHash || event.transactionHash,
  };
}

/**
 * StakingRewardTracker aggregates cumulative LP yield emissions and staking reward distributions
 * across Soroban liquidity pools per account.
 */
export class StakingRewardTracker {
  private accountTotals = new Map<string, Map<string, bigint>>();
  private poolTotals = new Map<string, bigint>();

  /**
   * Aggregates a single parsed reward event into cumulative tracker state.
   */
  processRewardEvent(event: ParsedStakingRewardEvent): {
    accountCumulativeAmount: string;
    poolCumulativeAmount: string;
  } {
    const { account, rewardToken, poolContractId, rawAmount } = event;

    // Account cumulative total
    if (!this.accountTotals.has(account)) {
      this.accountTotals.set(account, new Map());
    }
    const tokenMap = this.accountTotals.get(account)!;
    const currentAccountTotal = tokenMap.get(rewardToken) || 0n;
    const newAccountTotal = currentAccountTotal + rawAmount;
    tokenMap.set(rewardToken, newAccountTotal);

    // Pool-specific account total
    const poolKey = `${account}:${poolContractId}:${rewardToken}`;
    const currentPoolTotal = this.poolTotals.get(poolKey) || 0n;
    const newPoolTotal = currentPoolTotal + rawAmount;
    this.poolTotals.set(poolKey, newPoolTotal);

    return {
      accountCumulativeAmount: formatTokenAmount(newAccountTotal),
      poolCumulativeAmount: formatTokenAmount(newPoolTotal),
    };
  }

  /**
   * Processes a batch of raw Soroban RPC events, parsing reward events and aggregating yield emissions.
   */
  processEventBatch(events: any[]): {
    event: ParsedStakingRewardEvent;
    accountCumulativeAmount: string;
    poolCumulativeAmount: string;
  }[] {
    const results: {
      event: ParsedStakingRewardEvent;
      accountCumulativeAmount: string;
      poolCumulativeAmount: string;
    }[] = [];

    for (const rawEvent of events) {
      const parsed = parseStakingRewardEvent(rawEvent);
      if (!parsed) continue;

      const totals = this.processRewardEvent(parsed);
      results.push({
        event: parsed,
        accountCumulativeAmount: totals.accountCumulativeAmount,
        poolCumulativeAmount: totals.poolCumulativeAmount,
      });
    }

    return results;
  }

  /**
   * Gets cumulative yield emission for a specific account and reward token.
   */
  getCumulativeYield(account: string, rewardToken: string = "default"): string {
    const tokenMap = this.accountTotals.get(account);
    if (!tokenMap) return "0";

    if (rewardToken === "default") {
      let total = 0n;
      for (const amount of tokenMap.values()) {
        total += amount;
      }
      return formatTokenAmount(total);
    }

    const amount = tokenMap.get(rewardToken) || 0n;
    return formatTokenAmount(amount);
  }

  /**
   * Gets cumulative yield emission for an account within a specific pool and reward token.
   */
  getCumulativeYieldByPool(account: string, poolContractId: string, rewardToken: string): string {
    const poolKey = `${account}:${poolContractId}:${rewardToken}`;
    const amount = this.poolTotals.get(poolKey) || 0n;
    return formatTokenAmount(amount);
  }

  /**
   * Resets all accumulated yield metrics.
   */
  reset(): void {
    this.accountTotals.clear();
    this.poolTotals.clear();
  }
}

export const stakingRewardTracker = new StakingRewardTracker();


