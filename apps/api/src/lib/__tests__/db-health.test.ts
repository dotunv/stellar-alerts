import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  checkAndCompensateLag,
  getReplicaLagStatus,
  resetReplicaLagState,
  calculateReplicationLag,
  startLagMonitor,
  stopLagMonitor,
  ReplicaLagConfig,
} from '../db-health';
import {
  activeReadTarget,
  getReadClient,
  prisma,
  replicaPrisma,
  setReadTarget,
} from '../prisma';

describe('Self-Healing DB Connection Pool & Read-Replica Lag Compensator (#214)', () => {
  beforeEach(() => {
    resetReplicaLagState();
  });

  afterEach(() => {
    stopLagMonitor();
    resetReplicaLagState();
  });

  it('should initialize with REPLICA routing target and healthy status', () => {
    const status = getReplicaLagStatus();
    expect(status.activeReadTarget).toBe('REPLICA');
    expect(status.isFallbackActive).toBe(false);
    expect(status.currentLagMs).toBe(0);
    expect(status.status).toBe('HEALTHY');
    expect(activeReadTarget).toBe('REPLICA');
    expect(getReadClient()).toBe(replicaPrisma);
  });

  it('should dynamically fall back to primary DB when read-replica lag exceeds 500ms', async () => {
    // Simulate high replication lag spike of 650ms (> 500ms threshold)
    const status = await checkAndCompensateLag({}, 650);

    expect(status.activeReadTarget).toBe('PRIMARY');
    expect(status.isFallbackActive).toBe(true);
    expect(status.currentLagMs).toBe(650);
    expect(status.status).toBe('LAGGING');
    expect(activeReadTarget).toBe('PRIMARY');
    expect(getReadClient()).toBe(prisma);
  });

  it('should auto-resume read-replica routing when replication lag normalizes below 100ms', async () => {
    // 1. Trigger lag spike > 500ms to force primary fallback
    await checkAndCompensateLag({}, 750);
    expect(activeReadTarget).toBe('PRIMARY');
    expect(getReadClient()).toBe(prisma);

    // 2. Replication lag drops to 50ms (< 100ms recovery threshold)
    const status = await checkAndCompensateLag({}, 50);

    expect(status.activeReadTarget).toBe('REPLICA');
    expect(status.isFallbackActive).toBe(false);
    expect(status.currentLagMs).toBe(50);
    expect(status.status).toBe('HEALTHY');
    expect(activeReadTarget).toBe('REPLICA');
    expect(getReadClient()).toBe(replicaPrisma);
  });

  it('should maintain current routing target when lag is within hysteresis band (100ms - 500ms)', async () => {
    // Starting in REPLICA target mode with lag = 250ms (between 100ms and 500ms)
    let status = await checkAndCompensateLag({}, 250);
    expect(status.activeReadTarget).toBe('REPLICA');

    // Trigger fallback to PRIMARY
    await checkAndCompensateLag({}, 600);
    expect(activeReadTarget).toBe('PRIMARY');

    // Lag recovers partially to 300ms (still > 100ms recovery threshold)
    status = await checkAndCompensateLag({}, 300);
    expect(status.activeReadTarget).toBe('PRIMARY');
    expect(status.isFallbackActive).toBe(true);

    // Lag drops fully to 80ms (< 100ms recovery threshold)
    status = await checkAndCompensateLag({}, 80);
    expect(status.activeReadTarget).toBe('REPLICA');
    expect(status.isFallbackActive).toBe(false);
  });

  it('should use custom lag and recovery thresholds when provided in config', async () => {
    const customConfig: Partial<ReplicaLagConfig> = {
      lagThresholdMs: 300,
      recoveryThresholdMs: 50,
    };

    // Lag = 350ms (> 300ms custom threshold)
    let status = await checkAndCompensateLag(customConfig, 350);
    expect(status.activeReadTarget).toBe('PRIMARY');

    // Lag = 80ms (> 50ms custom recovery threshold, so remains PRIMARY)
    status = await checkAndCompensateLag(customConfig, 80);
    expect(status.activeReadTarget).toBe('PRIMARY');

    // Lag = 30ms (< 50ms custom recovery threshold, so recovers REPLICA)
    status = await checkAndCompensateLag(customConfig, 30);
    expect(status.activeReadTarget).toBe('REPLICA');
  });

  it('should fall back to primary DB when lag query calculation fails', async () => {
    const status = await checkAndCompensateLag({}, null, async () => {
      throw new Error('Database connection reset');
    });

    expect(status.activeReadTarget).toBe('PRIMARY');
    expect(status.isFallbackActive).toBe(true);
    expect(status.status).toBe('ERROR');
    expect(activeReadTarget).toBe('PRIMARY');
  });

  it('should calculate replication lag via mock query function', async () => {
    const mockQueryLag = async () => 120;
    const lag = await calculateReplicationLag(mockQueryLag);
    expect(lag).toBe(120);
  });
});
