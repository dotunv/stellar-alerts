import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryMonitor, takeMemorySnapshot } from '../memory-monitor';

function fakeUsage(heapUsedMB: number, heapTotalMB: number = 100): () => NodeJS.MemoryUsage {
  return () => ({
    heapUsed: heapUsedMB * 1024 * 1024,
    heapTotal: heapTotalMB * 1024 * 1024,
    rss: heapTotalMB * 1.5 * 1024 * 1024,
    external: 0,
    arrayBuffers: 0,
  });
}

const silentLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('takeMemorySnapshot', () => {
  it('computes usageRatio as heapUsed/heapTotal', () => {
    const snapshot = takeMemorySnapshot(fakeUsage(50, 100));
    expect(snapshot.usageRatio).toBeCloseTo(0.5);
    expect(snapshot.heapUsed).toBe(50 * 1024 * 1024);
  });

  it('does not divide by zero when heapTotal is reported as 0', () => {
    const snapshot = takeMemorySnapshot(fakeUsage(0, 0));
    expect(snapshot.usageRatio).toBe(0);
    expect(Number.isFinite(snapshot.usageRatio)).toBe(true);
  });
});

describe('MemoryMonitor threshold logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing below the cleanup threshold', () => {
    const onCleanup = vi.fn();
    const onRestartRequired = vi.fn();
    const runGC = vi.fn().mockReturnValue(true);
    const monitor = new MemoryMonitor({
      getMemoryUsage: fakeUsage(50, 100), // 50%
      onCleanup,
      onRestartRequired,
      runGC,
      logger: silentLogger,
    });

    monitor.checkOnce();

    expect(onCleanup).not.toHaveBeenCalled();
    expect(onRestartRequired).not.toHaveBeenCalled();
    expect(runGC).not.toHaveBeenCalled();
  });

  it('triggers a GC cleanup pass once usage crosses the cleanup threshold (85% default)', () => {
    const onCleanup = vi.fn();
    const runGC = vi.fn().mockReturnValue(true);
    const monitor = new MemoryMonitor({
      getMemoryUsage: fakeUsage(90, 100), // 90% — over 85%, under 95%
      onCleanup,
      runGC,
      logger: silentLogger,
    });

    const snapshot = monitor.checkOnce();

    expect(runGC).toHaveBeenCalledTimes(1);
    expect(onCleanup).toHaveBeenCalledWith(snapshot, true);
  });

  it('reports gcRan=false to onCleanup when global.gc is unavailable', () => {
    const onCleanup = vi.fn();
    const monitor = new MemoryMonitor({
      getMemoryUsage: fakeUsage(90, 100),
      onCleanup,
      runGC: () => false, // simulates process not started with --expose-gc
      logger: silentLogger,
    });

    monitor.checkOnce();

    expect(onCleanup).toHaveBeenCalledWith(expect.anything(), false);
  });

  it('does not request a restart on a single sample at/above the restart threshold', () => {
    const onRestartRequired = vi.fn();
    const monitor = new MemoryMonitor({
      getMemoryUsage: fakeUsage(96, 100), // 96% — over the 95% default restart threshold
      onRestartRequired,
      consecutiveBreachesForRestart: 3,
      logger: silentLogger,
    });

    monitor.checkOnce();
    monitor.checkOnce();

    expect(onRestartRequired).not.toHaveBeenCalled();
  });

  it('requests a restart once usage stays at/above the restart threshold for N consecutive checks', () => {
    const onRestartRequired = vi.fn();
    const monitor = new MemoryMonitor({
      getMemoryUsage: fakeUsage(96, 100),
      onRestartRequired,
      consecutiveBreachesForRestart: 3,
      logger: silentLogger,
    });

    monitor.checkOnce();
    monitor.checkOnce();
    expect(onRestartRequired).not.toHaveBeenCalled();

    const snapshot = monitor.checkOnce();
    expect(onRestartRequired).toHaveBeenCalledTimes(1);
    expect(onRestartRequired).toHaveBeenCalledWith(snapshot);
  });

  it('does not call onRestartRequired again on every subsequent tick while still breached', () => {
    const onRestartRequired = vi.fn();
    const monitor = new MemoryMonitor({
      getMemoryUsage: fakeUsage(99, 100),
      onRestartRequired,
      consecutiveBreachesForRestart: 2,
      logger: silentLogger,
    });

    monitor.checkOnce();
    monitor.checkOnce(); // fires here
    monitor.checkOnce();
    monitor.checkOnce();

    expect(onRestartRequired).toHaveBeenCalledTimes(1);
  });

  it('resets the breach streak once usage drops back below the restart threshold', () => {
    const onRestartRequired = vi.fn();
    let usage = fakeUsage(96, 100);
    const monitor = new MemoryMonitor({
      getMemoryUsage: () => usage(),
      onRestartRequired,
      consecutiveBreachesForRestart: 3,
      logger: silentLogger,
    });

    monitor.checkOnce();
    monitor.checkOnce();
    // Recovers before the 3rd consecutive breach.
    usage = fakeUsage(50, 100);
    monitor.checkOnce();

    usage = fakeUsage(96, 100);
    monitor.checkOnce();
    monitor.checkOnce();
    expect(onRestartRequired).not.toHaveBeenCalled();
    monitor.checkOnce(); // now the 3rd consecutive breach of this new streak
    expect(onRestartRequired).toHaveBeenCalledTimes(1);
  });

  it('allows a second restart request after usage recovers and breaches again', () => {
    const onRestartRequired = vi.fn();
    let usage = fakeUsage(96, 100);
    const monitor = new MemoryMonitor({
      getMemoryUsage: () => usage(),
      onRestartRequired,
      consecutiveBreachesForRestart: 1,
      logger: silentLogger,
    });

    monitor.checkOnce();
    expect(onRestartRequired).toHaveBeenCalledTimes(1);

    usage = fakeUsage(50, 100);
    monitor.checkOnce(); // recovers

    usage = fakeUsage(96, 100);
    monitor.checkOnce(); // breaches again
    expect(onRestartRequired).toHaveBeenCalledTimes(2);
  });

  it('does not run GC once usage has escalated past the restart threshold (restart takes priority)', () => {
    const runGC = vi.fn();
    const onCleanup = vi.fn();
    const monitor = new MemoryMonitor({
      getMemoryUsage: fakeUsage(97, 100),
      runGC,
      onCleanup,
      consecutiveBreachesForRestart: 5,
      logger: silentLogger,
    });

    monitor.checkOnce();

    expect(runGC).not.toHaveBeenCalled();
    expect(onCleanup).not.toHaveBeenCalled();
  });

  it('rejects a cleanupThreshold configured at or above the restartThreshold', () => {
    expect(() => new MemoryMonitor({ cleanupThreshold: 0.9, restartThreshold: 0.9 })).toThrow(
      /cleanupThreshold must be lower/,
    );
    expect(() => new MemoryMonitor({ cleanupThreshold: 0.95, restartThreshold: 0.9 })).toThrow(
      /cleanupThreshold must be lower/,
    );
  });

  it('respects custom threshold configuration', () => {
    const onCleanup = vi.fn();
    const monitor = new MemoryMonitor({
      getMemoryUsage: fakeUsage(60, 100), // 60%
      cleanupThreshold: 0.5,
      restartThreshold: 0.9,
      onCleanup,
      runGC: () => true,
      logger: silentLogger,
    });

    monitor.checkOnce();
    expect(onCleanup).toHaveBeenCalled();
  });
});

describe('MemoryMonitor start/stop', () => {
  it('samples on the configured interval and can be stopped', () => {
    vi.useFakeTimers();
    try {
      const onCleanup = vi.fn();
      const monitor = new MemoryMonitor({
        getMemoryUsage: fakeUsage(90, 100),
        intervalMs: 1000,
        onCleanup,
        runGC: () => true,
        logger: silentLogger,
      });

      monitor.start();
      expect(onCleanup).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      expect(onCleanup).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(2000);
      expect(onCleanup).toHaveBeenCalledTimes(3);

      monitor.stop();
      vi.advanceTimersByTime(5000);
      expect(onCleanup).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('starting an already-started monitor does not create a second timer', () => {
    vi.useFakeTimers();
    try {
      const onCleanup = vi.fn();
      const monitor = new MemoryMonitor({
        getMemoryUsage: fakeUsage(90, 100),
        intervalMs: 1000,
        onCleanup,
        runGC: () => true,
        logger: silentLogger,
      });

      monitor.start();
      monitor.start();
      vi.advanceTimersByTime(1000);

      expect(onCleanup).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
