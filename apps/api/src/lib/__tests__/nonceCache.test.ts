import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateNonce,
  checkAndStoreNonce,
  isNonceRecorded,
  storeNonce,
  NONCE_PREFIX,
  DEFAULT_NONCE_TTL_SECONDS,
} from '../nonceCache';

// ---------------------------------------------------------------------------
// Mock ioredis so these tests run without a real Redis connection
// ---------------------------------------------------------------------------
const mockStore = new Map<string, string>();

vi.mock('ioredis', () => {
  const RedisMock = vi.fn().mockImplementation(() => ({
    set: vi.fn(async (key: string, value: string, ...rest: any[]) => {
      // Support Redis NX flag (only set if not exists)
      const hasNx = rest.some((arg) => typeof arg === 'string' && arg.toUpperCase() === 'NX');
      if (hasNx && mockStore.has(key)) {
        return null;
      }
      mockStore.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => mockStore.get(key) ?? null),
    on: vi.fn(),
  }));
  return { default: RedisMock };
});

vi.mock('../../lib/redis', async () => {
  const { default: Redis } = await import('ioredis');
  return { redis: new Redis() };
});

describe('nonceCache', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('generateNonce', () => {
    it('should generate a valid UUIDv4 nonce', () => {
      const nonce = generateNonce();
      expect(typeof nonce).toBe('string');
      // UUIDv4 format check
      const uuidv4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(uuidv4Regex.test(nonce)).toBe(true);
    });

    it('should generate distinct nonces on consecutive calls', () => {
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();
      expect(nonce1).not.toBe(nonce2);
    });
  });

  describe('checkAndStoreNonce', () => {
    it('should store a new nonce and return true', async () => {
      const nonce = generateNonce();
      const result = await checkAndStoreNonce(nonce, DEFAULT_NONCE_TTL_SECONDS);

      expect(result).toBe(true);
      expect(mockStore.has(`${NONCE_PREFIX}${nonce}`)).toBe(true);
    });

    it('should reject a duplicate/replayed nonce and return false', async () => {
      const nonce = generateNonce();

      // First request with nonce
      const firstResult = await checkAndStoreNonce(nonce);
      expect(firstResult).toBe(true);

      // Replay attempt with same nonce
      const replayResult = await checkAndStoreNonce(nonce);
      expect(replayResult).toBe(false);
    });

    it('should return false if empty nonce is provided', async () => {
      const result = await checkAndStoreNonce('');
      expect(result).toBe(false);
    });
  });

  describe('isNonceRecorded', () => {
    it('should return false for unrecorded nonce', async () => {
      const nonce = generateNonce();
      const result = await isNonceRecorded(nonce);
      expect(result).toBe(false);
    });

    it('should return true for an already recorded nonce', async () => {
      const nonce = generateNonce();
      mockStore.set(`${NONCE_PREFIX}${nonce}`, '1');

      const result = await isNonceRecorded(nonce);
      expect(result).toBe(true);
    });

    it('should return false if nonce expired and was evicted from cache', async () => {
      const nonce = generateNonce();
      mockStore.set(`${NONCE_PREFIX}${nonce}`, '1');

      // Simulate TTL expiration
      mockStore.delete(`${NONCE_PREFIX}${nonce}`);

      const result = await isNonceRecorded(nonce);
      expect(result).toBe(false);
    });

    it('should return false for empty nonce', async () => {
      const result = await isNonceRecorded('');
      expect(result).toBe(false);
    });
  });

  describe('storeNonce', () => {
    it('should store the nonce in the Redis cache', async () => {
      const nonce = generateNonce();
      await storeNonce(nonce, 300);

      expect(mockStore.has(`${NONCE_PREFIX}${nonce}`)).toBe(true);
    });

    it('should safely do nothing for empty nonce', async () => {
      await storeNonce('');
      expect(mockStore.size).toBe(0);
    });
  });

  describe('replay detection round-trip', () => {
    it('should allow first delivery and block any replay within TTL window', async () => {
      const nonce = generateNonce();

      expect(await isNonceRecorded(nonce)).toBe(false);

      const accepted = await checkAndStoreNonce(nonce);
      expect(accepted).toBe(true);
      expect(await isNonceRecorded(nonce)).toBe(true);

      const replayed = await checkAndStoreNonce(nonce);
      expect(replayed).toBe(false);
    });
  });
});
