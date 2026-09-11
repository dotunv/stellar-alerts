export interface DiscordAlertData {
  paymentId: string;
  txHash: string;
  amount: string;
  asset: string;
  assetIssuer?: string | null;
  fromAddress: string;
  receivedAt: string;
}

const STELLAR_EXPERT_TX_URL = 'https://stellar.expert/explorer/testnet/tx';
const DISCORD_EMBED_COLOR = 0x5865f2;

export function getStellarExpertTxLink(txHash: string): string {
  return `${STELLAR_EXPERT_TX_URL}/${txHash}`;
}

function getAssetBadge(asset: string, assetIssuer?: string | null): string {
  if (asset === 'XLM' || asset === 'native') {
    return '🌟 XLM';
  }
  return assetIssuer ? `🪙 ${asset} (${assetIssuer.slice(0, 4)}...${assetIssuer.slice(-4)})` : `🪙 ${asset}`;
}

export interface DiscordEmbedPayload {
  username: string;
  embeds: Array<{
    title: string;
    color: number;
    fields: Array<{ name: string; value: string; inline?: boolean }>;
    timestamp: string;
    footer: { text: string };
  }>;
}

export function buildDiscordEmbed(data: DiscordAlertData): DiscordEmbedPayload {
  return {
    username: 'Stellar Alerts',
    embeds: [
      {
        title: '💸 Payment Received',
        color: DISCORD_EMBED_COLOR,
        fields: [
          { name: 'Amount', value: `\`${data.amount} ${data.asset}\``, inline: true },
          { name: 'Asset', value: getAssetBadge(data.asset, data.assetIssuer), inline: true },
          { name: 'From', value: `\`${data.fromAddress}\``, inline: false },
          {
            name: 'Transaction',
            value: `[${data.txHash.slice(0, 8)}...${data.txHash.slice(-8)}](${getStellarExpertTxLink(data.txHash)})`,
            inline: false,
          },
        ],
        timestamp: new Date(data.receivedAt).toISOString(),
        footer: { text: `Payment ID: ${data.paymentId}` },
      },
    ],
  };
}

export async function dispatchDiscordAlert(webhookUrl: string, data: DiscordAlertData): Promise<boolean> {
  const payload = buildDiscordEmbed(data);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.warn(`[Discord] Webhook responded with status ${response.status} for payment ${data.paymentId}`);
    }

    return response.ok;
  } catch (error: any) {
    console.error(`[Discord] Failed to dispatch embed for payment ${data.paymentId}:`, error.message);
    return false;
  }
}
