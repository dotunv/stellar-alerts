import { describe, expect, it } from 'vitest';
import {
  FALLBACK_XLM_RATES,
  convertXlmAmount,
  fetchXlmFiatRates,
  formatCurrencyAmount,
} from './currency';

describe('currency helpers', () => {
  it('converts XLM amounts into the selected fiat currency', () => {
    const rates = { ...FALLBACK_XLM_RATES, USD: 0.1234, EUR: 0.1, BRL: 0.6 };

    expect(convertXlmAmount(250, 'USD', rates)).toBe(30.85);
    expect(convertXlmAmount(250, 'EUR', rates)).toBe(25);
    expect(convertXlmAmount(250, 'XLM', rates)).toBe(250);
  });

  it('formats fiat and XLM display values', () => {
    expect(formatCurrencyAmount(1200.5, 'XLM')).toContain('1,200.50 XLM');
    expect(formatCurrencyAmount(12.3, 'USD')).toBe('$12.30');
  });

  it('normalizes CoinGecko simple price responses', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stellar: { usd: 0.2, eur: 0.18, brl: 1.02 } }),
    });

    await expect(fetchXlmFiatRates(fetcher as unknown as typeof fetch)).resolves.toEqual({
      XLM: 1,
      USD: 0.2,
      EUR: 0.18,
      BRL: 1.02,
    });
  });
});