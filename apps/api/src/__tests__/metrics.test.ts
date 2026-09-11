import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import metricsPlugin, { generatePrometheusMetrics } from '../plugins/metrics';

describe('Prometheus Metrics Exporter & HPA Integration (#191)', () => {
  it('generates standard Prometheus text format containing queue and latency metrics', () => {
    const text = generatePrometheusMetrics({
      queueName: 'webhooks',
      waitingCount: 145,
      activeCount: 12,
      completedCount: 9800,
      failedCount: 4,
      avgLatencyMs: 38.2,
      activeWorkers: 6,
    });

    expect(text).toContain('stellar_alerts_queue_waiting_jobs{queue="webhooks"} 145');
    expect(text).toContain('stellar_alerts_queue_active_jobs{queue="webhooks"} 12');
    expect(text).toContain('stellar_alerts_queue_completed_jobs_total{queue="webhooks"} 9800');
    expect(text).toContain('stellar_alerts_queue_failed_jobs_total{queue="webhooks"} 4');
    expect(text).toContain('stellar_alerts_worker_processing_latency_ms{queue="webhooks"} 38.2');
    expect(text).toContain('stellar_alerts_active_workers_count 6');
    expect(text).toContain('process_uptime_seconds');
    expect(text).toContain('nodejs_heap_used_bytes');
  });

  it('exposes GET /metrics endpoint returning text/plain Prometheus format', async () => {
    const app = Fastify();
    await app.register(metricsPlugin);

    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('stellar_alerts_queue_waiting_jobs');
    expect(response.body).toContain('stellar_alerts_worker_processing_latency_ms');

    await app.close();
  });
});
