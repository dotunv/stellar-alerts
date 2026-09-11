import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as StellarSdk from 'stellar-sdk';
import { HorizonMockServer, createHorizonMock } from '../mocks/horizon-mock';
import { authService } from '../modules/auth/auth.service';
import { walletsService } from '../modules/wallets/wallets.service';
import { decodeHorizonAsset } from '../lib/stellar';
import { buildPushNotificationPayload, dispatchPushNotification } from '../utils/push-protocol';

vi.mock('../lib/prisma', () => {
  const users = new Map<string, any>();
  const wallets = new Map<string, any>();
  const payments = new Map<string, any>();
  const webhooks = new Map<string, any>();

  return {
    prisma: {
      user: {
        findUnique: vi.fn().mockImplementation(async ({ where }) => {
          if (where.email) return users.get(where.email) || null;
          if (where.id) return Array.from(users.values()).find((u) => u.id === where.id) || null;
          return null;
        }),
        upsert: vi.fn().mockImplementation(async ({ where, create }) => {
          const existing = users.get(where.email);
          if (existing) return existing;
          const user = { id: `usr-${Date.now()}`, email: create.email, createdAt: new Date() };
          users.set(create.email, user);
          return user;
        }),
        create: vi.fn().mockImplementation(async ({ data }) => {
          const user = { id: `usr-${Date.now()}`, email: data.email, createdAt: new Date() };
          users.set(data.email, user);
          return user;
        }),
      },
      wallet: {
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          return (
            Array.from(wallets.values()).find(
              (w) => w.userId === where.userId && w.publicKey === where.publicKey
            ) || null
          );
        }),
        create: vi.fn().mockImplementation(async ({ data }) => {
          const wallet = {
            id: `wlt-${Date.now()}`,
            userId: data.userId,
            publicKey: data.publicKey,
            label: data.label || 'Default Wallet',
            lastPagingToken: '0',
            createdAt: new Date(),
          };
          wallets.set(wallet.id, wallet);
          return wallet;
        }),
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          return Array.from(wallets.values()).filter((w) => w.userId === where.userId);
        }),
      },
      payment: {
        create: vi.fn().mockImplementation(async ({ data }) => {
          const payment = {
            id: `pay-${Date.now()}`,
            walletId: data.walletId,
            txHash: data.txHash,
            amount: data.amount,
            asset: data.asset,
            fromAddress: data.fromAddress,
            receivedAt: data.receivedAt || new Date(),
          };
          payments.set(payment.id, payment);
          return payment;
        }),
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          return Array.from(payments.values()).filter((p) => p.walletId === where.walletId);
        }),
      },
      webhook: {
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          return Array.from(webhooks.values()).filter((w) => w.userId === where.userId);
        }),
      },
    },
  };
});

describe('Full End-to-End Automated Integration Test Suite (Offline Horizon Mock)', () => {
  let mockHorizon: HorizonMockServer;
  let mockHorizonUrl: string;

  const testEmail = 'e2e-tester@stellar-alerts.org';
  const testPublicKey = 'GBPDX2DPUHABCGNHXQRNK5A6NGV5R7T244HJ5CXAWSWVRTZR4WMADE72';

  beforeAll(async () => {
    mockHorizon = await createHorizonMock();
    mockHorizonUrl = mockHorizon.getUrl();
  });

  afterAll(async () => {
    await mockHorizon.stop();
  });

  beforeEach(() => {
    mockHorizon.clearPayments();
    vi.clearAllMocks();
  });

  it('Stage 1: Offline Horizon Mock server responds to payments & health queries', async () => {
    mockHorizon.addPayment({
      id: 'mock-101',
      amount: '25.0000000',
      asset_type: 'native',
      asset_code: 'XLM',
      from: 'GDS6OIGNYZTBIQPZF5XUWZ5JTEBFTAQYYEIWPI4IMVS67DGE6I7D6KYA',
      to: testPublicKey,
    });

    const response = await fetch(`${mockHorizonUrl}/accounts/${testPublicKey}/payments`);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json._embedded.records).toHaveLength(1);
    expect(json._embedded.records[0].amount).toBe('25.0000000');
    expect(json._embedded.records[0].asset_code).toBe('XLM');
  });

  it('Stage 2: User Auth & Magic Link Verification Flow', async () => {
    const magicLinkToken = await authService.requestMagicLink(testEmail);
    expect(magicLinkToken).toBeDefined();
    expect(typeof magicLinkToken).toBe('string');

    const result = await authService.verifyMagicLink(magicLinkToken);
    expect(result).toBeDefined();
    expect(result.token).toBeDefined();
    expect(result.user.email).toBe(testEmail);
  });

  it('Stage 3: Wallet Registration & Public Key Ingestion Guard', async () => {
    const magicToken = await authService.requestMagicLink(testEmail);
    const authResult = await authService.verifyMagicLink(magicToken);

    const registeredWallet = await walletsService.addWallet(
      authResult.user.id,
      testPublicKey,
      'Main Treasury Account'
    );

    expect(registeredWallet).toBeDefined();
    expect(registeredWallet.publicKey).toBe(testPublicKey);
    expect(registeredWallet.label).toBe('Main Treasury Account');

    const userWallets = await walletsService.getWallets(authResult.user.id);
    expect(userWallets).toHaveLength(1);
  });

  it('Stage 4: Blockchain Payment Ingestion & Decoding Pipeline', async () => {
    const rawHorizonRecord = {
      id: 'horizon-pay-999',
      paging_token: '123456789',
      successful: true,
      type: 'payment',
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5XYG4DZ6N7C25A4O6GI55H6TZOMJ2HZXD3RF',
      from: 'GDS6OIGNYZTBIQPZF5XUWZ5JTEBFTAQYYEIWPI4IMVS67DGE6I7D6KYA',
      to: testPublicKey,
      amount: '500.0000000',
    };

    const decoded = decodeHorizonAsset(rawHorizonRecord);
    expect(decoded.assetCode).toBe('USDC');
    expect(decoded.assetIssuer).toBe('GA5ZSEJYB37JRC5AVCIA5XYG4DZ6N7C25A4O6GI55H6TZOMJ2HZXD3RF');
  });

  it('Stage 5: Decentralized Push Protocol Alert Dispatcher Flow', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', id: 'push-id-e2e' }),
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock;

    try {
      const pushData = {
        paymentId: 'pay-e2e-1',
        txHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        amount: '100.00',
        asset: 'USDC',
        fromAddress: 'GBPDX2DPUHABCGNHXQRNK5A6NGV5R7T244HJ5CXAWSWVRTZR4WMADE72',
        recipientAddress: '0x1234567890abcdef1234567890abcdef12345678',
        receivedAt: new Date().toISOString(),
      };

      const payload = buildPushNotificationPayload(pushData);
      expect(payload.recipient).toBe('0x1234567890abcdef1234567890abcdef12345678');
      expect(payload.payload.data.amount).toBe('100.00');

      const dispatched = await dispatchPushNotification('0xChannelAddress', pushData, 'mock-key');
      expect(dispatched).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
