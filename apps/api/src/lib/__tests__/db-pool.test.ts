import { describe, it, expect } from 'vitest';
import { resolvePoolConfig } from '../db-pool';

const baseUrl = 'postgresql://user:password@localhost:5432/stellar_alerts?schema=public';

describe('resolvePoolConfig', () => {
  it('applies pool defaults when the URL carries no pool parameters', () => {
    const config = resolvePoolConfig(baseUrl);

    expect(config.max).toBe(20);
    expect(config.connectionTimeoutMillis).toBe(10_000);
    expect(config.idleTimeoutMillis).toBe(30_000);
  });

  it('reads connection_limit, pool_timeout and idle_timeout off the URL', () => {
    const config = resolvePoolConfig(`${baseUrl}&connection_limit=50&pool_timeout=25&idle_timeout=5`);

    expect(config.max).toBe(50);
    expect(config.connectionTimeoutMillis).toBe(25_000);
    expect(config.idleTimeoutMillis).toBe(5_000);
  });

  it('strips pool parameters from the connection string handed to the driver', () => {
    const config = resolvePoolConfig(`${baseUrl}&connection_limit=50&pool_timeout=25&idle_timeout=5`);

    expect(config.connectionString).toBe(baseUrl);
  });

  it('keeps unrelated query parameters intact', () => {
    const config = resolvePoolConfig(`${baseUrl}&sslmode=require&connection_limit=8`);

    expect(config.connectionString).toContain('schema=public');
    expect(config.connectionString).toContain('sslmode=require');
    expect(config.max).toBe(8);
  });

  it('treats pool_timeout=0 as an uncapped wait for a free connection', () => {
    const config = resolvePoolConfig(`${baseUrl}&pool_timeout=0`);

    expect(config.connectionTimeoutMillis).toBe(0);
  });

  it('falls back to the default when a pool parameter is not a valid number', () => {
    const config = resolvePoolConfig(`${baseUrl}&connection_limit=many&pool_timeout=-3`);

    expect(config.max).toBe(20);
    expect(config.connectionTimeoutMillis).toBe(10_000);
  });
});
