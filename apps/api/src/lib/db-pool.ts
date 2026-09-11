// Pool sizing defaults. The watcher fans out one query per registered wallet on
// every poll, so the pool is sized to absorb a burst well above Postgres' own
// default max_connections while queueing anything over the limit rather than
// failing the query.
const DEFAULT_CONNECTION_LIMIT = 20;
const DEFAULT_POOL_TIMEOUT_SECONDS = 10;
const DEFAULT_IDLE_TIMEOUT_SECONDS = 30;

// Prisma-style pool parameters carried on the connection string. They are not
// understood by node-postgres, so they are read here and stripped before the
// URL reaches the driver.
const POOL_PARAMS = ['connection_limit', 'pool_timeout', 'idle_timeout'] as const;

export interface PoolConfig {
  connectionString: string;
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
}

function readNumericParam(params: URLSearchParams, name: string, fallback: number): number {
  const raw = params.get(name);
  if (raw === null) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    console.warn(`[Prisma] Ignoring invalid ${name}="${raw}", falling back to ${fallback}`);
    return fallback;
  }

  return value;
}

/**
 * Translates the `connection_limit`, `pool_timeout` and `idle_timeout` query
 * parameters of a database URL into node-postgres pool options, applying the
 * defaults above when a parameter is absent.
 */
export function resolvePoolConfig(databaseUrl: string): PoolConfig {
  const url = new URL(databaseUrl);
  const params = url.searchParams;

  const max = readNumericParam(params, 'connection_limit', DEFAULT_CONNECTION_LIMIT);
  const poolTimeout = readNumericParam(params, 'pool_timeout', DEFAULT_POOL_TIMEOUT_SECONDS);
  const idleTimeout = readNumericParam(params, 'idle_timeout', DEFAULT_IDLE_TIMEOUT_SECONDS);

  for (const param of POOL_PARAMS) {
    params.delete(param);
  }

  return {
    connectionString: url.toString(),
    max,
    // pool_timeout is the number of seconds a query waits for a free
    // connection; 0 disables the wait cap, which node-postgres spells as 0 too.
    connectionTimeoutMillis: poolTimeout * 1000,
    idleTimeoutMillis: idleTimeout * 1000,
  };
}
