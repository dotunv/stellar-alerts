import { describe, expect, it } from 'vitest';
import { SSENetworkInjector } from '../../../../scripts/benchmark-stream';

describe('SSENetworkInjector Benchmark Suite (#197)', () => {
  it('generates well-formed mock Horizon payment events', () => {
    const injector = new SSENetworkInjector();
    const event = injector.generateMockEvent(42, 55000000);

    expect(event.id).toContain('op_mock_42');
    expect(event.type).toBe('payment');
    expect(event.ledger).toBe(55000000);
    expect(event.source_account).toBeDefined();
    expect(Number(event.amount)).toBeGreaterThan(0);
  });

  it('runs benchmark loop and computes accurate throughput and latency percentiles', async () => {
    const injector = new SSENetworkInjector({
      targetTps: 5000,
      durationSeconds: 0.2,
      batchSize: 200,
      dryRun: true,
    });

    const metrics = await injector.runBenchmark();

    expect(metrics.totalEventsInjected).toBeGreaterThanOrEqual(1000);
    expect(metrics.achievedTps).toBeGreaterThan(0);
    expect(metrics.actualDurationSeconds).toBeGreaterThan(0);
    expect(metrics.averageLatencyMs).toBeGreaterThanOrEqual(0);
    expect(metrics.p95LatencyMs).toBeGreaterThanOrEqual(0);
    expect(metrics.memoryUsageMb.heapUsed).toBeGreaterThan(0);
  });
});
