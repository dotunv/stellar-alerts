import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildDiscordEmbed, dispatchDiscordAlert, getStellarExpertTxLink } from '../discord';

const baseData = {
  paymentId: 'pay_123',
  txHash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  amount: '100.5000000',
  asset: 'USDC',
  assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  fromAddress: 'GABC123456789',
  receivedAt: '2026-08-25T12:00:00.000Z',
};

describe('buildDiscordEmbed', () => {
  it('formats payment amount, asset badge, and transaction hash into the embed', () => {
    const payload = buildDiscordEmbed(baseData);

    expect(payload.username).toBe('Stellar Alerts');
    expect(payload.embeds).toHaveLength(1);

    const embed = payload.embeds[0];
    const fields = Object.fromEntries(embed.fields.map((f) => [f.name, f.value]));

    expect(fields.Amount).toBe('`100.5000000 USDC`');
    expect(fields.Asset).toContain('USDC');
    expect(fields.From).toBe('`GABC123456789`');
    expect(fields.Transaction).toContain(getStellarExpertTxLink(baseData.txHash));
    expect(embed.footer.text).toBe(`Payment ID: ${baseData.paymentId}`);
  });

  it('badges native XLM payments distinctly from issued assets', () => {
    const payload = buildDiscordEmbed({ ...baseData, asset: 'XLM', assetIssuer: null });
    const fields = Object.fromEntries(payload.embeds[0].fields.map((f) => [f.name, f.value]));

    expect(fields.Asset).toBe('🌟 XLM');
  });
});

describe('dispatchDiscordAlert', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('posts the embed payload to the provided webhook URL and returns true on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    const result = await dispatchDiscordAlert('https://discord.com/api/webhooks/123/abc', baseData);

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/123/abc',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const [, options] = fetchMock.mock.calls[0];
    const sentPayload = JSON.parse(options.body);
    expect(sentPayload.embeds[0].fields[0].value).toBe('`100.5000000 USDC`');
  });

  it('returns false when the webhook endpoint responds with an error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));

    const result = await dispatchDiscordAlert('https://discord.com/api/webhooks/123/abc', baseData);

    expect(result).toBe(false);
  });

  it('returns false when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    const result = await dispatchDiscordAlert('https://discord.com/api/webhooks/123/abc', baseData);

    expect(result).toBe(false);
  });
});
