/**
 * Watches this process's V8 heap usage and reacts before an OOM kill:
 * first by attempting a graceful GC pass, then — if usage stays pegged
 * despite that — by asking the caller to restart the process cleanly
 * (e.g. `process.exit()`, which `WorkerSupervisor` already respawns with
 * backoff — see workers/supervisor.ts) rather than waiting for the OS or
 * V8 to kill it mid-request.
 *
 * All side effects (reading memory, running GC, restarting) are injected,
 * so the threshold/hysteresis logic is fully unit-testable without a real
 * heap or a real process.
 */

export interface MemorySnapshot {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
  /** heapUsed / heapTotal, in [0, 1] (can exceed 1 only if heapTotal is misreported as 0). */
  usageRatio: number;
  timestamp: number;
}

export type MemoryMonitorLogger = Pick<Console, 'log' | 'warn' | 'error'>;

export interface MemoryMonitorOptions {
  /** Fraction of heap capacity at which a GC pass is triggered. Default 0.85 (85%). */
  cleanupThreshold?: number;
  /** Fraction of heap capacity at which a graceful restart is requested. Default 0.95 (95%). */
  restartThreshold?: number;
  /** How many consecutive samples must stay at/above restartThreshold before a restart is actually requested — absorbs a transient spike (e.g. a large batch just finished). Default 3. */
  consecutiveBreachesForRestart?: number;
  /** How often to sample, in ms. Default 30000. */
  intervalMs?: number;
  /** Source of memory stats. Defaults to `process.memoryUsage`. */
  getMemoryUsage?: () => NodeJS.MemoryUsage;
  /** Attempts to run V8 GC; returns whether it actually ran. Defaults to `global.gc` when the process was started with --expose-gc, else a no-op that returns false. */
  runGC?: () => boolean;
  /** Called after an attempted GC pass when usage first crosses cleanupThreshold. */
  onCleanup?: (snapshot: MemorySnapshot, gcRan: boolean) => void;
  /** Called once, when usage has stayed at/above restartThreshold for consecutiveBreachesForRestart samples in a row. Not called again until usage first drops back below restartThreshold (avoids requesting a second restart before the first one has taken effect). */
  onRestartRequired?: (snapshot: MemorySnapshot) => void;
  logger?: MemoryMonitorLogger;
}

const DEFAULT_CLEANUP_THRESHOLD = 0.85;
const DEFAULT_RESTART_THRESHOLD = 0.95;
const DEFAULT_CONSECUTIVE_BREACHES = 3;
const DEFAULT_INTERVAL_MS = 30_000;

function defaultRunGC(): boolean {
  const gc = (global as typeof global & { gc?: () => void }).gc;
  if (typeof gc !== 'function') return false;
  gc();
  return true;
}

export function takeMemorySnapshot(getMemoryUsage: () => NodeJS.MemoryUsage = process.memoryUsage): MemorySnapshot {
  const usage = getMemoryUsage();
  const usageRatio = usage.heapTotal > 0 ? usage.heapUsed / usage.heapTotal : 0;
  return {
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    rss: usage.rss,
    external: usage.external,
    usageRatio,
    timestamp: Date.now(),
  };
}

export class MemoryMonitor {
  private readonly cleanupThreshold: number;
  private readonly restartThreshold: number;
  private readonly consecutiveBreachesForRestart: number;
  private readonly intervalMs: number;
  private readonly getMemoryUsage: () => NodeJS.MemoryUsage;
  private readonly runGC: () => boolean;
  private readonly onCleanup?: (snapshot: MemorySnapshot, gcRan: boolean) => void;
  private readonly onRestartRequired?: (snapshot: MemorySnapshot) => void;
  private readonly logger: MemoryMonitorLogger;

  private timer: NodeJS.Timeout | null = null;
  private consecutiveBreaches = 0;
  private restartAlreadyRequested = false;

  constructor(options: MemoryMonitorOptions = {}) {
    if (
      options.cleanupThreshold !== undefined &&
      options.restartThreshold !== undefined &&
      options.cleanupThreshold >= options.restartThreshold
    ) {
      throw new Error('cleanupThreshold must be lower than restartThreshold');
    }

    this.cleanupThreshold = options.cleanupThreshold ?? DEFAULT_CLEANUP_THRESHOLD;
    this.restartThreshold = options.restartThreshold ?? DEFAULT_RESTART_THRESHOLD;
    this.consecutiveBreachesForRestart = options.consecutiveBreachesForRestart ?? DEFAULT_CONSECUTIVE_BREACHES;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.getMemoryUsage = options.getMemoryUsage ?? process.memoryUsage;
    this.runGC = options.runGC ?? defaultRunGC;
    this.onCleanup = options.onCleanup;
    this.onRestartRequired = options.onRestartRequired;
    this.logger = options.logger ?? console;
  }

  /**
   * Samples memory once and applies the threshold/hysteresis logic. Pure
   * enough to unit test directly — no timers involved.
   */
  checkOnce(): MemorySnapshot {
    const snapshot = takeMemorySnapshot(this.getMemoryUsage);

    if (snapshot.usageRatio >= this.restartThreshold) {
      this.consecutiveBreaches += 1;

      if (this.consecutiveBreaches >= this.consecutiveBreachesForRestart) {
        if (!this.restartAlreadyRequested) {
          this.restartAlreadyRequested = true;
          this.logger.error(
            `[MemoryMonitor] 🚨 Heap usage at ${(snapshot.usageRatio * 100).toFixed(1)}% ` +
              `for ${this.consecutiveBreaches} consecutive checks — requesting graceful restart.`,
          );
          this.onRestartRequired?.(snapshot);
        }
      } else {
        this.logger.warn(
          `[MemoryMonitor] ⚠️ Heap usage at ${(snapshot.usageRatio * 100).toFixed(1)}% ` +
            `(breach ${this.consecutiveBreaches}/${this.consecutiveBreachesForRestart} before restart)`,
        );
      }
      return snapshot;
    }

    // Usage has recovered below the restart threshold — a future breach
    // streak should be evaluated fresh, and a future crossing may request
    // a restart again.
    this.consecutiveBreaches = 0;
    this.restartAlreadyRequested = false;

    if (snapshot.usageRatio >= this.cleanupThreshold) {
      const gcRan = this.runGC();
      this.logger.warn(
        `[MemoryMonitor] 🧹 Heap usage at ${(snapshot.usageRatio * 100).toFixed(1)}% exceeds ` +
          `cleanup threshold — ${gcRan ? 'ran global.gc()' : 'global.gc() unavailable (start with --expose-gc)'}.`,
      );
      this.onCleanup?.(snapshot, gcRan);
    }

    return snapshot;
  }

  start(): void {
    if (this.timer) return;
    this.logger.log(
      `[MemoryMonitor] 📈 Watching heap usage every ${this.intervalMs}ms ` +
        `(cleanup at ${(this.cleanupThreshold * 100).toFixed(0)}%, restart at ${(this.restartThreshold * 100).toFixed(0)}%)`,
    );
    this.timer = setInterval(() => this.checkOnce(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
