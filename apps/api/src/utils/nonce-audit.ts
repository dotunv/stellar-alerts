import type Redis from 'ioredis';
import { redis } from '../lib/redis';
import { prisma } from '../lib/prisma';

export const NONCE_AUDIT_PREFIX = 'nonce_audit:';
export const DEFAULT_NONCE_TTL_SECONDS = 86400; // 24 hours to cover RPC re-orgs & delayed relays

export interface EventNonceInput {
  txHash: string;
  topic?: string;
  sequence?: string | number;
  contractId?: string;
  details?: any;
  ttlSeconds?: number;
}

export interface SecurityAuditAttemptInput {
  txHash: string;
  topic?: string;
  sequence?: string | number;
  contractId?: string;
  details?: any;
}

/**
 * Logs replay attempt alert to security audit table in database.
 */
export async function logReplayAttempt(data: SecurityAuditAttemptInput): Promise<void> {
  const auditPayload = {
    eventType: 'EVENT_REPLAY_ATTEMPT',
    txHash: data.txHash,
    topic: data.topic || 'default',
    sequence: String(data.sequence ?? '0'),
    contractId: data.contractId || null,
    details: data.details
      ? typeof data.details === 'string'
        ? { message: data.details }
        : data.details
      : { alert: 'Duplicate smart contract event replay blocked' },
    severity: 'HIGH',
    createdAt: new Date(),
  };

  try {
    if ((prisma as any).securityAuditLog) {
      await (prisma as any).securityAuditLog.create({ data: auditPayload });
    } else if ((prisma as any).securityAudit) {
      await (prisma as any).securityAudit.create({ data: auditPayload });
    } else {
      console.warn('[SecurityAudit] Security audit log model not present on Prisma client:', auditPayload);
    }
  } catch (err: any) {
    console.error('[SecurityAudit] Error recording security audit replay attempt:', err.message);
  }
}

/**
 * NonceAuditManager manages ledger sequence nonces to prevent event replay exploits across Soroban indexer workers.
 * Tracks transaction hash + topic sequence pairs in Redis.
 */
export class NonceAuditManager {
  private redisClient: Redis;
  private ttlSeconds: number;

  constructor(redisClient: Redis = redis, ttlSeconds: number = DEFAULT_NONCE_TTL_SECONDS) {
    this.redisClient = redisClient;
    this.ttlSeconds = ttlSeconds;
  }

  /**
   * Constructs Redis storage key for transaction hash + topic sequence pair.
   */
  public buildKey(txHash: string, topic: string = 'default', sequence: string | number = 0): string {
    return `${NONCE_AUDIT_PREFIX}${txHash}:${topic}:${sequence}`;
  }

  /**
   * Checks if an event topic with transaction hash and sequence nonce already exists in Redis.
   */
  public async isDuplicate(
    txHash: string,
    topic: string = 'default',
    sequence: string | number = 0
  ): Promise<boolean> {
    if (!txHash) return false;
    try {
      const key = this.buildKey(txHash, topic, sequence);
      const val = await this.redisClient.get(key);
      return val !== null;
    } catch (err: any) {
      console.warn(`[NonceAuditManager] Redis lookup error for key ${txHash}:${topic}:${sequence}:`, err.message);
      return false;
    }
  }

  /**
   * Validates event nonce pair and records it in Redis if new.
   * If identical transaction hash and sequence nonce for event topic already exists:
   * 1. Logs replay attempt alert to security audit table.
   * 2. Returns `false` (rejects duplicate event topic).
   *
   * If new:
   * 1. Stores in Redis with TTL.
   * 2. Returns `true` (allows event processing).
   */
  public async validateAndRecordNonce(input: EventNonceInput): Promise<boolean> {
    const { txHash, topic = 'default', sequence = 0, contractId, details, ttlSeconds } = input;
    if (!txHash) return true;

    const key = this.buildKey(txHash, topic, sequence);
    const ttl = ttlSeconds ?? this.ttlSeconds;

    try {
      // Use Redis SET key 1 EX ttl NX to atomically record new nonces
      const result = await this.redisClient.set(key, '1', 'EX', ttl, 'NX');

      if (result === 'OK') {
        return true; // New nonce pair registered successfully
      }

      // Duplicate detected!
      console.warn(
        `[NonceAuditManager] 🚨 Event replay attempt rejected for txHash: ${txHash}, topic: ${topic}, sequence: ${sequence}`
      );

      await logReplayAttempt({
        txHash,
        topic,
        sequence,
        contractId,
        details: details || { alert: 'Duplicate event topic sharing identical transaction hash and sequence nonce rejected', key },
      });

      return false;
    } catch (err: any) {
      console.error(`[NonceAuditManager] Redis error checking nonce for ${txHash}:`, err.message);
      return true; // Graceful fallback on Redis error
    }
  }

  /**
   * Directly records a security replay attempt log.
   */
  public async auditReplayAttempt(input: EventNonceInput): Promise<void> {
    await logReplayAttempt({
      txHash: input.txHash,
      topic: input.topic || 'default',
      sequence: input.sequence ?? 0,
      contractId: input.contractId,
      details: input.details,
    });
  }
}

export const nonceAuditManager = new NonceAuditManager();

/**
 * Utility helper to validate smart contract event nonce against replay.
 */
export async function checkEventNonceReplay(
  txHash: string,
  topic: string = 'default',
  sequence: string | number = 0,
  contractId?: string,
  details?: any
): Promise<boolean> {
  return nonceAuditManager.validateAndRecordNonce({
    txHash,
    topic,
    sequence,
    contractId,
    details,
  });
}
