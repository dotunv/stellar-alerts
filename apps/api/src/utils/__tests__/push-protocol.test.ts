import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildPushNotificationPayload,
  dispatchPushNotification,
  getPushTxLink,
  PushNotificationData,
} from '../push-protocol';

describe('Push Protocol Utility Tests', () => {
  const sampleData: PushNotificationData = {
    paymentId: 'pay-101',
    txHash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    amount: '150.00',
    asset: 'XLM',
    assetIssuer: null,
    fromAddress: 'GBPDX2DPUHABCGNHXQRNK5A6NGV5R7T244HJ5CXAWSWVRTZR4WMADE72',
    recipientAddress: '0x1234567890abcdef1234567890abcdef12345678',
    receivedAt: '2026-08-28T18:00:00.000Z',
  };

  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('correctly constructs Stellar Expert explorer link', () => {
    const link = getPushTxLink(sampleData.txHash);
    expect(link).toBe(`https://stellar.expert/explorer/testnet/tx/${sampleData.txHash}`);
  });

  it('builds a valid Push Protocol notification payload', () => {
    const payload = buildPushNotificationPayload(sampleData);

    expect(payload.recipient).toBe(sampleData.recipientAddress);
    expect(payload.type).toBe(3);
    expect(payload.title).toContain('Stellar Payment Received');
    expect(payload.body).toContain('150.00 XLM');
    expect(payload.payload.cta).toContain(sampleData.txHash);
    expect(payload.payload.data.paymentId).toBe('pay-101');
    expect(payload.payload.data.amount).toBe('150.00');
  });

  it('dispatches push notification payload to endpoint successfully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', id: 'push-id-1' }),
    });
    global.fetch = mockFetch;

    const result = await dispatchPushNotification('0xChannelAddress123', sampleData, 'test-api-key');

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/apis/v1/payloads'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-api-key',
          'X-Push-Channel': '0xChannelAddress123',
        }),
      })
    );
  });

  it('handles dispatch failure gracefully when API returns error status', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    global.fetch = mockFetch;

    const result = await dispatchPushNotification('0xChannelAddress123', sampleData);

    expect(result).toBe(false);
  });

  it('catches network errors during dispatch and returns false', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network connection timeout'));
    global.fetch = mockFetch;

    const result = await dispatchPushNotification('0xChannelAddress123', sampleData);

    expect(result).toBe(false);
  });
});
