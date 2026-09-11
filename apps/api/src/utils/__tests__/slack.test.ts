import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildSlackBlockKitPayload, dispatchSlackAlert } from '../slack';
import { AlertJobData } from '../../lib/queue';

const sampleData: AlertJobData = {
  paymentId: 'pay-456',
  txHash: '0x1234567890abcdef1234567890abcdef',
  walletId: 'wallet-002',
  amount: '250.00',
  asset: 'XLM',
  fromAddress: 'GBCDEF1234567890',
  receivedAt: '2026-08-26T14:00:00Z',
};

describe('slack utility', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('buildSlackBlockKitPayload', () => {
    it('should format Slack Block Kit card with payment details and action button', () => {
      const payload = buildSlackBlockKitPayload(sampleData);

      expect(payload.text).toContain('💰 Payment Received: 250.00 XLM');
      expect(payload.blocks).toHaveLength(3);

      // Header block
      expect(payload.blocks[0].type).toBe('header');
      expect(payload.blocks[0].text?.text).toBe('💰 Stellar Payment Received');

      // Fields block
      expect(payload.blocks[1].type).toBe('section');
      const fields = payload.blocks[1].fields!;
      expect(fields[0].text).toContain('250.00 XLM');
      expect(fields[1].text).toContain('GBCDEF1234567890');
      expect(fields[2].text).toContain('0x12345678');

      // Actions block
      expect(payload.blocks[2].type).toBe('actions');
      const actions = payload.blocks[2].elements!;
      expect(actions[0].type).toBe('button');
      expect(actions[0].url).toBe('https://stellar.expert/explorer/public/tx/0x1234567890abcdef1234567890abcdef');
    });
  });

  describe('dispatchSlackAlert', () => {
    it('should post formatted Block Kit payload to Slack webhook URL', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => 'ok',
      } as Response);

      const webhookUrl = 'https://hooks.slack.com/services/T00/B00/XXXX';
      const result = await dispatchSlackAlert(webhookUrl, sampleData);

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toBe(webhookUrl);
      const body = JSON.parse(fetchCall[1].body);
      expect(body.blocks[0].type).toBe('header');
    });

    it('should return false when Slack API returns HTTP error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'internal_error',
      } as Response);

      const result = await dispatchSlackAlert('https://hooks.slack.com/services/err', sampleData);
      expect(result).toBe(false);
    });
  });
});
