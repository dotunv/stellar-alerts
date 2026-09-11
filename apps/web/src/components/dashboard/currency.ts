export type FiatCurrencyCode = 'USD' | 'EUR' | 'BRL';
export type CurrencyCode = 'XLM' | FiatCurrencyCode;

export interface CurrencyOption {
  code: CurrencyCode;
  label: string;
  symbol: string;
}

export const CURRENCY_OPTIONS: CurrencyOption[] = [
  { code: 'XLM', label: 'XLM', symbol: 'XLM' },
  { code: 'USD', label: 'USD', symbol: '$' },
  { code: 'EUR', label: 'EUR', symbol: 'EUR' },
  { code: 'BRL', label: 'BRL', symbol: 'R$' },
];

export const FALLBACK_XLM_RATES: Record<CurrencyCode, number> = {
  XLM: 1,
  USD: 0.12,
  EUR: 0.11,
  BRL: 0.65,
};

type CoinGeckoSimplePrice = {
  stellar?: Partial<Record<Lowercase<FiatCurrencyCode>, number>>;
};

function normalizeRate(value: unknown, fallback: number): number {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : fallback;
}

export async function fetchXlmFiatRates(
  fetcher: typeof fetch = fetch
): Promise<Record<CurrencyCode, number>> {
  const response = await fetcher(
    'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd,eur,brl'
  );

  if (!response.ok) {
    throw new Error(`CoinGecko rate request failed with ${response.status}`);
  }

  const data = (await response.json()) as CoinGeckoSimplePrice;

  return {
    XLM: 1,
    USD: normalizeRate(data.stellar?.usd, FALLBACK_XLM_RATES.USD),
    EUR: normalizeRate(data.stellar?.eur, FALLBACK_XLM_RATES.EUR),
    BRL: normalizeRate(data.stellar?.brl, FALLBACK_XLM_RATES.BRL),
  };
}

export function convertXlmAmount(
  amountXlm: number,
  currency: CurrencyCode,
  rates: Record<CurrencyCode, number> = FALLBACK_XLM_RATES
): number {
  const rate = rates[currency] ?? FALLBACK_XLM_RATES[currency] ?? 1;
  const converted = amountXlm * rate;
  return Math.round(converted * 100) / 100;
}

export function formatCurrencyAmount(amount: number, currency: CurrencyCode): string {
  if (currency === 'XLM') {
    return `${amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} XLM`;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}