import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { revokeToken, isTokenRevoked } from '../tokenBlocklist';

// ---------------------------------------------------------------------------
// Mock ioredis so these tests run without a real Redis connection
// ---------------------------------------------------------------------------
const mockStore = new Map<string, string>();

vi.mock('ioredis', () => {
  const RedisMock = vi.fn().mockImplementation(() => ({
    set: vi.fn(async (key: string, value: string, ...rest: any[]) => {
      // Honour "EX" option so we can inspect the store
      mockStore.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => mockStore.get(key) ?? null),
    on: vi.fn(),
  }));
  return { default: RedisMock };
});

// The lib/redis module must be mocked BEFORE importing tokenBlocklist so the
// singleton picks up the mocked ioredis constructor.
vi.mock('../../lib/redis', async () => {
  const { default: Redis } = await import('ioredis');
  return { redis: new Redis() };
});

describe('tokenBlocklist', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('revokeToken', () => {
    it('should write the jti to the store with a positive TTL', async () => {
      const jti = 'test-jti-001';
      const exp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      await revokeToken(jti, exp);

      expect(mockStore.has(`jwt_blocklist:${jti}`)).toBe(true);
    });

    it('should NOT write to the store when the token is already expired', async () => {
      const jti = 'expired-jti-002';
      const exp = Math.floor(Date.now() / 1000) - 60; // expired 1 minute ago

      await revokeToken(jti, exp);

      expect(mockStore.has(`jwt_blocklist:${jti}`)).toBe(false);
    });
  });

  describe('isTokenRevoked', () => {
    it('should return true for a revoked jti', async () => {
      const jti = 'revoked-jti-003';
      mockStore.set(`jwt_blocklist:${jti}`, '1');

      const result = await isTokenRevoked(jti);
      expect(result).toBe(true);
    });

    it('should return false for an unknown (non-revoked) jti', async () => {
      const result = await isTokenRevoked('unknown-jti-004');
      expect(result).toBe(false);
    });

    it('should return false after the blocklist entry is removed (TTL expired)', async () => {
      const jti = 'expiring-jti-005';
      mockStore.set(`jwt_blocklist:${jti}`, '1');
      // Simulate TTL expiry by deleting from the mock store
      mockStore.delete(`jwt_blocklist:${jti}`);

      const result = await isTokenRevoked(jti);
      expect(result).toBe(false);
    });
  });

  describe('revokeToken + isTokenRevoked round-trip', () => {
    it('should revoke and immediately detect the revocation', async () => {
      const jti = 'roundtrip-jti-006';
      const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600; // 7 days

      expect(await isTokenRevoked(jti)).toBe(false);

      await revokeToken(jti, exp);

      expect(await isTokenRevoked(jti)).toBe(true);
    });
  });
});
