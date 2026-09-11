import { redis } from './redis';

export interface WalletLock {
  key: string;
  value: string;
  ttlMs: number;
}

export interface LockOptions {
  ttlMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
}

const DEFAULT_TTL_MS = 30000;
const RELEASE_LUA_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

/**
 * Generates lock key for a given wallet ID or address.
 */
export function getWalletLockKey(walletId: string): string {
  return `lock:wallet:${walletId}`;
}

/**
 * Attempts to acquire a distributed mutex lock for a wallet address/ID using Redis SET NX PX.
 */
export async function acquireWalletLock(
  walletId: string,
  options: LockOptions = {}
): Promise<WalletLock | null> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const retryCount = options.retryCount ?? 0;
  const retryDelayMs = options.retryDelayMs ?? 100;
  const key = getWalletLockKey(walletId);
  const lockValue = `${process.pid}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      const result = await redis.set(key, lockValue, 'PX', ttlMs, 'NX');
      if (result === 'OK') {
        return { key, value: lockValue, ttlMs };
      }
    } catch (err: any) {
      console.warn(`[Lock] Redis acquire lock error for wallet ${walletId}: ${err.message}`);
    }

    if (attempt < retryCount) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  return null;
}

/**
 * Safely releases a distributed wallet lock using Lua script to prevent releasing another worker's lock.
 */
export async function releaseWalletLock(lock: WalletLock | null): Promise<boolean> {
  if (!lock) return false;

  try {
    const result = await redis.eval(RELEASE_LUA_SCRIPT, 1, lock.key, lock.value);
    return result === 1;
  } catch (err: any) {
    console.warn(`[Lock] Redis release lock error for key ${lock.key}: ${err.message}`);
    return false;
  }
}

/**
 * Helper to run an async operation with an acquired wallet mutex lock.
 * Releases lock upon completion or error.
 */
export async function withWalletLock<T>(
  walletId: string,
  fn: () => Promise<T>,
  options: LockOptions = {}
): Promise<T | null> {
  const lock = await acquireWalletLock(walletId, options);
  if (!lock) {
    console.warn(`[Lock] 🔒 Could not acquire lock for wallet ${walletId} (already in process). Skipping...`);
    return null;
  }

  try {
    return await fn();
  } finally {
    await releaseWalletLock(lock);
  }
}
