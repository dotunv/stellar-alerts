import { AlertJobData } from '../lib/queue';

export interface SlackBlockKitPayload {
  text?: string;
  blocks: Array<{
    type: string;
    text?: {
      type: string;
      text: string;
      emoji?: boolean;
    };
    fields?: Array<{
      type: string;
      text: string;
    }>;
    elements?: Array<{
      type: string;
      text: {
        type: string;
        text: string;
        emoji?: boolean;
      };
      url?: string;
      action_id?: string;
    }>;
  }>;
}

export function buildSlackBlockKitPayload(data: AlertJobData): SlackBlockKitPayload {
  const explorerUrl = `https://stellar.expert/explorer/public/tx/${data.txHash}`;
  const truncatedHash = data.txHash.length > 12 ? `${data.txHash.substring(0, 10)}...` : data.txHash;

  return {
    text: `💰 Payment Received: ${data.amount} ${data.asset} from ${data.fromAddress}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '💰 Stellar Payment Received',
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Amount:*\n\`${data.amount} ${data.asset}\``,
          },
          {
            type: 'mrkdwn',
            text: `*From Address:*\n\`${data.fromAddress}\``,
          },
          {
            type: 'mrkdwn',
            text: `*Transaction Hash:*\n\`<${explorerUrl}|${truncatedHash}>\``,
          },
          {
            type: 'mrkdwn',
            text: `*Received At:*\n${data.receivedAt}`,
          },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '🔍 View on Stellar Expert',
              emoji: true,
            },
            url: explorerUrl,
            action_id: 'view_explorer_tx',
          },
        ],
      },
    ],
  };
}

export async function dispatchSlackAlert(
  webhookUrl: string,
  data: AlertJobData
): Promise<boolean> {
  const payload = buildSlackBlockKitPayload(data);

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.warn(`[SlackWorker] Slack API error HTTP ${res.status}: ${errorText}`);
      return false;
    }

    console.log(`[SlackWorker] 💬 Dispatched Slack Block Kit notification for tx ${data.txHash}`);
    return true;
  } catch (err: any) {
    console.warn(`[SlackWorker] Failed to dispatch Slack message to ${webhookUrl}: ${err.message}`);
    return false;
  }
}
