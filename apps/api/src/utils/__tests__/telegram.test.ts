import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  validateTelegramInitData,
  buildDataCheckString,
  TelegramInitDataError,
} from '../telegram';

const BOT_TOKEN = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';

/** Re-implements Telegram's signing scheme so tests can mint valid initData. */
function signInitData(fields: Record<string, string>, botToken = BOT_TOKEN): string {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.keys()]
    .sort()
    .map((key) => `${key}=${params.get(key)}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

const baseFields = () => ({
  query_id: 'AAExampleQueryId',
  user: JSON.stringify({ id: 279058397, first_name: 'Vlad', username: 'vladexample' }),
  auth_date: String(nowSeconds()),
});

describe('buildDataCheckString', () => {
  it('sorts keys alphabetically and omits the hash field', () => {
    const params = new URLSearchParams({ c: '3', a: '1', b: '2', hash: 'deadbeef' });
    expect(buildDataCheckString(params)).toBe('a=1\nb=2\nc=3');
  });
});

describe('validateTelegramInitData', () => {
  it('accepts a correctly signed payload and returns decoded fields', () => {
    const initData = signInitData(baseFields());
    const result = validateTelegramInitData(initData, BOT_TOKEN);

    expect(result.user?.id).toBe(279058397);
    expect(result.user?.username).toBe('vladexample');
    expect(result.query_id).toBe('AAExampleQueryId');
    expect(result.auth_date).toBeGreaterThan(0);
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a payload whose fields were tampered with after signing', () => {
    const initData = signInitData(baseFields());
    const tampered = new URLSearchParams(initData);
    tampered.set('user', JSON.stringify({ id: 1, first_name: 'Mallory' }));

    expect(() => validateTelegramInitData(tampered.toString(), BOT_TOKEN)).toThrowError(
      /signature does not match/i,
    );
    try {
      validateTelegramInitData(tampered.toString(), BOT_TOKEN);
    } catch (err) {
      expect(err).toBeInstanceOf(TelegramInitDataError);
      expect((err as TelegramInitDataError).code).toBe('INVALID_SIGNATURE');
    }
  });

  it('rejects a payload signed with a different bot token', () => {
    const initData = signInitData(baseFields(), 'someone-elses-token');
    expect(() => validateTelegramInitData(initData, BOT_TOKEN)).toThrowError(
      new RegExp('signature'),
    );
  });

  it('throws MISSING_HASH when the hash field is absent', () => {
    const params = new URLSearchParams(baseFields());
    try {
      validateTelegramInitData(params.toString(), BOT_TOKEN);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as TelegramInitDataError).code).toBe('MISSING_HASH');
    }
  });

  it('throws MALFORMED for empty init data or a missing bot token', () => {
    expect(() => validateTelegramInitData('', BOT_TOKEN)).toThrowError(TelegramInitDataError);
    const initData = signInitData(baseFields());
    try {
      validateTelegramInitData(initData, '');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as TelegramInitDataError).code).toBe('MALFORMED');
    }
  });

  it('throws MALFORMED when the user field is not valid JSON', () => {
    const initData = signInitData({ ...baseFields(), user: 'not-json{' });
    try {
      validateTelegramInitData(initData, BOT_TOKEN);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as TelegramInitDataError).code).toBe('MALFORMED');
    }
  });

  it('enforces the auth_date freshness window', () => {
    const stale = signInitData({
      ...baseFields(),
      auth_date: String(nowSeconds() - 60 * 60 * 48), // 48h ago
    });

    try {
      validateTelegramInitData(stale, BOT_TOKEN, { maxAgeSeconds: 86400 });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as TelegramInitDataError).code).toBe('EXPIRED');
    }

    // Freshness check disabled -> stale data is accepted.
    expect(validateTelegramInitData(stale, BOT_TOKEN, { maxAgeSeconds: 0 }).user?.id).toBe(
      279058397,
    );
  });

  it('uses the injected clock for the freshness check', () => {
    const authDate = 1_700_000_000;
    const initData = signInitData({ ...baseFields(), auth_date: String(authDate) });

    // "now" is 10 minutes after auth_date -> within a 1h window.
    const result = validateTelegramInitData(initData, BOT_TOKEN, {
      maxAgeSeconds: 3600,
      now: () => (authDate + 600) * 1000,
    });
    expect(result.auth_date).toBe(authDate);
  });
});
