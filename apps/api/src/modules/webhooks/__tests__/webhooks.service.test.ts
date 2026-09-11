import { describe, it, expect, beforeEach } from 'vitest';
import { WebhooksService } from '../webhooks.service';

describe('WebhooksService Health Scorecard & Diagnostics (#161)', () => {
  let service: WebhooksService;

  beforeEach(() => {
    service = new WebhooksService();
  });

  it('should return 100% health and HEALTHY status for a fresh webhook with no logs', () => {
    const scorecard = service.calculateHealthScorecard([]);
    expect(scorecard.healthPercentage).toBe(100.0);
    expect(scorecard.status).toBe('HEALTHY');
    expect(scorecard.totalDeliveries7d).toBe(0);
    expect(scorecard.successfulDeliveries7d).toBe(0);
    expect(scorecard.failedDeliveries7d).toBe(0);
  });

  it('should calculate 100% health and HEALTHY status when all deliveries succeed', () => {
    const logs = [
      { statusCode: 200 },
      { statusCode: 201 },
      { statusCode: 204 },
      { statusCode: 200 },
    ];
    const scorecard = service.calculateHealthScorecard(logs);
    expect(scorecard.healthPercentage).toBe(100.0);
    expect(scorecard.status).toBe('HEALTHY');
    expect(scorecard.totalDeliveries7d).toBe(4);
    expect(scorecard.successfulDeliveries7d).toBe(4);
    expect(scorecard.failedDeliveries7d).toBe(0);
  });

  it('should flag endpoint with <90% uptime as DEGRADED (e.g. 75% success rate)', () => {
    const logs = [
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 500 }, // 3 success / 4 total = 75%
    ];
    const scorecard = service.calculateHealthScorecard(logs);
    expect(scorecard.healthPercentage).toBe(75.0);
    expect(scorecard.status).toBe('DEGRADED');
    expect(scorecard.totalDeliveries7d).toBe(4);
    expect(scorecard.successfulDeliveries7d).toBe(3);
    expect(scorecard.failedDeliveries7d).toBe(1);
  });

  it('should flag endpoint with 80% uptime as DEGRADED', () => {
    const logs = [
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 502 }, // 4/5 = 80%
    ];
    const scorecard = service.calculateHealthScorecard(logs);
    expect(scorecard.healthPercentage).toBe(80.0);
    expect(scorecard.status).toBe('DEGRADED');
  });

  it('should flag endpoint with exactly 90% or higher uptime as HEALTHY', () => {
    const logs = [
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 200 },
      { statusCode: 500 }, // 9/10 = 90%
    ];
    const scorecard = service.calculateHealthScorecard(logs);
    expect(scorecard.healthPercentage).toBe(90.0);
    expect(scorecard.status).toBe('HEALTHY');
  });
});
