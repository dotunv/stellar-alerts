/**
 * Pure helpers for the Telegram Mini App view. No DOM / SDK access here so the
 * auth-response handling can be unit-tested in isolation.
 */

export interface TmaAuthResult {
  token: string;
  email: string;
  telegramName: string;
  telegramId: number | null;
}

const ERROR_COPY: Record<string, string> = {
  MISSING_HASH: 'This launch link is incomplete. Please reopen the Mini App from Telegram.',
  MALFORMED: 'Telegram sent data we could not read. Try reopening the Mini App.',
  INVALID_SIGNATURE:
    'We could not verify this session came from Telegram. Please reopen the Mini App.',
  EXPIRED: 'This Telegram session has expired. Reopen the Mini App to continue.',
};

export function friendlyTelegramError(code?: string | null): string {
  if (code && ERROR_COPY[code]) return ERROR_COPY[code];
  return 'Telegram sign-in failed. Please reopen the Mini App from your chat.';
}

export function telegramDisplayName(user: {
  first_name?: string;
  last_name?: string;
  username?: string;
} | null | undefined): string {
  if (!user) return 'Telegram user';
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return full || user.username || 'Telegram user';
}

/**
 * Normalises the `/auth/telegram` response into a {@link TmaAuthResult}, or
 * throws an `Error` carrying user-facing copy when the request did not succeed.
 */
export function parseTelegramAuthResponse(status: number, body: unknown): TmaAuthResult {
  const data = (body ?? {}) as Record<string, unknown>;
  const user = data.user as { email?: unknown } | undefined;
  const telegram = data.telegram as { id?: unknown; first_name?: string; last_name?: string; username?: string } | undefined;
  const ok = status >= 200 && status < 300 && data.success === true && typeof data.token === 'string';

  if (!ok) {
    throw new Error(friendlyTelegramError(typeof data.code === 'string' ? data.code : null));
  }

  const tg = telegram ?? {};
  return {
    token: data.token as string,
    email: typeof user?.email === 'string' ? user.email : '',
    telegramName: telegramDisplayName(tg),
    telegramId: typeof tg.id === 'number' ? tg.id : null,
  };
}

/** Shortens a Stellar public key for display: `GABC…WXYZ`. */
export function shortKey(publicKey: string): string {
  if (!publicKey || publicKey.length <= 12) return publicKey;
  return `${publicKey.slice(0, 4)}…${publicKey.slice(-4)}`;
}
