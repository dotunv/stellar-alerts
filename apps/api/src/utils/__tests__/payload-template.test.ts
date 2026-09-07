import { describe, it, expect, afterEach } from 'vitest';
import {
  applyWebhookPayloadTemplate,
  clearPayloadTemplateCache,
  compilePayloadTemplate,
  renderPayloadTemplate,
  validateHandlebarsTemplate,
} from '../payload-template';

describe('Webhook Payload Template Engine (#194)', () => {
  const paymentPayload = {
    event: 'payment.received',
    timestamp: '2026-08-30T00:00:00.000Z',
    data: {
      paymentId: 'pay_123',
      txHash: 'abc123hash',
      amount: '100.00',
      asset: 'XLM',
      assetIssuer: null,
      fromAddress: 'GABC123',
      receivedAt: '2026-08-30T00:00:00.000Z',
    },
  };

  afterEach(() => {
    clearPayloadTemplateCache();
  });

  it('returns the default JSON payload when no template is configured', () => {
    const result = applyWebhookPayloadTemplate(paymentPayload);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toBe(JSON.stringify(paymentPayload));
      expect(result.payload).toEqual(paymentPayload);
    }
  });

  it('transforms payment data into a user-defined JSON schema before delivery', () => {
    const template = `{
      "type": "stellar_payment",
      "amount": "{{data.amount}}",
      "asset": "{{data.asset}}",
      "transaction_hash": "{{data.txHash}}",
      "sender": "{{data.fromAddress}}"
    }`;

    const result = renderPayloadTemplate(template, paymentPayload);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.parse(result.body)).toEqual({
        type: 'stellar_payment',
        amount: '100.00',
        asset: 'XLM',
        transaction_hash: 'abc123hash',
        sender: 'GABC123',
      });
    }
  });

  it('validates Handlebars syntax via AST parsing', () => {
    expect(validateHandlebarsTemplate('{"amount":"{{data.amount}}"}')).toEqual({ ok: true });
    expect(validateHandlebarsTemplate('{{#if unclosed}}')).toMatchObject({ ok: false, phase: 'parse' });
  });

  it('catches render errors gracefully in strict mode', () => {
    const result = renderPayloadTemplate('{"missing":"{{undefinedField.nested}}"}', paymentPayload);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['render', 'json']).toContain(result.phase);
    }
  });

  it('catches invalid JSON output after template rendering', () => {
    const result = renderPayloadTemplate('amount={{data.amount}}', paymentPayload);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe('json');
    }
  });

  it('rejects empty template output', () => {
    const result = renderPayloadTemplate('{{#if false}}content{{/if}}', paymentPayload);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.phase).toBe('render');
    }
  });

  it('caches compiled templates for repeated webhook deliveries', () => {
    const template = '{"event":"{{event}}","amount":"{{data.amount}}"}';

    const first = compilePayloadTemplate(template);
    const second = compilePayloadTemplate(template);

    expect(typeof first).toBe('function');
    expect(first).toBe(second);
  });

  it('supports nested payment context fields in custom schemas', () => {
    const template = `{
      "metadata": {
        "event": "{{event}}",
        "received_at": "{{data.receivedAt}}"
      },
      "payment": {
        "id": "{{data.paymentId}}",
        "value": "{{data.amount}} {{data.asset}}"
      }
    }`;

    const result = applyWebhookPayloadTemplate(paymentPayload, template);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toEqual({
        metadata: {
          event: 'payment.received',
          received_at: '2026-08-30T00:00:00.000Z',
        },
        payment: {
          id: 'pay_123',
          value: '100.00 XLM',
        },
      });
    }
  });
});
