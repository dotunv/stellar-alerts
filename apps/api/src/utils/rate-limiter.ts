const DEFAULT_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 5 * 60_000;

type HeaderReader = Pick<Headers, "get"> | Record<string, string | number | null | undefined>;

function readHeader(headers: HeaderReader | undefined, name: string): string | null {
  if (!headers) return null;

  if (typeof (headers as Pick<Headers, "get">).get === "function") {
    return (headers as Pick<Headers, "get">).get(name);
  }

  const record = headers as Record<string, string | number | null | undefined>;
  const value = record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()];
  return value === null || value === undefined ? null : String(value);
}

function clampDelay(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_BACKOFF_MS;
  return Math.min(Math.ceil(ms), MAX_BACKOFF_MS);
}

export function parseRetryAfterMs(value: string | null, nowMs = Date.now()): number | null {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return clampDelay(seconds * 1000);
  }

  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) return null;
  return clampDelay(retryAt - nowMs);
}

export function parseRateLimitResetMs(value: string | null, nowMs = Date.now()): number | null {
  if (!value) return null;

  const reset = Number(value);
  if (!Number.isFinite(reset)) return null;

  const resetMs = reset > 10_000_000_000 ? reset : reset * 1000;
  return clampDelay(resetMs - nowMs);
}

export function getAdaptiveBackoffMs(headers: HeaderReader | undefined, nowMs = Date.now()): number {
  const retryAfterMs = parseRetryAfterMs(readHeader(headers, "retry-after"), nowMs);
  if (retryAfterMs !== null) return retryAfterMs;

  const remaining = readHeader(headers, "x-ratelimit-remaining");
  const resetMs = parseRateLimitResetMs(readHeader(headers, "x-ratelimit-reset"), nowMs);
  if (remaining === "0" && resetMs !== null) return resetMs;

  return DEFAULT_BACKOFF_MS;
}

export function getRateLimitDomain(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export class AdaptiveWebhookRateLimiter {
  private readonly pausedUntilByDomain = new Map<string, number>();

  getDelayMs(url: string, nowMs = Date.now()): number {
    const pausedUntil = this.pausedUntilByDomain.get(getRateLimitDomain(url));
    if (!pausedUntil) return 0;

    const delayMs = pausedUntil - nowMs;
    if (delayMs <= 0) {
      this.pausedUntilByDomain.delete(getRateLimitDomain(url));
      return 0;
    }

    return delayMs;
  }

  recordRateLimit(url: string, headers: HeaderReader | undefined, nowMs = Date.now()): number {
    const delayMs = getAdaptiveBackoffMs(headers, nowMs);
    this.pausedUntilByDomain.set(getRateLimitDomain(url), nowMs + delayMs);
    return delayMs;
  }

  clear(url: string): void {
    this.pausedUntilByDomain.delete(getRateLimitDomain(url));
  }
}

export const adaptiveWebhookRateLimiter = new AdaptiveWebhookRateLimiter();
export const waitForAdaptiveBackoff = (delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs));