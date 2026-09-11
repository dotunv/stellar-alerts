import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentsController } from '../payments.controller';
import { paymentsService } from '../payments.service';

vi.mock('../payments.service', () => ({
  paymentsService: {
    getPaymentsSummary: vi.fn(),
    getPayments: vi.fn(),
  }
}));

describe('PaymentsController', () => {
  let paymentsController: PaymentsController;
  let mockRequest: any;
  let mockReply: any;

  beforeEach(() => {
    paymentsController = new PaymentsController();
    vi.clearAllMocks();
    
    mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
  });

  describe('getPaymentsSummary', () => {
    it('should pass if walletId is missing because it is optional', async () => {
      mockRequest = { query: {}, user: { id: 'user-1' } };
      
      const mockSummary = { volume: 1500, count: 5 };
      vi.mocked(paymentsService.getPaymentsSummary).mockResolvedValue(mockSummary);
      
      await paymentsController.getPaymentsSummary(mockRequest, mockReply);
      
      expect(mockReply.send).toHaveBeenCalledWith({ success: true, summary: mockSummary });
      
    });

    it('should return volume and count for a valid walletId', async () => {
      mockRequest = { query: { walletId: 'wallet_123' }, user: { id: 'user-1' } };
      const mockSummary = { volume: 1500, count: 5 };
      
      vi.mocked(paymentsService.getPaymentsSummary).mockResolvedValue(mockSummary);
      
      await paymentsController.getPaymentsSummary(mockRequest, mockReply);
      
      expect(paymentsService.getPaymentsSummary).toHaveBeenCalledWith('user-1', 'wallet_123', undefined);
      expect(mockReply.send).toHaveBeenCalledWith({ success: true, summary: mockSummary });
    });
  });
});
