import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import {
  generateWebhookSignature,
  verifyWebhookSignature,
  verifyWebhookSignatureSync,
  evaluateWebhookVerification,
  parseWebhookSignatureHeader,
  MAX_WEBHOOK_HEADER_LENGTH,
  MAX_WEBHOOK_PAYLOAD_LENGTH,
} from '../webhook-signer';

// ---------------------------------------------------------------------------
// Mock ioredis so fuzz tests run without a real Redis connection
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

const SQL_INJECTION_PAYLOADS = [
  "' OR 1=1--",
  "1; DROP TABLE users;",
  "' UNION SELECT * FROM secrets--",
  "admin'--",
  "1' AND '1'='1",
  "'; EXEC xp_cmdshell('dir');--",
];

const XSS_PAYLOADS = [
  '<script>alert(1)</script>',
  '"><img src=x onerror=alert(1)>',
  "javascript:alert('xss')",
  '<svg/onload=alert(1)>',
  '\"><iframe src=javascript:alert(1)>',
];

const HEADER_INJECTION_PAYLOADS = [
  't=1700000000000,v1=abc\r\nX-Injected: true',
  't=1700000000000,n=test,v1=abc\x00deadbeef',
  't=1700000000000,n=test,v1=' + 'a'.repeat(128),
  't=not-a-number,n=test,v1=' + 'f'.repeat(64),
  't=1700000000000,n=test,v1=' + 'zz'.repeat(32),
  'invalid_header_without_fields',
  't=1700000000000,n=test',
  'v1=' + 'a'.repeat(64),
  '',
  't=1700000000000,n=test,v1=abc,extra=evil',
];

function mutateValidHeader(baseHeader: string): string {
  const mutations = [
    () => baseHeader.replace('v1=', 'v2='),
    () => baseHeader.replace(',', ';'),
    () => `${baseHeader},spoofed=v1`,
    () => baseHeader.slice(0, Math.max(0, baseHeader.length - 5)),
    () => `${baseHeader}${'X'.repeat(32)}`,
    () => baseHeader.toUpperCase(),
    () => baseHeader.replace(/[0-9]/g, 'x'),
  ];

  return mutations[Math.floor(Math.random() * mutations.length)]();
}

const payloadArbitrary = fc.oneof(
  fc.string({ maxLength: 4096 }),
  fc.fullUnicodeString({ maxLength: 2048 }),
  fc.constantFrom(...SQL_INJECTION_PAYLOADS, ...XSS_PAYLOADS),
  fc.uint8Array({ minLength: 0, maxLength: 512 }).map((bytes) => Buffer.from(bytes).toString('utf8')),
  fc.constant(''),
  fc.constant(JSON.stringify({ event: 'payment.received', amount: '100.00', asset: 'XLM' }))
);

const headerArbitrary = fc.oneof(
  fc.string({ maxLength: MAX_WEBHOOK_HEADER_LENGTH + 128 }),
  fc.fullUnicodeString({ maxLength: 2048 }),
  fc.constantFrom(...HEADER_INJECTION_PAYLOADS),
  fc.tuple(fc.integer({ min: 1_600_000_000_000, max: 2_000_000_000_000 }), fc.uuid(), fc.hexaString({ minLength: 64, maxLength: 64 }))
    .map(([timestamp, nonce, signature]) => `t=${timestamp},n=${nonce},v1=${signature}`),
  fc.tuple(fc.integer({ min: 1_600_000_000_000, max: 2_000_000_000_000 }), fc.hexaString({ minLength: 64, maxLength: 64 }))
    .map(([timestamp, signature]) => `t=${timestamp},v1=${signature}`)
);

const secretArbitrary = fc.oneof(
  fc.string({ minLength: 1, maxLength: 256 }),
  fc.constant('webhook_secret_key_9988776655')
);

describe(
  'Webhook Penetration Testing Fuzzer (#188)',
  () => {
  const secret = 'webhook_secret_key_9988776655';
  const basePayload = JSON.stringify({ event: 'payment.received', amount: '100.00', asset: 'XLM' });

  beforeEach(() => {
    mockStore.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it(
    'survives 10,000 randomized payload and header mutations without uncaught exceptions (sync)',
    () => {
      fc.assert(
        fc.property(payloadArbitrary, headerArbitrary, secretArbitrary, (payload, header, fuzzSecret) => {
          expect(() => verifyWebhookSignatureSync(payload, header, fuzzSecret)).not.toThrow();
          expect(() => evaluateWebhookVerification(payload, header, fuzzSecret)).not.toThrow();
          expect(() => parseWebhookSignatureHeader(header)).not.toThrow();
        }),
        { numRuns: 10_000 }
      );
    },
    120_000
  );

  it(
    'survives async verification across 1,000 randomized payload mutations without uncaught exceptions',
    async () => {
      await fc.assert(
        fc.asyncProperty(payloadArbitrary, headerArbitrary, secretArbitrary, async (payload, header, fuzzSecret) => {
          await expect(verifyWebhookSignature(payload, header, fuzzSecret, { checkReplay: false })).resolves.toBeTypeOf(
            'boolean'
          );
        }),
        { numRuns: 1_000 }
      );
    },
    60_000
  );

  it('returns HTTP 400 for malformed headers across fuzzed boundary cases', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(...HEADER_INJECTION_PAYLOADS),
          fc.string({ maxLength: MAX_WEBHOOK_HEADER_LENGTH + 256 }),
          fc
            .tuple(fc.string(), fc.string(), fc.string())
            .map(([a, b, c]) => `${a},${b},${c},unexpected=${c}`)
        ),
        (header) => {
          const result = evaluateWebhookVerification(basePayload, header, secret);
          const parsed = parseWebhookSignatureHeader(header);

          if (!parsed.ok) {
            expect(result.status).toBe(400);
            expect(result.valid).toBe(false);
          }
        }
      ),
      { numRuns: 2_000 }
    );
  });

  it('rejects SQL/XSS payload boundaries without throwing', () => {
    const now = Date.now();
    const signed = generateWebhookSignature(basePayload, secret, now);

    for (const injection of [...SQL_INJECTION_PAYLOADS, ...XSS_PAYLOADS]) {
      const tamperedPayload = `${basePayload}${injection}`;
      expect(() => verifyWebhookSignatureSync(tamperedPayload, signed.headerValue, secret)).not.toThrow();
      expect(verifyWebhookSignatureSync(tamperedPayload, signed.headerValue, secret)).toBe(false);
    }
  });

  it('rejects mutated HMAC headers without throwing', () => {
    const now = Date.now();
    const signed = generateWebhookSignature(basePayload, secret, now);

    for (let i = 0; i < 250; i += 1) {
      const mutatedHeader = mutateValidHeader(signed.headerValue);
      expect(() => verifyWebhookSignatureSync(basePayload, mutatedHeader, secret)).not.toThrow();
      expect(() => evaluateWebhookVerification(basePayload, mutatedHeader, secret)).not.toThrow();
    }
  });

  it('accepts valid signatures with HTTP 200 and rejects invalid signatures with HTTP 401', () => {
    const now = Date.now();
    const signed = generateWebhookSignature(basePayload, secret, now);

    const valid = evaluateWebhookVerification(basePayload, signed.headerValue, secret);
    expect(valid.status).toBe(200);
    expect(valid.valid).toBe(true);

    const invalid = evaluateWebhookVerification(basePayload, signed.headerValue, `${secret}-wrong`);
    expect(invalid.status).toBe(401);
    expect(invalid.valid).toBe(false);
  });

  it('rejects oversized payloads with HTTP 400', () => {
    const oversizedPayload = 'A'.repeat(MAX_WEBHOOK_PAYLOAD_LENGTH + 1);
    const now = Date.now();
    const signed = generateWebhookSignature('small-payload', secret, now);

    const result = evaluateWebhookVerification(oversizedPayload, signed.headerValue, secret);
    expect(result.status).toBe(400);
    expect(result.valid).toBe(false);
  });
  },
  180_000
);
