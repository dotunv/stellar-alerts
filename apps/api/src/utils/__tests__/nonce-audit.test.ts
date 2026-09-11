import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  NonceAuditManager,
  nonceAuditManager,
  checkEventNonceReplay,
  logReplayAttempt,
  NONCE_AUDIT_PREFIX,
  DEFAULT_NONCE_TTL_SECONDS,
} from '../nonce-audit';
import { prisma } from '../../lib/prisma';

// Mock Redis storage
const mockRedisStore = new Map<string, string>();

vi.mock('ioredis', () => {
  const RedisMock = vi.fn().mockImplementation(() => ({
    set: vi.fn(async (key: string, value: string, ...rest: any[]) => {
      const hasNx = rest.some((arg) => typeof arg === 'string' && arg.toUpperCase() === 'NX');
      if (hasNx && mockRedisStore.has(key)) {
        return null;
      }
      mockRedisStore.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => mockRedisStore.get(key) ?? null),
    on: vi.fn(),
  }));
  return { default: RedisMock };
});

vi.mock('../../lib/redis', async () => {
  const { default: Redis } = await import('ioredis');
  return { redis: new Redis() };
});

vi.mock('../../lib/prisma', () => ({
  prisma: {
    securityAuditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit-log-1' }),
    },
    securityAudit: {
      create: vi.fn().mockResolvedValue({ id: 'audit-log-2' }),
    },
  },
}));

describe('NonceAuditManager & Event Nonce Replay Guard', () => {
  let auditManager: NonceAuditManager;
  let mockRedisClient: any;

  beforeEach(() => {
    mockRedisStore.clear();
    vi.clearAllMocks();
    mockRedisClient = {
      set: vi.fn(async (key: string, value: string, ...rest: any[]) => {
        const hasNx = rest.some((arg) => typeof arg === 'string' && arg.toUpperCase() === 'NX');
        if (hasNx && mockRedisStore.has(key)) {
          return null;
        }
        mockRedisStore.set(key, value);
        return 'OK';
      }),
      get: vi.fn(async (key: string) => mockRedisStore.get(key) ?? null),
    };
    auditManager = new NonceAuditManager(mockRedisClient as any, 3600);
  });

  describe('buildKey', () => {
    it('constructs correct Redis key from txHash, topic, and sequence nonce', () => {
      const key = auditManager.buildKey('0xtx123', 'transfer', 100);
      expect(key).toBe(`${NONCE_AUDIT_PREFIX}0xtx123:transfer:100`);
    });

    it('uses default values when topic or sequence are omitted', () => {
      const key = auditManager.buildKey('0xtx123');
      expect(key).toBe(`${NONCE_AUDIT_PREFIX}0xtx123:default:0`);
    });
  });

  describe('validateAndRecordNonce', () => {
    it('allows a new event nonce pair and stores key in Redis', async () => {
      const result = await auditManager.validateAndRecordNonce({
        txHash: '0xtx100',
        topic: 'transfer',
        sequence: 500,
        contractId: 'C12345',
      });

      expect(result).toBe(true);
      expect(mockRedisStore.has(`${NONCE_AUDIT_PREFIX}0xtx100:transfer:500`)).toBe(true);
      expect(prisma.securityAuditLog.create).not.toHaveBeenCalled();
    });

    it('rejects duplicate event topic sharing identical transaction hash and sequence nonce', async () => {
      const input = {
        txHash: '0xtx100',
        topic: 'transfer',
        sequence: 500,
        contractId: 'C12345',
      };

      // First run: succeeds
      const first = await auditManager.validateAndRecordNonce(input);
      expect(first).toBe(true);

      // Replay attempt: rejected
      const replay = await auditManager.validateAndRecordNonce(input);
      expect(replay).toBe(false);

      // Verify security audit log was created
      expect(prisma.securityAuditLog.create).toHaveBeenCalledTimes(1);
      expect(prisma.securityAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'EVENT_REPLAY_ATTEMPT',
          txHash: '0xtx100',
          topic: 'transfer',
          sequence: '500',
          contractId: 'C12345',
          severity: 'HIGH',
        }),
      });
    });

    it('allows identical transaction hash with different topic names', async () => {
      const txHash = '0xtx200';
      const seq = 10;

      const transferResult = await auditManager.validateAndRecordNonce({
        txHash,
        topic: 'transfer',
        sequence: seq,
      });

      const mintResult = await auditManager.validateAndRecordNonce({
        txHash,
        topic: 'mint',
        sequence: seq,
      });

      expect(transferResult).toBe(true);
      expect(mintResult).toBe(true);
    });

    it('allows identical transaction hash and topic with different sequence nonces', async () => {
      const txHash = '0xtx300';
      const topic = 'swap';

      const seq1Result = await auditManager.validateAndRecordNonce({
        txHash,
        topic,
        sequence: 1,
      });

      const seq2Result = await auditManager.validateAndRecordNonce({
        txHash,
        topic,
        sequence: 2,
      });

      expect(seq1Result).toBe(true);
      expect(seq2Result).toBe(true);
    });
  });

  describe('isDuplicate', () => {
    it('returns false for unseen nonce pair and true for recorded pair', async () => {
      const txHash = '0xtx400';
      const topic = 'burn';
      const sequence = 99;

      expect(await auditManager.isDuplicate(txHash, topic, sequence)).toBe(false);

      await auditManager.validateAndRecordNonce({ txHash, topic, sequence });

      expect(await auditManager.isDuplicate(txHash, topic, sequence)).toBe(true);
    });
  });

  describe('checkEventNonceReplay helper', () => {
    it('works as a standalone helper function', async () => {
      const first = await checkEventNonceReplay('0xtx500', 'approval', 1, 'CCONTRACT');
      expect(first).toBe(true);

      const second = await checkEventNonceReplay('0xtx500', 'approval', 1, 'CCONTRACT');
      expect(second).toBe(false);
    });
  });

  describe('logReplayAttempt', () => {
    it('records security audit log entry in database', async () => {
      await logReplayAttempt({
        txHash: '0xtx600',
        topic: 'deposit',
        sequence: 77,
        contractId: 'CPOOL',
        details: { reason: 'Test replay alert' },
      });

      expect(prisma.securityAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'EVENT_REPLAY_ATTEMPT',
          txHash: '0xtx600',
          topic: 'deposit',
          sequence: '77',
          contractId: 'CPOOL',
          severity: 'HIGH',
        }),
      });
    });
  });
});
