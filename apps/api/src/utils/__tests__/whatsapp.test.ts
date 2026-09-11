import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatWhatsAppMessage,
  buildWhatsAppCloudPayload,
  dispatchWhatsAppAlert,
  normalizeLanguage,
} from '../whatsapp';
import { AlertJobData } from '../../lib/queue';

const sampleData: AlertJobData = {
  paymentId: 'pay-123',
  txHash: '0xabc123def456',
  walletId: 'wallet-001',
  amount: '100.50',
  asset: 'USDC',
  fromAddress: 'GACCOUNT123456789',
  receivedAt: '2026-08-26T12:00:00Z',
};

describe('whatsapp utility', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('normalizeLanguage', () => {
    it('should correctly normalize language strings', () => {
      expect(normalizeLanguage('en')).toBe('EN');
      expect(normalizeLanguage('ES')).toBe('ES');
      expect(normalizeLanguage('spanish')).toBe('ES');
      expect(normalizeLanguage('pt')).toBe('PT');
      expect(normalizeLanguage('portuguese')).toBe('PT');
      expect(normalizeLanguage(undefined)).toBe('EN');
      expect(normalizeLanguage('unknown')).toBe('EN');
    });
  });

  describe('formatWhatsAppMessage', () => {
    it('should format message in English (EN)', () => {
      const msg = formatWhatsAppMessage(sampleData, 'EN');
      expect(msg).toContain('Payment Receipt Confirmation');
      expect(msg).toContain('100.50 USDC');
      expect(msg).toContain('GACCOUNT123456789');
    });

    it('should format message in Spanish (ES)', () => {
      const msg = formatWhatsAppMessage(sampleData, 'ES');
      expect(msg).toContain('Confirmación de Pago Recibido');
      expect(msg).toContain('*Monto:* 100.50 USDC');
    });

    it('should format message in Portuguese (PT)', () => {
      const msg = formatWhatsAppMessage(sampleData, 'PT');
      expect(msg).toContain('Confirmação de Pagamento Recebido');
      expect(msg).toContain('*Valor:* 100.50 USDC');
    });
  });

  describe('buildWhatsAppCloudPayload', () => {
    it('should build valid Meta WhatsApp Business Cloud API payload', () => {
      const payload = buildWhatsAppCloudPayload('+5511999999999', sampleData, 'PT');
      expect(payload.messaging_product).toBe('whatsapp');
      expect(payload.to).toBe('+5511999999999');
      expect(payload.template.language.code).toBe('pt');
      expect(payload.text.body).toContain('Confirmação de Pagamento Recebido');
    });
  });

  describe('dispatchWhatsAppAlert', () => {
    it('should successfully post message to WhatsApp Cloud API', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [{ id: 'wmid.HBgL123' }] }),
      } as Response);

      const result = await dispatchWhatsAppAlert('+18005550199', sampleData, 'ES');
      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      const fetchArgs = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchArgs[1].body);
      expect(body.to).toBe('+18005550199');
      expect(body.template.language.code).toBe('es');
    });

    it('should handle WhatsApp API HTTP error response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Invalid OAuth access token',
      } as Response);

      const result = await dispatchWhatsAppAlert('+18005550199', sampleData, 'EN');
      expect(result).toBe(false);
    });
  });
});
