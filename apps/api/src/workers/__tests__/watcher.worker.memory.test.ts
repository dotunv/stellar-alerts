import { describe, it, expect, vi, beforeEach } from 'vitest';

const startMock = vi.fn();
const stopMock = vi.fn();
let lastMonitorOptions: any = null;

vi.mock('../../utils/memory-monitor', () => ({
  MemoryMonitor: vi.fn().mockImplementation((options: any) => {
    lastMonitorOptions = options;
    return { start: startMock, stop: stopMock };
  }),
}));

vi.mock('../../lib/prisma', () => ({
  prisma: { payment: {}, ingestionCursor: {} },
  connectWithRetry: vi.fn(),
}));

vi.mock('../../lib/stellar', () => ({
  decodeHorizonAsset: vi.fn(),
  parseSacTransferEvent: vi.fn(),
  stellar: { server: {}, getRecentPayments: vi.fn(), getPaymentsSince: vi.fn(), getLatestPagingToken: vi.fn() },
}));

vi.mock('../../lib/soroban', () => ({
  getSorobanLatestLedger: vi.fn(),
  loadContractRegistry: vi.fn(),
  getActiveContractIds: vi.fn(() => []),
  parseSorobanTransferEvent: vi.fn(),
  routeEventToUsers: vi.fn(),
}));

vi.mock('../../lib/queue', () => ({ enqueuePaymentAlert: vi.fn() }));
vi.mock('../../lib/lock', () => ({ withWalletLock: vi.fn(async (_id: string, fn: () => Promise<any>) => fn()) }));
vi.mock('../supervisor', () => ({ registerSupervisorHeartbeat: vi.fn() }));

import { gracefulRestart, startMemoryMonitor } from '../watcher.worker';

describe('watcher worker memory monitor wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastMonitorOptions = null;
  });

  it('startMemoryMonitor starts a MemoryMonitor instance', () => {
    const monitor = startMemoryMonitor();

    expect(startMock).toHaveBeenCalledTimes(1);
    expect(monitor).toEqual({ start: startMock, stop: stopMock });
  });

  it('wires onRestartRequired to gracefulRestart', () => {
    startMemoryMonitor();

    expect(lastMonitorOptions.onRestartRequired).toBeInstanceOf(Function);
    expect(lastMonitorOptions.onCleanup).toBeInstanceOf(Function);
  });

  it('gracefulRestart stops the monitor and defers the process exit by a turn of the event loop', () => {
    vi.useFakeTimers({ toFake: ['setImmediate'] });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

    try {
      startMemoryMonitor(); // establishes the module-level monitor gracefulRestart stops

      expect(() =>
        gracefulRestart('test-triggered restart', {
          heapUsed: 900 * 1024 * 1024,
          heapTotal: 1000 * 1024 * 1024,
          rss: 1200 * 1024 * 1024,
          external: 0,
          usageRatio: 0.9,
          timestamp: Date.now(),
        }),
      ).not.toThrow();

      expect(stopMock).toHaveBeenCalledTimes(1);
      // process.exit is deferred via setImmediate, not called synchronously —
      // it gets a turn of the event loop to flush the log line above first.
      expect(exitSpy).not.toHaveBeenCalled();

      vi.runAllTimers();
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
