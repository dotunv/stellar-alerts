import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  convertUsdToFiat,
  isSupportedFiatCurrency,
  getExchangeRates,
} from '../exchange-rates';

// Mock Redis
vi.mock('../redis', () => ({
  redis: {
    get: vi.fn(),
    setex: vi.fn(),
  },
}));

import { redis } from '../redis';

describe('Exchange Rates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isSupportedFiatCurrency', () => {
    it('should return true for supported currencies', () => {
      expect(isSupportedFiatCurrency('USD')).toBe(true);
      expect(isSupportedFiatCurrency('EUR')).toBe(true);
      expect(isSupportedFiatCurrency('CAD')).toBe(true);
      expect(isSupportedFiatCurrency('JPY')).toBe(true);
      expect(isSupportedFiatCurrency('GBP')).toBe(true);
      expect(isSupportedFiatCurrency('AUD')).toBe(true);
    });

    it('should return false for unsupported currencies', () => {
      expect(isSupportedFiatCurrency('XYZ')).toBe(false);
      expect(isSupportedFiatCurrency('BTC')).toBe(false);
      expect(isSupportedFiatCurrency('')).toBe(false);
    });
  });

  describe('getExchangeRates', () => {
    it('should return cached rates when available', async () => {
      const mockRates = { JPY: 150, GBP: 0.8 };
      (redis.get as any).mockResolvedValue(JSON.stringify(mockRates));

      const rates = await getExchangeRates();

      expect(rates).toEqual(mockRates);
      expect(redis.get).toHaveBeenCalledWith('exchange_rates:latest');
      expect(redis.setex).not.toHaveBeenCalled();
    });

    it('should fetch and cache rates when cache is empty', async () => {
      (redis.get as any).mockResolvedValue(null);

      // Mock fetch
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ rates: { JPY: 150, GBP: 0.8 } }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const rates = await getExchangeRates();

      expect(rates).toEqual({ JPY: 150, GBP: 0.8 });
      expect(redis.setex).toHaveBeenCalledWith(
        'exchange_rates:latest',
        3600,
        JSON.stringify({ JPY: 150, GBP: 0.8 })
      );

      vi.unstubAllGlobals();
    });
  });

  describe('convertUsdToFiat', () => {
    it('should return 1:1 rate for USD', async () => {
      const result = await convertUsdToFiat(1000, 'USD');

      expect(result).toEqual({
        convertedAmount: 1000,
        rate: 1,
        currency: 'USD',
      });
    });

    it('should convert amount using cached exchange rate', async () => {
      (redis.get as any).mockResolvedValue(
        JSON.stringify({ JPY: 150, GBP: 0.8, EUR: 0.9, CAD: 1.35, AUD: 1.5 })
      );

      const result = await convertUsdToFiat(1000, 'JPY');

      expect(result).toEqual({
        convertedAmount: 150000,
        rate: 150,
        currency: 'JPY',
      });
    });

    it('should handle unsupported currency by falling back to USD', async () => {
      (redis.get as any).mockResolvedValue(
        JSON.stringify({ JPY: 150 })
      );

      const result = await convertUsdToFiat(1000, 'XYZ' as any);

      expect(result).toEqual({
        convertedAmount: 1000,
        rate: 1,
        currency: 'USD',
      });
    });

    it('should round converted amounts to 2 decimal places', async () => {
      (redis.get as any).mockResolvedValue(
        JSON.stringify({ GBP: 0.7534 })
      );

      const result = await convertUsdToFiat(123.45, 'GBP');

      expect(result.convertedAmount).toBe(93.01);
      expect(result.rate).toBe(0.7534);
      expect(result.currency).toBe('GBP');
    });
  });
});
