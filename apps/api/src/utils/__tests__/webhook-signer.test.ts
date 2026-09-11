import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateWebhookSignature,
  verifyWebhookSignature,
  verifyWebhookSignatureSync,
  generateWebhookSignatureKms,
  signWebhookPayload,
  configureKmsWebhookSigner,
  resetConfiguredKmsWebhookSigner,
  evaluateWebhookVerification,
  parseWebhookSignatureHeader,
} from '../webhook-signer';
import { createMockKmsHmacClient } from '../kms-signer';
import { NONCE_PREFIX } from '../../lib/nonceCache';

// ---------------------------------------------------------------------------
// Mock ioredis so these tests run without a real Redis connection
// ---------------------------------------------------------------------------
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
    on: vi.fn(),
  }));
  return { default: RedisMock };
});

vi.mock('../../lib/redis', async () => {
  const { default: Redis } = await import('ioredis');
  return { redis: new Redis() };
});

describe('Webhook HMAC Signer & Replay Prevention', () => {
  const payload = JSON.stringify({ event: 'payment.received', amount: '100.00', asset: 'XLM' });
  const secret = 'webhook_secret_key_9988776655';
  const uuidv4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  beforeEach(() => {
    mockStore.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetConfiguredKmsWebhookSigner();
  });

  describe('generateWebhookSignature', () => {
    it('should generate valid HMAC signature header with timestamp and nonce', () => {
      const timestamp = 1700000000000;
      const nonce = 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d';
      const result = generateWebhookSignature(payload, secret, timestamp, nonce);

      expect(result.timestamp).toBe(timestamp);
      expect(result.nonce).toBe(nonce);
      expect(result.signature).toHaveLength(64); // SHA256 hex length
      expect(result.headerValue).toBe(`t=${timestamp},n=${nonce},v1=${result.signature}`);
    });

    it('should automatically generate a UUIDv4 nonce if none is provided', () => {
      const result = generateWebhookSignature(payload, secret);

      expect(result.nonce).toBeDefined();
      expect(uuidv4Regex.test(result.nonce)).toBe(true);
      expect(result.headerValue).toContain(`n=${result.nonce}`);
      expect(result.headerValue).toContain(`t=${result.timestamp}`);
      expect(result.headerValue).toContain(`v1=${result.signature}`);
    });
  });

  describe('verifyWebhookSignature', () => {
    it('should verify valid signature header with fresh nonce', async () => {
      const now = Date.now();
      const result = generateWebhookSignature(payload, secret, now);

      const isValid = await verifyWebhookSignature(payload, result.headerValue, secret);
      expect(isValid).toBe(true);
    });

    it('should reject tampered payload', async () => {
      const now = Date.now();
      const result = generateWebhookSignature(payload, secret, now);

      const tamperedPayload = JSON.stringify({ event: 'payment.received', amount: '999.00', asset: 'XLM' });
      const isValid = await verifyWebhookSignature(tamperedPayload, result.headerValue, secret);
      expect(isValid).toBe(false);
    });

    it('should reject invalid secret', async () => {
      const now = Date.now();
      const result = generateWebhookSignature(payload, secret, now);

      const isValid = await verifyWebhookSignature(payload, result.headerValue, 'wrong_secret_key');
      expect(isValid).toBe(false);
    });

    describe('timestamp drift verification', () => {
      it('should reject requests older than 5 minutes (> 300000ms drift)', async () => {
        const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
        const result = generateWebhookSignature(payload, secret, sixMinutesAgo);

        const isValid = await verifyWebhookSignature(payload, result.headerValue, secret);
        expect(isValid).toBe(false);
      });

      it('should reject requests timestamped in the future beyond 5 minutes', async () => {
        const sixMinutesInFuture = Date.now() + 6 * 60 * 1000;
        const result = generateWebhookSignature(payload, secret, sixMinutesInFuture);

        const isValid = await verifyWebhookSignature(payload, result.headerValue, secret);
        expect(isValid).toBe(false);
      });

      it('should accept requests within 5-minute drift window', async () => {
        const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
        const result = generateWebhookSignature(payload, secret, twoMinutesAgo);

        const isValid = await verifyWebhookSignature(payload, result.headerValue, secret);
        expect(isValid).toBe(true);
      });

      it('should respect custom toleranceMs', async () => {
        const thirtySecondsAgo = Date.now() - 30 * 1000;
        const result = generateWebhookSignature(payload, secret, thirtySecondsAgo);

        // Tolerance of 10 seconds -> should fail
        const isRejected = await verifyWebhookSignature(payload, result.headerValue, secret, { toleranceMs: 10000 });
        expect(isRejected).toBe(false);

        // Tolerance of 60 seconds -> should pass
        const isAccepted = await verifyWebhookSignature(payload, result.headerValue, secret, { toleranceMs: 60000 });
        expect(isAccepted).toBe(true);
      });
    });

    describe('replay attack prevention', () => {
      it('should reject replayed webhook request with existing nonce', async () => {
        const now = Date.now();
        const nonce = 'replay-test-nonce-1234';
        const result = generateWebhookSignature(payload, secret, now, nonce);

        // First delivery: should succeed and record nonce
        const firstAttempt = await verifyWebhookSignature(payload, result.headerValue, secret);
        expect(firstAttempt).toBe(true);
        expect(mockStore.has(`${NONCE_PREFIX}${nonce}`)).toBe(true);

        // Replay delivery: should be rejected
        const replayAttempt = await verifyWebhookSignature(payload, result.headerValue, secret);
        expect(replayAttempt).toBe(false);
      });

      it('should allow multiple requests with different nonces', async () => {
        const now = Date.now();
        const result1 = generateWebhookSignature(payload, secret, now);
        const result2 = generateWebhookSignature(payload, secret, now);

        expect(await verifyWebhookSignature(payload, result1.headerValue, secret)).toBe(true);
        expect(await verifyWebhookSignature(payload, result2.headerValue, secret)).toBe(true);
      });

      it('should allow replay if checkReplay option is false', async () => {
        const now = Date.now();
        const nonce = 'no-replay-check-nonce';
        const result = generateWebhookSignature(payload, secret, now, nonce);

        const first = await verifyWebhookSignature(payload, result.headerValue, secret, { checkReplay: false });
        expect(first).toBe(true);

        const second = await verifyWebhookSignature(payload, result.headerValue, secret, { checkReplay: false });
        expect(second).toBe(true);
      });
    });

    describe('malformed header handling', () => {
      it('should reject empty or missing headers', async () => {
        expect(await verifyWebhookSignature(payload, '', secret)).toBe(false);
        expect(await verifyWebhookSignature(payload, 'invalid_header', secret)).toBe(false);
      });

      it('should reject headers with invalid timestamp format', async () => {
        const header = `t=invalid_timestamp,n=123,v1=abc`;
        expect(await verifyWebhookSignature(payload, header, secret)).toBe(false);
      });

      it('should map malformed headers to HTTP 400 via evaluateWebhookVerification', () => {
        expect(evaluateWebhookVerification(payload, '', secret).status).toBe(400);
        expect(evaluateWebhookVerification(payload, 'invalid_header', secret).status).toBe(400);
        expect(evaluateWebhookVerification(payload, 't=abc,v1=short', secret).status).toBe(400);
      });

      it('should map invalid signatures to HTTP 401 via evaluateWebhookVerification', () => {
        const now = Date.now();
        const result = generateWebhookSignature(payload, secret, now);
        const evaluation = evaluateWebhookVerification(payload, result.headerValue, 'wrong_secret');
        expect(evaluation.status).toBe(401);
        expect(evaluation.valid).toBe(false);
      });

      it('should parse valid webhook signature headers', () => {
        const now = Date.now();
        const result = generateWebhookSignature(payload, secret, now);
        const parsed = parseWebhookSignatureHeader(result.headerValue);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
          expect(parsed.parsed.timestamp).toBe(now);
          expect(parsed.parsed.signature).toHaveLength(64);
        }
      });
    });
  });

  describe('verifyWebhookSignatureSync', () => {
    it('should synchronously verify valid signature and timestamp', () => {
      const now = Date.now();
      const result = generateWebhookSignature(payload, secret, now);

      const isValid = verifyWebhookSignatureSync(payload, result.headerValue, secret);
      expect(isValid).toBe(true);
    });

    it('should synchronously reject expired timestamp', () => {
      const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
      const result = generateWebhookSignature(payload, secret, tenMinutesAgo);

      const isValid = verifyWebhookSignatureSync(payload, result.headerValue, secret);
      expect(isValid).toBe(false);
    });

    it('should synchronously reject tampered payload', () => {
      const now = Date.now();
      const result = generateWebhookSignature(payload, secret, now);

      const isValid = verifyWebhookSignatureSync('{"tampered":true}', result.headerValue, secret);
      expect(isValid).toBe(false);
    });
  });

  describe('KMS-backed webhook signing (#189)', () => {
    const kmsEnv = {
      KMS_WEBHOOK_SIGNING_ENABLED: 'true',
      KMS_PROVIDER: 'aws',
      KMS_PRIMARY_KEY_ID: 'arn:aws:kms:us-east-1:123456789012:key/webhook-primary',
      KMS_PREVIOUS_KEY_IDS: 'arn:aws:kms:us-east-1:123456789012:key/webhook-previous',
    };

    it('should sign webhook payloads through the configured KMS signer without using local secrets', async () => {
      const kmsSigner = configureKmsWebhookSigner(createMockKmsHmacClient('webhook-kms-test'), kmsEnv);
      expect(kmsSigner).not.toBeNull();

      const signed = await generateWebhookSignatureKms(payload, kmsSigner!, Date.now(), 'kms-nonce-1');
      expect(signed.signature).toHaveLength(64);
      expect(signed.headerValue).toContain('v1=');
    });

    it('should verify KMS-signed webhook headers using the mocked KMS client', async () => {
      const kmsSigner = configureKmsWebhookSigner(createMockKmsHmacClient('webhook-kms-test'), kmsEnv)!;
      const now = Date.now();
      const signed = await generateWebhookSignatureKms(payload, kmsSigner, now);

      const isValid = await verifyWebhookSignature(payload, signed.headerValue, 'unused-secret', {
        kmsSigner,
        checkReplay: false,
      });
      expect(isValid).toBe(true);
    });

    it('should route signWebhookPayload through KMS when a signer is configured', async () => {
      configureKmsWebhookSigner(createMockKmsHmacClient('webhook-kms-test'), kmsEnv);
      const signed = await signWebhookPayload(payload);

      expect(signed.signature).toHaveLength(64);
      expect(signed.headerValue).toContain('n=');
    });

    it('should fall back to local signing when KMS is disabled', async () => {
      resetConfiguredKmsWebhookSigner();
      const signed = await signWebhookPayload(payload, { secret });

      expect(signed.signature).toHaveLength(64);
      expect(signed.headerValue).toContain(`v1=${signed.signature}`);
    });
  });
});
