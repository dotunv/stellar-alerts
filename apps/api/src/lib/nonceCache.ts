import crypto from 'crypto';
import type Redis from 'ioredis';
import { redis } from './redis';

export const NONCE_PREFIX = 'webhook_nonce:';
export const DEFAULT_NONCE_TTL_SECONDS = 300; // 5 minutes

/**
 * Generates a cryptographically secure UUIDv4 nonce string.
 */
export function generateNonce(): string {
  return crypto.randomUUID();
}

/**
 * Atomically checks whether a nonce has already been used and stores it with an expiry TTL.
 *
 * Uses Redis `SET key 1 EX ttl NX` so that duplicate / replayed nonces are rejected.
 *
 * @param nonce        - The unique UUIDv4 nonce string.
 * @param ttlSeconds   - Time-to-live in seconds (defaults to 300s / 5 minutes).
 * @param redisClient  - Optional Redis instance (defaults to shared singleton).
 * @returns `true` if the nonce was new and recorded, `false` if it was already used (replay attack).
 */
export async function checkAndStoreNonce(
  nonce: string,
  ttlSeconds: number = DEFAULT_NONCE_TTL_SECONDS,
  redisClient: Redis = redis
): Promise<boolean> {
  if (!nonce) {
    return false;
  }

  try {
    const key = `${NONCE_PREFIX}${nonce}`;
    const result = await redisClient.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  } catch (error: any) {
    console.warn(`[NonceCache] Redis error checking nonce ${nonce}: ${error.message}`);
    return false;
  }
}

/**
 * Checks whether a nonce has already been recorded in the cache.
 *
 * @param nonce        - The nonce to check.
 * @param redisClient  - Optional Redis instance.
 * @returns `true` if recorded (already used), `false` otherwise.
 */
export async function isNonceRecorded(
  nonce: string,
  redisClient: Redis = redis
): Promise<boolean> {
  if (!nonce) {
    return false;
  }

  try {
    const key = `${NONCE_PREFIX}${nonce}`;
    const value = await redisClient.get(key);
    return value !== null;
  } catch (error: any) {
    console.warn(`[NonceCache] Redis error fetching nonce ${nonce}: ${error.message}`);
    return false;
  }
}

/**
 * Directly stores a nonce in the cache with a specified TTL.
 *
 * @param nonce        - The nonce to store.
 * @param ttlSeconds   - Time-to-live in seconds.
 * @param redisClient  - Optional Redis instance.
 */
export async function storeNonce(
  nonce: string,
  ttlSeconds: number = DEFAULT_NONCE_TTL_SECONDS,
  redisClient: Redis = redis
): Promise<void> {
  if (!nonce) {
    return;
  }

  const key = `${NONCE_PREFIX}${nonce}`;
  await redisClient.set(key, '1', 'EX', ttlSeconds);
}
