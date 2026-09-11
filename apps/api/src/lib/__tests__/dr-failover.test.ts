import { describe, it, expect, beforeEach } from 'vitest';
import {
  monitorAndFailover,
  simulateDNSBlackhole,
  triggerFailover,
  getDRStatus,
  resetDRState,
  DRConfig,
} from '../../../../../scripts/dr-failover';

describe('Multi-Region Disaster Recovery Sync Engine (#144)', () => {
  const testConfig: DRConfig = {
    primaryDatabaseUrl: 'postgresql://user:pass@primary-db.internal:5432/db',
    secondaryDatabaseUrl: 'postgresql://user:pass@secondary-db.internal:5432/db_failover',
    primaryRedisUrl: 'redis://primary-redis.internal:6379',
    secondaryRedisUrl: 'redis://secondary-redis.internal:6379',
    healthCheckTimeoutMs: 1000,
    maxConsecutiveFailures: 3, // 3 failed probes = 15s outage detection threshold
  };

  beforeEach(() => {
    resetDRState(testConfig);
  });

  it('should start in PRIMARY region with HEALTHY status', () => {
    const status = getDRStatus();
    expect(status.activeRegion).toBe('PRIMARY');
    expect(status.primaryHealth).toBe('HEALTHY');
    expect(status.consecutiveFailures).toBe(0);
  });

  it('should detect primary outage and trigger failover to secondary within 15 seconds threshold', async () => {
    // Probe 1 (5s)
    let status = await monitorAndFailover(testConfig, async () => false);
    expect(status.consecutiveFailures).toBe(1);
    expect(status.activeRegion).toBe('PRIMARY');

    // Probe 2 (10s)
    status = await monitorAndFailover(testConfig, async () => false);
    expect(status.consecutiveFailures).toBe(2);
    expect(status.activeRegion).toBe('PRIMARY');

    // Probe 3 (15s threshold reached)
    status = await monitorAndFailover(testConfig, async () => false);
    expect(status.activeRegion).toBe('SECONDARY');
    expect(status.activeDatabaseUrl).toBe(testConfig.secondaryDatabaseUrl);
    expect(status.activeRedisUrl).toBe(testConfig.secondaryRedisUrl);
    expect(process.env.REDIS_URL).toBe(testConfig.secondaryRedisUrl);
  });

  it('should switch connection strings upon DNS blackhole simulation', async () => {
    simulateDNSBlackhole(true);
    expect(getDRStatus().primaryHealth).toBe('BLACKHOLED');

    // Monitor should detect blackhole failure
    const status = await monitorAndFailover(testConfig);
    expect(status.consecutiveFailures).toBe(1);

    // Trigger explicit failover
    const failoverStatus = await triggerFailover(testConfig);
    expect(failoverStatus.activeRegion).toBe('SECONDARY');
    expect(failoverStatus.activeDatabaseUrl).toBe(testConfig.secondaryDatabaseUrl);
  });

  it('should reset consecutive failure counter when primary recovers before threshold', async () => {
    await monitorAndFailover(testConfig, async () => false);
    await monitorAndFailover(testConfig, async () => false);
    expect(getDRStatus().consecutiveFailures).toBe(2);

    // Primary recovers
    await monitorAndFailover(testConfig, async () => true);
    expect(getDRStatus().consecutiveFailures).toBe(0);
    expect(getDRStatus().activeRegion).toBe('PRIMARY');
  });
});
