/**
 * Chaos-engineering fault injection suite (#145).
 *
 * Two groups of tests:
 *
 * 1. Toxiproxy-backed tests (gated on TOXIPROXY_URL) — these inject *real*
 *    network faults (latency, a severed connection) between a Node HTTP
 *    client and a local fixture server, through a live Toxiproxy proxy.
 *    They only run when TOXIPROXY_URL is set (the CI "chaos" job sets it
 *    after bringing up `docker compose up -d toxiproxy`); locally or in the
 *    main CI job, without a running Toxiproxy, this group is skipped rather
 *    than failed — see docker-compose.yml and .github/workflows/ci.yml.
 *
 * 2. Deterministic fault-injection tests (always run, no Docker needed) —
 *    these exercise the *actual* application code path
 *    (workers/watcher.worker.ts's pollOnce) against a simulated Horizon/DB
 *    fault via mocks, proving the real crash-prevention behavior rather
 *    than a stand-in.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Toxiproxy, Proxy as ToxiproxyProxy } from 'toxiproxy-node-client';

const TOXIPROXY_URL = process.env.TOXIPROXY_URL;
// Host toxiproxy should dial to reach this test process's fixture server.
// Defaults to loopback, which works when toxiproxy runs with
// `network_mode: host` (see docker-compose.yml, the CI setup). Override for
// a Docker-Desktop-style toxiproxy container that needs host.docker.internal.
const TOXIPROXY_UPSTREAM_HOST = process.env.TOXIPROXY_UPSTREAM_HOST || '127.0.0.1';
const PROXY_LISTEN_PORT = Number(process.env.TOXIPROXY_LISTEN_PORT || 8666);

function httpGet(url: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
  });
}

describe.skipIf(!TOXIPROXY_URL)('Chaos engineering: Toxiproxy fault injection', () => {
  let upstreamServer: http.Server;
  let upstreamPort: number;
  let toxiproxy: Toxiproxy;
  let proxy: ToxiproxyProxy;

  const PROXY_NAME = 'chaos-test-proxy';
  const PROXY_URL = `http://127.0.0.1:${PROXY_LISTEN_PORT}`;

  beforeAll(async () => {
    // A minimal fixture standing in for a real upstream service (Horizon,
    // Postgres, etc. all ultimately look like "a TCP endpoint" to a proxy).
    // GET / responds immediately; GET /stream sends an SSE-style ping every
    // 300ms indefinitely, mirroring the shape of watcher.worker.ts's
    // Horizon payments SSE stream closely enough to exercise the same
    // "reconnect after the stream goes silent" pattern.
    upstreamServer = http.createServer((req, res) => {
      if (req.url === '/stream') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        const pingTimer = setInterval(() => {
          res.write(`data: ping\n\n`);
        }, 300);
        req.on('close', () => clearInterval(pingTimer));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
    await new Promise<void>((resolve) => upstreamServer.listen(0, '127.0.0.1', () => resolve()));
    upstreamPort = (upstreamServer.address() as AddressInfo).port;

    toxiproxy = new Toxiproxy(TOXIPROXY_URL!);

    // Clean slate in case a previous run crashed before teardown.
    try {
      const existing = await toxiproxy.get(PROXY_NAME);
      await existing.remove();
    } catch {
      // No pre-existing proxy — fine.
    }

    proxy = await toxiproxy.createProxy({
      name: PROXY_NAME,
      listen: `0.0.0.0:${PROXY_LISTEN_PORT}`,
      upstream: `${TOXIPROXY_UPSTREAM_HOST}:${upstreamPort}`,
    });
  });

  afterAll(async () => {
    await proxy?.remove().catch(() => {});
    await new Promise<void>((resolve) => upstreamServer.close(() => resolve()));
  });

  afterEach(async () => {
    // Toxics and disabled state must not leak between tests.
    await proxy.update({ enabled: true, listen: proxy.listen, upstream: proxy.upstream }).catch(() => {});
    const toxics = await proxy.api.get(`${proxy.getPath()}/toxics`).catch(() => null);
    if (toxics?.data) {
      for (const toxic of toxics.data) {
        await proxy.api.delete(`${proxy.getPath()}/toxics/${toxic.name}`).catch(() => {});
      }
    }
  });

  it(
    'injects 3000ms latency and the client-observed round trip reflects it',
    async () => {
      await proxy.addToxic({
        name: 'latency-3s',
        type: 'latency',
        stream: 'downstream',
        toxicity: 1.0,
        attributes: { latency: 3000, jitter: 0 },
      });

      const start = Date.now();
      const response = await httpGet(PROXY_URL);
      const elapsedMs = Date.now() - start;

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('ok');
      // Allow a little slack below 3000 for timer/scheduling jitter, but the
      // whole point of the toxic is that this cannot come back fast.
      expect(elapsedMs).toBeGreaterThanOrEqual(2900);
    },
    15_000,
  );

  it(
    'verifies stream auto-reconnect after Toxiproxy severs the connection',
    async () => {
      // Mirrors workers/watcher.worker.ts's startHorizonSSEStream pattern:
      // if no data arrives within heartbeatTimeoutMs, close and reopen the
      // stream. Using a short timeout here (vs. the app's 60s) keeps the
      // test fast while exercising the identical reconnect strategy against
      // a real, Toxiproxy-severed TCP connection.
      const heartbeatTimeoutMs = 1000;
      let reconnectCount = 0;
      let messagesAfterLastConnect = 0;
      let stopped = false;
      let currentReq: http.ClientRequest | null = null;
      let heartbeat: NodeJS.Timeout;

      const resetHeartbeat = (connect: () => void) => {
        clearTimeout(heartbeat);
        heartbeat = setTimeout(() => {
          if (stopped) return;
          currentReq?.destroy();
          reconnectCount += 1;
          connect();
        }, heartbeatTimeoutMs);
      };

      const connect = () => {
        if (stopped) return;
        messagesAfterLastConnect = 0;
        resetHeartbeat(connect);
        currentReq = http.get(`${PROXY_URL}/stream`, (res) => {
          res.on('data', () => {
            messagesAfterLastConnect += 1;
            resetHeartbeat(connect);
          });
          res.on('error', () => {});
        });
        currentReq.on('error', () => {
          // A connection error (e.g. the proxy is disabled) is expected
          // during the outage below — the heartbeat timer drives the retry.
        });
      };

      connect();

      // Let the healthy connection prove itself before injecting a fault.
      await vi.waitFor(() => expect(messagesAfterLastConnect).toBeGreaterThan(0), { timeout: 5000, interval: 50 });

      // Sever the connection: disabling the proxy drops the live TCP
      // connection immediately and refuses new ones, simulating a network
      // partition between the app and its upstream.
      await proxy.update({ enabled: false, listen: proxy.listen, upstream: proxy.upstream });

      const reconnectCountBeforeRecovery = reconnectCount;

      // Restore connectivity partway through the outage.
      await new Promise((resolve) => setTimeout(resolve, heartbeatTimeoutMs * 1.5));
      await proxy.update({ enabled: true, listen: proxy.listen, upstream: proxy.upstream });

      // The client's heartbeat-driven retry loop should notice the outage
      // (having already attempted at least one reconnect while severed) and
      // successfully resume receiving messages once connectivity returns.
      await vi.waitFor(
        () => {
          expect(reconnectCount).toBeGreaterThan(reconnectCountBeforeRecovery);
          expect(messagesAfterLastConnect).toBeGreaterThan(0);
        },
        { timeout: 8000, interval: 100 },
      );

      stopped = true;
      clearTimeout(heartbeat);
      currentReq?.destroy();

      expect(reconnectCount).toBeGreaterThanOrEqual(1);
    },
    20_000,
  );
});

// ---------------------------------------------------------------------------
// Deterministic fault-injection tests against the real watcher code path.
// No Docker/Toxiproxy required — always runs.
// ---------------------------------------------------------------------------

vi.mock('../lib/prisma', () => ({
  prisma: {
    wallet: { findMany: vi.fn() },
    payment: { findUnique: vi.fn(), create: vi.fn() },
    ingestionCursor: { findUnique: vi.fn(), create: vi.fn(), upsert: vi.fn() },
    notificationPreference: { findUnique: vi.fn() },
  },
  connectWithRetry: vi.fn(),
}));

vi.mock('../lib/stellar', () => ({
  decodeHorizonAsset: vi.fn(),
  parseSacTransferEvent: vi.fn(),
  stellar: {
    server: {},
    getRecentPayments: vi.fn(),
    getPaymentsSince: vi.fn(),
    getLatestPagingToken: vi.fn(),
  },
}));

vi.mock('../lib/soroban', () => ({
  getSorobanLatestLedger: vi.fn(),
  loadContractRegistry: vi.fn(),
  getActiveContractIds: vi.fn(() => []),
  parseSorobanTransferEvent: vi.fn(),
  routeEventToUsers: vi.fn(),
}));

vi.mock('../lib/queue', () => ({ enqueuePaymentAlert: vi.fn() }));
vi.mock('../lib/lock', () => ({ withWalletLock: vi.fn(async (_id: string, fn: () => Promise<any>) => fn()) }));
vi.mock('../workers/supervisor', () => ({ registerSupervisorHeartbeat: vi.fn() }));

describe('Chaos engineering: unhandled crash prevention (deterministic)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a simulated Horizon outage (rejected getPaymentsSince) does not crash pollOnce', async () => {
    const { prisma } = await import('../lib/prisma');
    const { stellar } = await import('../lib/stellar');
    const { pollOnce } = await import('../workers/watcher.worker');

    vi.mocked(prisma.wallet.findMany).mockResolvedValue([
      { id: 'w1', publicKey: 'GBPDX2DPUHABCGNHXQRNK5A6NGV5R7T244HJ5CXAWSWVRTZR4WMADE72', userId: 'u1' } as any,
    ]);
    vi.mocked(prisma.ingestionCursor.findUnique).mockResolvedValue({ pagingToken: '100' } as any);
    // Simulated chaos fault: the network call to Horizon fails outright.
    vi.mocked(stellar.getPaymentsSince).mockRejectedValue(new Error('ECONNRESET: simulated Horizon outage'));

    let unhandledRejection: unknown = null;
    const onUnhandled = (reason: unknown) => {
      unhandledRejection = reason;
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      await expect(pollOnce()).resolves.toBeUndefined();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }

    expect(unhandledRejection).toBeNull();
  });

  it('a simulated DB disconnect (rejected wallet.findMany) does not crash pollOnce', async () => {
    const { prisma } = await import('../lib/prisma');
    const { pollOnce } = await import('../workers/watcher.worker');

    vi.mocked(prisma.wallet.findMany).mockRejectedValue(new Error('Connection terminated unexpectedly'));

    await expect(pollOnce()).resolves.toBeUndefined();
  });

  it('recovers on the next poll after a transient fault clears', async () => {
    const { prisma } = await import('../lib/prisma');
    const { stellar } = await import('../lib/stellar');
    const { pollOnce } = await import('../workers/watcher.worker');

    vi.mocked(prisma.wallet.findMany).mockResolvedValue([
      { id: 'w1', publicKey: 'GBPDX2DPUHABCGNHXQRNK5A6NGV5R7T244HJ5CXAWSWVRTZR4WMADE72', userId: 'u1' } as any,
    ]);
    vi.mocked(prisma.ingestionCursor.findUnique).mockResolvedValue({ pagingToken: '100' } as any);

    vi.mocked(stellar.getPaymentsSince).mockRejectedValueOnce(new Error('simulated transient network blip'));
    await expect(pollOnce()).resolves.toBeUndefined();

    vi.mocked(stellar.getPaymentsSince).mockResolvedValueOnce([]);
    await expect(pollOnce()).resolves.toBeUndefined();
    expect(stellar.getPaymentsSince).toHaveBeenCalledTimes(2);
  });
});
