import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getWalletLockKey,
  acquireWalletLock,
  releaseWalletLock,
  withWalletLock,
} from '../lock';

const mockStore = new Map<string, string>();

vi.mock('ioredis', () => {
  const RedisMock = vi.fn().mockImplementation(() => ({
    set: vi.fn(async (key: string, value: string, ...rest: any[]) => {
      const hasNx = rest.some((arg) => typeof arg === 'string' && arg.toUpperCase() === 'NX');
      if (hasNx && mockStore.has(key)) {
        return null;
      }
      mockStore.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => mockStore.get(key) ?? null),
    eval: vi.fn(async (_script: string, _numkeys: number, key: string, value: string) => {
      if (mockStore.get(key) === value) {
        mockStore.delete(key);
        return 1;
      }
      return 0;
    }),
    on: vi.fn(),
  }));
  return { default: RedisMock };
});

vi.mock('../redis', async () => {
  const { default: Redis } = await import('ioredis');
  return { redis: new Redis() };
});

describe('lock', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getWalletLockKey', () => {
    it('should format wallet lock key correctly', () => {
      expect(getWalletLockKey('wallet-123')).toBe('lock:wallet:wallet-123');
    });
  });

  describe('acquireWalletLock & releaseWalletLock', () => {
    it('should acquire lock for an un-locked wallet and release it', async () => {
      const lock = await acquireWalletLock('wallet-1');
      expect(lock).not.toBeNull();
      expect(lock?.key).toBe('lock:wallet:wallet-1');

      const released = await releaseWalletLock(lock);
      expect(released).toBe(true);
      expect(mockStore.has('lock:wallet:wallet-1')).toBe(false);
    });

    it('should fail to acquire lock if already held by another process', async () => {
      const lock1 = await acquireWalletLock('wallet-1');
      expect(lock1).not.toBeNull();

      const lock2 = await acquireWalletLock('wallet-1', { retryCount: 0 });
      expect(lock2).toBeNull();
    });

    it('should not release lock if value does not match lock owner', async () => {
      const lock1 = await acquireWalletLock('wallet-1');
      expect(lock1).not.toBeNull();

      const fakeLock = { key: lock1!.key, value: 'other-process-id', ttlMs: 30000 };
      const released = await releaseWalletLock(fakeLock);
      expect(released).toBe(false);
      expect(mockStore.has(lock1!.key)).toBe(true);
    });
  });

  describe('withWalletLock', () => {
    it('should execute operation inside lock and release afterwards', async () => {
      let executed = false;
      const result = await withWalletLock('wallet-test', async () => {
        executed = true;
        return 'success';
      });

      expect(result).toBe('success');
      expect(executed).toBe(true);
      expect(mockStore.has('lock:wallet:wallet-test')).toBe(false);
    });

    it('should return null and skip execution if lock acquisition fails due to contention', async () => {
      const lock1 = await acquireWalletLock('wallet-contention');
      expect(lock1).not.toBeNull();

      let executed = false;
      const result = await withWalletLock('wallet-contention', async () => {
        executed = true;
        return 'should-not-run';
      }, { retryCount: 0 });

      expect(result).toBeNull();
      expect(executed).toBe(false);
    });
  });
});
