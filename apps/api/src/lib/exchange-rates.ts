import { redis } from './redis';

const CACHE_KEY_PREFIX = 'exchange_rates:';
const CACHE_TTL_SECONDS = 3600; // 1 hour

const SUPPORTED_FIAT_CURRENCIES = ['USD', 'EUR', 'CAD', 'JPY', 'GBP', 'AUD'] as const;
export type SupportedFiatCurrency = (typeof SUPPORTED_FIAT_CURRENCIES)[number];

/**
 * Fetches exchange rates from exchangerate-api.com (free tier, no key required).
 * Rates are base USD → target currency.
 */
async function fetchExchangeRates(): Promise<Record<string, number>> {
  const response = await fetch('https://open.er-api.com/v6/latest/USD');
  if (!response.ok) {
    throw new Error(`Failed to fetch exchange rates: ${response.status} ${response.statusText}`);
  }
  const data = await response.json() as { rates: Record<string, number>; time_last_update_utc: string };
  return data.rates;
}

/**
 * Gets cached exchange rates from Redis, or fetches fresh ones if cache is missing/expired.
 * Returns rates as USD → target currency.
 */
export async function getExchangeRates(): Promise<Record<string, number>> {
  const cacheKey = `${CACHE_KEY_PREFIX}latest`;
  const cached = await redis.get(cacheKey);

  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // Cache corruption, fetch fresh
    }
  }

  const rates = await fetchExchangeRates();
  await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(rates));
  return rates;
}

/**
 * Converts an amount from USD to the target fiat currency using cached exchange rates.
 * If the currency is not supported or rates are unavailable, returns the original USD amount.
 */
export async function convertUsdToFiat(
  amountUsd: number,
  targetCurrency: SupportedFiatCurrency,
): Promise<{ convertedAmount: number; rate: number; currency: string }> {
  if (targetCurrency === 'USD') {
    return { convertedAmount: amountUsd, rate: 1, currency: 'USD' };
  }

  const rates = await getExchangeRates();
  const rate = rates[targetCurrency];

  if (!rate || typeof rate !== 'number') {
    console.warn(`[ExchangeRates] No rate found for ${targetCurrency}, falling back to USD`);
    return { convertedAmount: amountUsd, rate: 1, currency: 'USD' };
  }

  const convertedAmount = Math.round(amountUsd * rate * 100) / 100;
  return { convertedAmount, rate, currency: targetCurrency };
}

export function isSupportedFiatCurrency(currency: string): currency is SupportedFiatCurrency {
  return (SUPPORTED_FIAT_CURRENCIES as readonly string[]).includes(currency);
}

export { SUPPORTED_FIAT_CURRENCIES };
