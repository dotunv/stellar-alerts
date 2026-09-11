import * as StellarSdk from 'stellar-sdk';

const server = new StellarSdk.Horizon.Server('https://horizon-testnet.stellar.org');

export const STROOPS_PER_UNIT = 10_000_000;

export interface DecodedStellarAsset {
  assetCode: string;
  assetIssuer: string | null;
}

export interface SacTransfer {
  contractId: string;
  assetCode: string | null;
  assetIssuer: string | null;
  from: string;
  to: string;
  amount: string;
  rawAmount: string;
}

/**
 * Decodes a Horizon payment record into an asset code and issuer address.
 * Native XLM payments resolve to { assetCode: 'XLM', assetIssuer: null } while
 * credit_alphanum4 / credit_alphanum12 records carry their own code + issuer.
 */
export function decodeHorizonAsset(record: any): DecodedStellarAsset {
  if (record?.asset_type === 'native' || !record?.asset_type) {
    return { assetCode: 'XLM', assetIssuer: null };
  }

  return {
    assetCode: record.asset_code || 'Unknown',
    assetIssuer: record.asset_issuer || null,
  };
}

/**
 * Converts a raw token amount (stroops / smallest SAC unit) into a human
 * readable decimal string using the given number of decimals.
 */
export function formatTokenAmount(
  rawAmount: string | number | bigint,
  decimals: number = 7
): string {
  let raw: bigint;
  try {
    raw = typeof rawAmount === 'bigint' ? rawAmount : BigInt(String(rawAmount).trim());
  } catch {
    raw = 0n;
  }

  const sign = raw < 0n ? '-' : '';
  const abs = sign ? -raw : raw;
  const divisor = 10n ** BigInt(Math.max(0, decimals));
  const whole = abs / divisor;
  const fraction = (abs % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');

  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`;
}

/**
 * Decodes a Soroban ScVal address (or an already decoded strkey) into its
 * string representation (G... for accounts, C... for contracts).
 */
export function decodeScAddress(scVal: any): string | null {
  if (!scVal) return null;

  if (typeof scVal === 'string') {
    return scVal.startsWith('G') || scVal.startsWith('C') ? scVal : null;
  }

  if (typeof scVal === 'object') {
    try {
      const native = StellarSdk.scValToNative(scVal);
      if (typeof native === 'string') {
        return native.startsWith('G') || native.startsWith('C') ? native : null;
      }
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Decodes a Soroban i128 amount (raw ScVal, { lo, hi } shape or plain value)
 * into a bigint of stroops.
 */
export function decodeScAmount(value: any): bigint | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'bigint') return value;

  if (typeof value === 'number' && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }

  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }

  if (typeof value === 'object') {
    const i128 = value.i128 ?? value.value?.i128;
    if (i128 && typeof i128 === 'object' && i128.lo !== undefined) {
      const lo = BigInt(i128.lo >>> 0);
      const hi = BigInt(i128.hi >>> 0);
      return (hi << 64n) + lo;
    }
    if (typeof i128 === 'string' && /^-?\d+$/.test(i128)) {
      return BigInt(i128);
    }
    try {
      const native = StellarSdk.scValToNative(value);
      if (typeof native === 'bigint') return native;
      if (typeof native === 'number' && Number.isFinite(native)) {
        return BigInt(Math.trunc(native));
      }
    } catch {
      return null;
    }
  }

  return null;
}

function extractTopicValue(topicEntry: any): string | null {
  if (topicEntry === null || topicEntry === undefined) return null;
  if (typeof topicEntry === 'string') return topicEntry;
  if (typeof topicEntry === 'object' && typeof topicEntry.symbol === 'string') {
    return topicEntry.symbol;
  }
  return null;
}

/**
 * Parses a Soroban Asset Contract (SAC) transfer event into a structured
 * transfer with the decimal-adjusted amount. Supports both canonical RPC
 * events (topic: [symbol, from, to] + i128 data) and simplified payloads.
 */
export function parseSacTransferEvent(event: any, decimals: number = 7): SacTransfer | null {
  if (!event) return null;

  const topics = Array.isArray(event.topic) ? event.topic : [];
  const action = extractTopicValue(topics[0]) ?? (typeof event.topic === 'string' ? event.topic : '');

  const value = event.value ?? event.data ?? {};
  const from = (topics.length > 1 ? decodeScAddress(topics[1]) : null) ?? value.from ?? '';
  const to = (topics.length > 2 ? decodeScAddress(topics[2]) : null) ?? value.to ?? '';

  let rawAmount = decodeScAmount(value.amount);
  if (rawAmount === null && !value.amount && !value.from && !value.to) {
    rawAmount = decodeScAmount(value);
  }

  if (!action || action !== 'transfer' || rawAmount === null) {
    return null;
  }

  if (!from && !to) {
    return null;
  }

  return {
    contractId: event.contractId || '',
    assetCode: event.assetCode ?? null,
    assetIssuer: event.assetIssuer ?? null,
    from,
    to,
    amount: formatTokenAmount(rawAmount, decimals),
    rawAmount: rawAmount.toString(),
  };
}
function logPaymentsError(publicKey: string, error: any) {
  console.error(`[Stellar] Error fetching payments for account ${publicKey}:`, error?.message || error);
}

export interface MultisigSigner {
  key: string;
  weight: number;
}

export interface MultisigThresholds {
  low: number;
  medium: number;
  high: number;
}

export type MultisigThresholdLevel = 'low' | 'medium' | 'high';

export interface MultisigSignatureProgress {
  requiredThreshold: number;
  collectedWeight: number;
  /** Public keys of known signers whose signature was found and verified. */
  signedBy: string[];
  /** Known signers who have not yet contributed a valid signature. */
  remainingSigners: MultisigSigner[];
  thresholdMet: boolean;
  totalSigners: number;
  /** Count of signatures in the envelope matched to a known signer and verified. */
  validSignatureCount: number;
  /** Count of signatures in the envelope that could not be matched/verified against any known signer. */
  invalidSignatureCount: number;
}

/**
 * Counts how much of a Stellar multisig account's signing weight a
 * (possibly partially-signed) transaction envelope has collected so far,
 * and which of the account's known signers still need to add theirs.
 *
 * Each signature in the envelope is matched to a candidate signer by its
 * 4-byte hint and then cryptographically verified against the transaction
 * hash — a hint match alone doesn't prove authorship (hint collisions,
 * while rare, are possible), so only a verified signature counts toward
 * the threshold. Non-ed25519 signers (sha256-hash / pre-authorized
 * transaction signers) can't be matched against a normal signature this
 * way and are simply treated as not-yet-signed; they still count toward
 * `remainingSigners`.
 *
 * `thresholdLevel` selects which of the account's three threshold tiers
 * (low/medium/high) the transaction must clear — most payment/transfer
 * operations require "medium"; operations that change signers or account
 * options require "high".
 */
export function countMultisigSignatures(
  envelopeXdr: string,
  signers: MultisigSigner[],
  thresholds: MultisigThresholds,
  networkPassphrase: string,
  thresholdLevel: MultisigThresholdLevel = 'medium'
): MultisigSignatureProgress {
  const parsed = StellarSdk.TransactionBuilder.fromXDR(envelopeXdr, networkPassphrase);
  const tx = 'innerTransaction' in parsed ? parsed.innerTransaction : parsed;
  const txHash = tx.hash();

  const requiredThreshold =
    thresholdLevel === 'low'
      ? thresholds.low
      : thresholdLevel === 'high'
        ? thresholds.high
        : thresholds.medium;

  const signedBy = new Set<string>();
  let invalidSignatureCount = 0;

  for (const decoratedSig of tx.signatures) {
    const hint = decoratedSig.hint();
    const rawSignature = decoratedSig.signature();
    let matched = false;

    for (const signer of signers) {
      if (signedBy.has(signer.key)) continue;

      let keypair: StellarSdk.Keypair;
      try {
        keypair = StellarSdk.Keypair.fromPublicKey(signer.key);
      } catch {
        continue; // not an ed25519 signer key — can't verify a standard signature against it
      }

      if (!keypair.signatureHint().equals(hint)) continue;

      if (keypair.verify(txHash, rawSignature)) {
        signedBy.add(signer.key);
        matched = true;
        break;
      }
    }

    if (!matched) invalidSignatureCount++;
  }

  const collectedWeight = signers
    .filter((s) => signedBy.has(s.key))
    .reduce((sum, s) => sum + s.weight, 0);

  const remainingSigners = signers.filter((s) => !signedBy.has(s.key));

  return {
    requiredThreshold,
    collectedWeight,
    signedBy: Array.from(signedBy),
    remainingSigners,
    thresholdMet: collectedWeight >= requiredThreshold,
    totalSigners: signers.length,
    validSignatureCount: signedBy.size,
    invalidSignatureCount,
  };
}

export const DEFAULT_HORIZON_ENDPOINTS = [
  process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org',
  process.env.HORIZON_URL_NODE2 || 'https://horizon-testnet.publicnode.org',
  process.env.HORIZON_URL_NODE3 || 'https://horizon-testnet.lobstr.co',
];

export class MultiNodeHorizonClient {
  public endpoints: string[];
  public servers: StellarSdk.Horizon.Server[];

  constructor(endpoints: string[] = DEFAULT_HORIZON_ENDPOINTS) {
    this.endpoints = endpoints;
    this.servers = endpoints.map((url) => new StellarSdk.Horizon.Server(url));
  }

  async getPaymentsSince(publicKey: string, cursor: string, limit = 50): Promise<any[]> {
    if (!publicKey || !StellarSdk.StrKey.isValidEd25519PublicKey(publicKey)) {
      console.warn(`[MultiNodeHorizon] Skipping invalid public key checksum: "${publicKey}"`);
      return [];
    }

    for (let i = 0; i < this.servers.length; i++) {
      const server = this.servers[i];
      try {
        const payments = await server
          .payments()
          .forAccount(publicKey)
          .cursor(cursor)
          .order('asc')
          .limit(limit)
          .call();
        return payments.records;
      } catch (error: any) {
        console.warn(
          `[MultiNodeHorizon] Horizon node ${this.endpoints[i]} failed: ${error?.message || error}. Trying fallback node...`,
        );
      }
    }
    return [];
  }

  streamPaymentsMultiNode(
    publicKey: string,
    cursor: string,
    onMessage: (record: any, nodeUrl: string) => Promise<void> | void,
    onError?: (error: any, nodeUrl: string) => void
  ): () => void {
    const seenPagingTokens = new Set<string>();
    const activeCloseFns: Array<() => void> = [];

    this.servers.forEach((s, index) => {
      let isClosed = false;
      const nodeUrl = this.endpoints[index] || s.serverURL.toString();

      const connect = () => {
        if (isClosed) return;
        try {
          const closeStream = s
            .payments()
            .forAccount(publicKey)
            .cursor(cursor)
            .stream({
              onmessage: async (record: any) => {
                const token = record.paging_token || record.id || record.transaction_hash;
                if (token && seenPagingTokens.has(token)) {
                  return; // Deduplicate across concurrent multi-node SSE streams
                }
                if (token) {
                  seenPagingTokens.add(token);
                  if (seenPagingTokens.size > 10000) {
                    const first = seenPagingTokens.values().next().value;
                    if (first) seenPagingTokens.delete(first);
                  }
                }
                await onMessage(record, nodeUrl);
              },
              onerror: (error: any) => {
                if (onError) onError(error, nodeUrl);
                // Reconnect failover worker connection for this specific node
                setTimeout(() => {
                  if (!isClosed) connect();
                }, 5000);
              },
            }) as unknown as () => void;

          activeCloseFns.push(() => {
            isClosed = true;
            if (closeStream) closeStream();
          });
        } catch (err: any) {
          if (onError) onError(err, nodeUrl);
        }
      };

      connect();
    });

    return () => {
      activeCloseFns.forEach((fn) => fn());
    };
  }
}

export const multiNodeClient = new MultiNodeHorizonClient();

export const stellar = {
  server,
  multiNode: multiNodeClient,

  // Fetches an account's current signer list and multisig thresholds from
  // Horizon. Returns null for an invalid public key or if the account
  // cannot be loaded (e.g. not yet funded on this network).
  async getAccountSigners(
    publicKey: string
  ): Promise<{ signers: MultisigSigner[]; thresholds: MultisigThresholds } | null> {
    if (!publicKey || !StellarSdk.StrKey.isValidEd25519PublicKey(publicKey)) {
      console.warn(`[Stellar] Skipping invalid public key format or checksum: "${publicKey}"`);
      return null;
    }

    try {
      const account = await server.loadAccount(publicKey);
      return {
        signers: account.signers.map((s) => ({ key: s.key, weight: s.weight })),
        thresholds: {
          low: account.thresholds.low_threshold,
          medium: account.thresholds.med_threshold,
          high: account.thresholds.high_threshold,
        },
      };
    } catch (error: any) {
      console.error(`[Stellar] Error fetching signers for account ${publicKey}:`, error?.message || error);
      return null;
    }
  },
  // Helper to fetch recent payments for a given account
  async getRecentPayments(publicKey: string, limit: number = 10) {
    if (!publicKey || !StellarSdk.StrKey.isValidEd25519PublicKey(publicKey)) {
      console.warn(`[Stellar] Skipping invalid public key format or checksum: "${publicKey}"`);
      return [];
    }

    try {
      const payments = await server.payments()
        .forAccount(publicKey)
        .order('desc')
        .limit(limit)
        .call();
      
      return payments.records;
    } catch (error: any) {
      logPaymentsError(publicKey, error);
      return [];
    }
  },

  // Fetch payments recorded after the given Horizon paging token, oldest first
  async getPaymentsSince(publicKey: string, cursor: string, limit: number = 50) {
    return multiNodeClient.getPaymentsSince(publicKey, cursor, limit);
  },

  // Paging token of the most recent payment, used to seed a fresh cursor
  async getLatestPagingToken(publicKey: string): Promise<string> {
    const records = await this.getRecentPayments(publicKey, 1);
    return (records[0] as any)?.paging_token || '0';
  }
};
