export interface PushNotificationData {
  paymentId: string;
  txHash: string;
  amount: string;
  asset: string;
  assetIssuer?: string | null;
  fromAddress: string;
  recipientAddress: string;
  receivedAt: string;
}

export interface PushNotificationPayload {
  recipient: string;
  type: number; // 3 = Target Notification in Push Protocol REST API
  title: string;
  body: string;
  payload: {
    title: string;
    body: string;
    cta: string;
    img: string;
    data: {
      paymentId: string;
      txHash: string;
      amount: string;
      asset: string;
      fromAddress: string;
      receivedAt: string;
    };
  };
}

const STELLAR_EXPERT_TX_URL = 'https://stellar.expert/explorer/testnet/tx';
const PUSH_PROTOCOL_API_URL = 'https://backend.epns.io/apis/v1/payloads';

export function getPushTxLink(txHash: string): string {
  return `${STELLAR_EXPERT_TX_URL}/${txHash}`;
}

export function buildPushNotificationPayload(data: PushNotificationData): PushNotificationPayload {
  const formattedAmount = `${data.amount} ${data.asset}`;
  const shortFrom = data.fromAddress
    ? `${data.fromAddress.slice(0, 6)}...${data.fromAddress.slice(-6)}`
    : 'System';
  
  const title = '⚡ Stellar Payment Received';
  const body = `You received ${formattedAmount} from ${shortFrom}`;
  const cta = getPushTxLink(data.txHash);

  return {
    recipient: data.recipientAddress,
    type: 3, // Target notification
    title,
    body,
    payload: {
      title,
      body,
      cta,
      img: 'https://stellar.org/favicon.ico',
      data: {
        paymentId: data.paymentId,
        txHash: data.txHash,
        amount: data.amount,
        asset: data.asset,
        fromAddress: data.fromAddress,
        receivedAt: data.receivedAt,
      },
    },
  };
}

export async function dispatchPushNotification(
  channelAddress: string,
  data: PushNotificationData,
  pushApiKey?: string
): Promise<boolean> {
  const payload = buildPushNotificationPayload(data);
  const endpointUrl = process.env.PUSH_PROTOCOL_API_URL || PUSH_PROTOCOL_API_URL;
  const apiKey = pushApiKey || process.env.PUSH_PROTOCOL_API_KEY || 'demo-api-key';

  try {
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Push-Channel': channelAddress,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.warn(
        `[PushProtocol] Server responded with status ${response.status} for payment ${data.paymentId}`
      );
    }

    return response.ok;
  } catch (error: any) {
    console.error(
      `[PushProtocol] Failed to dispatch notification for payment ${data.paymentId}:`,
      error?.message || error
    );
    return false;
  }
}
