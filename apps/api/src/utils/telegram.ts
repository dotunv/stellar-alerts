import crypto from 'crypto';

/**
 * Validation of Telegram Mini App `initData` per
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 *   secret_key = HMAC_SHA256(key = "WebAppData", message = <bot_token>)
 *   hash       = HMAC_SHA256(key = secret_key,   message = data_check_string)
 *
 * `data_check_string` is every field except `hash`, formatted as `key=value`,
 * sorted alphabetically by key and joined with `\n`.
 */

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  is_bot?: boolean;
  photo_url?: string;
}

export interface TelegramInitData {
  user?: TelegramUser;
  receiver?: TelegramUser;
  auth_date: number;
  query_id?: string;
  start_param?: string;
  chat_type?: string;
  chat_instance?: string;
  hash: string;
}

export type TelegramInitDataErrorCode =
  | 'MALFORMED'
  | 'MISSING_HASH'
  | 'INVALID_SIGNATURE'
  | 'EXPIRED';

export class TelegramInitDataError extends Error {
  code: TelegramInitDataErrorCode;

  constructor(code: TelegramInitDataErrorCode, message: string) {
    super(message);
    this.name = 'TelegramInitDataError';
    this.code = code;
  }
}

export interface ValidateInitDataOptions {
  /**
   * Reject data whose `auth_date` is older than this many seconds.
   * Defaults to 86400 (24h). Pass `0` to disable the freshness check.
   */
  maxAgeSeconds?: number;
  /** Injectable clock (ms since epoch) for deterministic tests. */
  now?: () => number;
}

/** Builds the canonical `data_check_string` from a parsed init-data query. */
export function buildDataCheckString(params: URLSearchParams): string {
  return [...params.keys()]
    .filter((key) => key !== 'hash')
    .sort()
    .map((key) => `${key}=${params.get(key)}`)
    .join('\n');
}

/**
 * Verifies the HMAC-SHA256 signature of a Telegram Mini App `initData` string
 * and returns its decoded fields. Throws {@link TelegramInitDataError} on any
 * failure (malformed input, missing/!matching hash, or stale `auth_date`).
 */
export function validateTelegramInitData(
  initData: string,
  botToken: string,
  options: ValidateInitDataOptions = {},
): TelegramInitData {
  if (typeof initData !== 'string' || initData.trim() === '') {
    throw new TelegramInitDataError('MALFORMED', 'initData must be a non-empty string');
  }
  if (typeof botToken !== 'string' || botToken === '') {
    throw new TelegramInitDataError('MALFORMED', 'botToken is required to validate initData');
  }

  const params = new URLSearchParams(initData);

  const hash = params.get('hash');
  if (!hash) {
    throw new TelegramInitDataError('MISSING_HASH', 'initData is missing the "hash" field');
  }
  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    throw new TelegramInitDataError('MALFORMED', 'initData "hash" is not a SHA-256 hex digest');
  }

  const dataCheckString = buildDataCheckString(params);
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const expected = Buffer.from(expectedHash, 'hex');
  const received = Buffer.from(hash.toLowerCase(), 'hex');
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    throw new TelegramInitDataError(
      'INVALID_SIGNATURE',
      'initData signature does not match the expected HMAC-SHA256 hash',
    );
  }

  const authDateRaw = params.get('auth_date');
  const authDate = Number(authDateRaw);
  if (!authDateRaw || !Number.isInteger(authDate) || authDate <= 0) {
    throw new TelegramInitDataError('MALFORMED', 'initData has a missing or invalid "auth_date"');
  }

  const maxAgeSeconds = options.maxAgeSeconds ?? 86400;
  if (maxAgeSeconds > 0) {
    const nowSeconds = Math.floor((options.now ? options.now() : Date.now()) / 1000);
    if (nowSeconds - authDate > maxAgeSeconds) {
      throw new TelegramInitDataError(
        'EXPIRED',
        `initData is older than the ${maxAgeSeconds}s freshness window`,
      );
    }
  }

  return {
    user: parseJsonField(params.get('user'), 'user'),
    receiver: parseJsonField(params.get('receiver'), 'receiver'),
    auth_date: authDate,
    query_id: params.get('query_id') ?? undefined,
    start_param: params.get('start_param') ?? undefined,
    chat_type: params.get('chat_type') ?? undefined,
    chat_instance: params.get('chat_instance') ?? undefined,
    hash,
  };
}

function parseJsonField(raw: string | null, field: string): TelegramUser | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as TelegramUser;
  } catch {
    throw new TelegramInitDataError('MALFORMED', `initData "${field}" field is not valid JSON`);
  }
}
