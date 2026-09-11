import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  WebhookSandbox,
  buildSignatureSnippets,
  buildWebhookPingPayload,
} from './WebhookSandbox';

describe('WebhookSandbox', () => {
  it('builds a deterministic sample payload for sandbox pings', () => {
    const payload = buildWebhookPingPayload(new Date('2026-08-29T00:00:00.000Z'));

    expect(payload.type).toBe('stellar.payment.test');
    expect(payload.data.asset).toBe('XLM');
    expect(payload.createdAt).toBe('2026-08-29T00:00:00.000Z');
  });

  it('renders signature snippets for each supported runtime', () => {
    const snippets = buildSignatureSnippets(
      'https://example.com/hook',
      JSON.stringify(buildWebhookPingPayload(new Date('2026-08-29T00:00:00.000Z')), null, 2)
    );

    expect(snippets.node).toContain('createHmac');
    expect(snippets.python).toContain('hmac.new');
    expect(snippets.curl).toContain('curl -X POST');
  });

  it('posts the sandbox payload and displays response details', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 202,
      headers: new Headers({ 'x-sandbox': 'accepted' }),
      text: async () => '{"received":true}',
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<WebhookSandbox />);

    fireEvent.change(screen.getByLabelText(/Webhook URL/i), {
      target: { value: 'https://example.com/hook' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Send Test Ping/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('202')).toBeInTheDocument();
    expect(screen.getByText(/"received":true/)).toBeInTheDocument();
    expect(screen.getByText(/x-sandbox: accepted/)).toBeInTheDocument();
  });
});