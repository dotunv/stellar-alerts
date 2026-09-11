import { describe, it, expect, vi, beforeEach } from 'vitest';
import { paymentsController } from '../payments.controller';
import { paymentsService } from '../payments.service';

// Mock the payments service
vi.mock('../payments.service', () => ({
  paymentsService: {
    getPaymentsSummary: vi.fn(),
  },
}));

// Mock the exchange-rates module
vi.mock('../../lib/exchange-rates', () => ({
  convertUsdToFiat: vi.fn(),
  isSupportedFiatCurrency: vi.fn((currency: string) =>
    ['USD', 'EUR', 'CAD', 'JPY', 'GBP', 'AUD'].includes(currency)
  ),
  SUPPORTED_FIAT_CURRENCIES: ['USD', 'EUR', 'CAD', 'JPY', 'GBP', 'AUD'],
}));

const AUTH_USER = { id: 'user-1', email: 'user-1@example.com' };

describe('PaymentsController - Fiat Currency Conversion', () => {
  let mockRequest: any;
  let mockReply: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
  });

  it('should return summary without fiat conversion when fiat param is not provided', async () => {
    const mockSummary = { totalReceived: 1000, paymentCount: 5 };
    (paymentsService.getPaymentsSummary as any).mockResolvedValue(mockSummary);

    mockRequest = { query: { walletId: 'wallet-1' }, user: AUTH_USER };

    await paymentsController.getPaymentsSummary(mockRequest, mockReply);

    expect(paymentsService.getPaymentsSummary).toHaveBeenCalledWith('user-1', 'wallet-1', undefined);
    expect(mockReply.send).toHaveBeenCalledWith({ success: true, summary: mockSummary });
  });

  it('should return summary with fiat conversion when valid fiat param is provided', async () => {
    const mockSummary = {
      totalReceived: 1000,
      paymentCount: 5,
      fiatConversion: {
        currency: 'JPY',
        convertedTotal: 150000,
        exchangeRate: 150,
      },
    };
    (paymentsService.getPaymentsSummary as any).mockResolvedValue(mockSummary);

    mockRequest = { query: { walletId: 'wallet-1', fiat: 'JPY' }, user: AUTH_USER };

    await paymentsController.getPaymentsSummary(mockRequest, mockReply);

    expect(paymentsService.getPaymentsSummary).toHaveBeenCalledWith('user-1', 'wallet-1', 'JPY');
    expect(mockReply.send).toHaveBeenCalledWith({ success: true, summary: mockSummary });
  });

  it('should return summary across all of the user\'s wallets when walletId is omitted', async () => {
    const mockSummary = { totalReceived: 4200, paymentCount: 12 };
    (paymentsService.getPaymentsSummary as any).mockResolvedValue(mockSummary);

    mockRequest = { query: {}, user: AUTH_USER };

    await paymentsController.getPaymentsSummary(mockRequest, mockReply);

    expect(paymentsService.getPaymentsSummary).toHaveBeenCalledWith('user-1', undefined, undefined);
    expect(mockReply.send).toHaveBeenCalledWith({ success: true, summary: mockSummary });
  });

  it('should return 400 for a malformed query (wrong type)', async () => {
    // walletId must be a string when present.
    mockRequest = { query: { walletId: 12345 }, user: AUTH_USER };

    await paymentsController.getPaymentsSummary(mockRequest, mockReply);

    expect(mockReply.status).toHaveBeenCalledWith(400);
    expect(mockReply.send).toHaveBeenCalled();
    expect(paymentsService.getPaymentsSummary).not.toHaveBeenCalled();
  });

  it('should return 401 when there is no authenticated user', async () => {
    mockRequest = { query: { walletId: 'wallet-1' }, user: undefined };

    await paymentsController.getPaymentsSummary(mockRequest, mockReply);

    expect(mockReply.status).toHaveBeenCalledWith(401);
    expect(paymentsService.getPaymentsSummary).not.toHaveBeenCalled();
  });

  it('should pass an unsupported fiat currency through to the service as-is', async () => {
    const mockSummary = { totalReceived: 1000, paymentCount: 5 };
    (paymentsService.getPaymentsSummary as any).mockResolvedValue(mockSummary);

    mockRequest = { query: { walletId: 'wallet-1', fiat: 'XYZ' }, user: AUTH_USER };

    await paymentsController.getPaymentsSummary(mockRequest, mockReply);

    // Validity of the currency code is the service's concern (via
    // isSupportedFiatCurrency), not the controller's.
    expect(paymentsService.getPaymentsSummary).toHaveBeenCalledWith('user-1', 'wallet-1', 'XYZ');
    expect(mockReply.send).toHaveBeenCalledWith({ success: true, summary: mockSummary });
  });

  it('should support all required fiat currencies', async () => {
    const supportedCurrencies = ['CAD', 'JPY', 'GBP', 'AUD', 'USD', 'EUR'];

    for (const currency of supportedCurrencies) {
      vi.clearAllMocks();
      const mockSummary = { totalReceived: 1000, paymentCount: 5 };
      (paymentsService.getPaymentsSummary as any).mockResolvedValue(mockSummary);

      mockRequest = { query: { walletId: 'wallet-1', fiat: currency }, user: AUTH_USER };
      mockReply = { status: vi.fn().mockReturnThis(), send: vi.fn() };

      await paymentsController.getPaymentsSummary(mockRequest, mockReply);

      expect(paymentsService.getPaymentsSummary).toHaveBeenCalledWith('user-1', 'wallet-1', currency);
      expect(mockReply.send).toHaveBeenCalledWith({ success: true, summary: mockSummary });
    }
  });
});
