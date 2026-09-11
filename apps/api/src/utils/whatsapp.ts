import { AlertJobData } from '../lib/queue';

export type SupportedLanguage = 'EN' | 'ES' | 'PT';

export function normalizeLanguage(lang?: string | null): SupportedLanguage {
  if (!lang) return 'EN';
  const upper = lang.trim().toUpperCase();
  if (upper === 'ES' || upper === 'SPANISH') return 'ES';
  if (upper === 'PT' || upper === 'PORTUGUESE') return 'PT';
  return 'EN';
}

export function formatWhatsAppMessage(data: AlertJobData, lang: SupportedLanguage = 'EN'): string {
  switch (lang) {
    case 'ES':
      return [
        '🔔 *Confirmación de Pago Recibido*',
        `*Monto:* ${data.amount} ${data.asset}`,
        `*De:* ${data.fromAddress}`,
        `*Transacción:* ${data.txHash}`,
        `*Fecha:* ${data.receivedAt}`,
      ].join('\n');
    case 'PT':
      return [
        '🔔 *Confirmação de Pagamento Recebido*',
        `*Valor:* ${data.amount} ${data.asset}`,
        `*De:* ${data.fromAddress}`,
        `*Transação:* ${data.txHash}`,
        `*Data:* ${data.receivedAt}`,
      ].join('\n');
    case 'EN':
    default:
      return [
        '🔔 *Payment Receipt Confirmation*',
        `*Amount:* ${data.amount} ${data.asset}`,
        `*From:* ${data.fromAddress}`,
        `*Transaction:* ${data.txHash}`,
        `*Received At:* ${data.receivedAt}`,
      ].join('\n');
  }
}

export function buildWhatsAppCloudPayload(
  toPhoneNumber: string,
  data: AlertJobData,
  language: string = 'EN'
) {
  const lang = normalizeLanguage(language);
  const messageText = formatWhatsAppMessage(data, lang);

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toPhoneNumber,
    type: 'text',
    text: {
      preview_url: false,
      body: messageText,
    },
    template: {
      name: `payment_receipt_${lang.toLowerCase()}`,
      language: {
        code: lang.toLowerCase(),
      },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: data.amount },
            { type: 'text', text: data.asset },
            { type: 'text', text: data.fromAddress },
            { type: 'text', text: data.txHash },
          ],
        },
      ],
    },
  };
}

export async function dispatchWhatsAppAlert(
  phoneNumber: string,
  data: AlertJobData,
  language: string = 'EN'
): Promise<boolean> {
  const whatsappApiUrl =
    process.env.WHATSAPP_API_URL ||
    `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID || '100000000000000'}/messages`;
  const whatsappToken = process.env.WHATSAPP_API_TOKEN || 'mock_whatsapp_token';

  const payload = buildWhatsAppCloudPayload(phoneNumber, data, language);

  try {
    const res = await fetch(whatsappApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${whatsappToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.warn(`[WhatsAppWorker] Cloud API returned error ${res.status}: ${errorText}`);
      return false;
    }

    console.log(`[WhatsAppWorker] 📱 Dispatched localized (${payload.template.language.code}) WhatsApp alert to ${phoneNumber}`);
    return true;
  } catch (err: any) {
    console.warn(`[WhatsAppWorker] Failed to send WhatsApp message to ${phoneNumber}: ${err.message}`);
    return false;
  }
}
