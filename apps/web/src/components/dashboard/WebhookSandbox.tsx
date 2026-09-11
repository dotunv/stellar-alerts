'use client';

import React, { useMemo, useState } from 'react';

type SignatureLanguage = 'node' | 'python' | 'curl';

interface WebhookResult {
  status: number;
  responseTimeMs: number;
  body: string;
  headers: Array<[string, string]>;
}

const DEFAULT_WEBHOOK_URL = 'https://example.com/stellar-alerts/webhook';
const WEBHOOK_SECRET_PLACEHOLDER = 'whsec_test_secret';

export function buildWebhookPingPayload(date: Date = new Date()) {
  return {
    type: 'stellar.payment.test',
    createdAt: date.toISOString(),
    data: {
      txHash: 'sandbox-test-transaction',
      walletPublicKey: 'GDASHBOARDSANDBOXTESTPUBLICKEY000000000000000000000000',
      asset: 'XLM',
      amount: '25.0000000',
      memo: 'Dashboard webhook sandbox ping',
    },
  };
}

function escapeSingleQuotedShellValue(value: string): string {
  return value.replace(/'/g, "'\"'\"'");
}

export function buildSignatureSnippets(
  webhookUrl: string,
  payloadJson: string,
  secret: string = WEBHOOK_SECRET_PLACEHOLDER
): Record<SignatureLanguage, string> {
  const endpoint = webhookUrl.trim() || DEFAULT_WEBHOOK_URL;

  return {
    node: [
      "import crypto from 'node:crypto';",
      '',
      `const payload = ${payloadJson};`,
      `const secret = '${secret}';`,
      "const signature = crypto.createHmac('sha256', secret)",
      '  .update(JSON.stringify(payload))',
      "  .digest('hex');",
      '',
      `await fetch('${endpoint}', {`,
      "  method: 'POST',",
      "  headers: {",
      "    'Content-Type': 'application/json',",
      "    'X-Stellar-Alerts-Signature': signature,",
      '  },',
      '  body: JSON.stringify(payload),',
      '});',
    ].join('\n'),
    python: [
      'import hashlib',
      'import hmac',
      'import json',
      'import requests',
      '',
      `payload = ${payloadJson}`,
      `secret = '${secret}'.encode()`,
      'body = json.dumps(payload, separators=(",", ":")).encode()',
      'signature = hmac.new(secret, body, hashlib.sha256).hexdigest()',
      '',
      `requests.post('${endpoint}', json=payload, headers={`,
      "    'X-Stellar-Alerts-Signature': signature,",
      '})',
    ].join('\n'),
    curl: [
      `curl -X POST '${escapeSingleQuotedShellValue(endpoint)}' \\`,
      "  -H 'Content-Type: application/json' \\",
      "  -H 'X-Stellar-Alerts-Signature: <computed-hmac-sha256>' \\",
      `  -d '${escapeSingleQuotedShellValue(payloadJson)}'`,
    ].join('\n'),
  };
}

export const WebhookSandbox: React.FC = () => {
  const [webhookUrl, setWebhookUrl] = useState(DEFAULT_WEBHOOK_URL);
  const [payloadText, setPayloadText] = useState(() =>
    JSON.stringify(buildWebhookPingPayload(new Date('2026-08-29T00:00:00.000Z')), null, 2)
  );
  const [selectedLanguage, setSelectedLanguage] = useState<SignatureLanguage>('node');
  const [result, setResult] = useState<WebhookResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const signatureSnippets = useMemo(
    () => buildSignatureSnippets(webhookUrl, payloadText),
    [payloadText, webhookUrl]
  );

  const handleSendPing = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setResult(null);

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(payloadText);
    } catch {
      setError('Payload must be valid JSON before it can be sent.');
      return;
    }

    setIsSending(true);
    const startedAt = performance.now();

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Stellar-Alerts-Sandbox': 'true',
        },
        body: JSON.stringify(parsedPayload),
      });
      const body = await response.text();
      const responseTimeMs = Math.round(performance.now() - startedAt);
      setResult({
        status: response.status,
        responseTimeMs,
        body: body || '(empty response body)',
        headers: Array.from(response.headers.entries()).slice(0, 8),
      });
    } catch (requestError) {
      const responseTimeMs = Math.round(performance.now() - startedAt);
      setError(
        requestError instanceof Error
          ? `${requestError.message} (${responseTimeMs}ms)`
          : `Webhook request failed (${responseTimeMs}ms)`
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-xl shadow-xl mb-8">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span>????</span> Webhook Sandbox
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Send signed payment samples and inspect the endpoint response.
          </p>
        </div>
        <div className="rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 px-3 py-1 text-xs font-semibold">
          Test Mode
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <form onSubmit={handleSendPing} className="space-y-4">
          <div>
            <label htmlFor="webhook-sandbox-url" className="block text-xs font-semibold text-slate-400 mb-1">
              Webhook URL
            </label>
            <input
              id="webhook-sandbox-url"
              type="url"
              required
              value={webhookUrl}
              onChange={(event) => setWebhookUrl(event.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-slate-950/70 border border-slate-800 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500/80 focus:ring-1 focus:ring-cyan-500/40"
            />
          </div>

          <div>
            <label htmlFor="webhook-sandbox-payload" className="block text-xs font-semibold text-slate-400 mb-1">
              Test Payload
            </label>
            <textarea
              id="webhook-sandbox-payload"
              value={payloadText}
              onChange={(event) => setPayloadText(event.target.value)}
              rows={12}
              className="w-full px-4 py-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500/80 focus:ring-1 focus:ring-cyan-500/40"
            />
          </div>

          <button
            type="submit"
            disabled={isSending}
            className="w-full sm:w-auto px-5 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSending ? 'Sending...' : 'Send Test Ping'}
          </button>
        </form>

        <div className="space-y-4">
          <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-4 min-h-[168px]">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
              Response Inspector
            </div>
            {error ? (
              <div role="alert" className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">
                {error}
              </div>
            ) : result ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3">
                    <div className="text-[11px] text-slate-500 uppercase font-semibold">Status</div>
                    <div className="text-2xl font-bold text-cyan-300">{result.status}</div>
                  </div>
                  <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3">
                    <div className="text-[11px] text-slate-500 uppercase font-semibold">Response Time</div>
                    <div className="text-2xl font-bold text-emerald-300">{result.responseTimeMs}ms</div>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 uppercase font-semibold mb-1">Headers</div>
                  <pre className="max-h-24 overflow-auto rounded-lg bg-black/30 border border-slate-800 p-3 text-xs text-slate-300">
                    {result.headers.length > 0
                      ? result.headers.map(([key, value]) => `${key}: ${value}`).join('\n')
                      : '(no readable response headers)'}
                  </pre>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 uppercase font-semibold mb-1">Body</div>
                  <pre className="max-h-32 overflow-auto rounded-lg bg-black/30 border border-slate-800 p-3 text-xs text-slate-300 whitespace-pre-wrap">
                    {result.body}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="h-full min-h-[120px] rounded-lg bg-black/20 border border-slate-800/80 flex items-center justify-center text-sm text-slate-500">
                Awaiting test response
              </div>
            )}
          </div>

          <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {(['node', 'python', 'curl'] as SignatureLanguage[]).map((language) => (
                <button
                  key={language}
                  type="button"
                  onClick={() => setSelectedLanguage(language)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold capitalize transition-colors ${
                    selectedLanguage === language
                      ? 'bg-purple-500/20 border-purple-400/60 text-purple-100'
                      : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {language}
                </button>
              ))}
            </div>
            <pre className="max-h-64 overflow-auto rounded-lg bg-black/40 border border-slate-800 p-4 text-xs text-slate-300 whitespace-pre-wrap">
              {signatureSnippets[selectedLanguage]}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};