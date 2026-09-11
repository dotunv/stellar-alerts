import { prisma, replicaPrisma, setReadTarget, DatabaseTarget } from './prisma';

export interface ReplicaLagConfig {
  primaryDatabaseUrl: string;
  replicaDatabaseUrl: string;
  lagThresholdMs: number; // > 500ms -> fallback to primary DB
  recoveryThresholdMs: number; // < 100ms -> auto-resume replica routing
  checkIntervalMs: number;
}

export interface ReplicaLagStatus {
  activeReadTarget: DatabaseTarget;
  currentLagMs: number;
  isFallbackActive: boolean;
  lastCheckTime: Date | null;
  status: 'HEALTHY' | 'LAGGING' | 'ERROR';
}

const defaultConfig: ReplicaLagConfig = {
  primaryDatabaseUrl: process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/stellar_alerts?schema=public',
  replicaDatabaseUrl: process.env.READ_REPLICA_URL || process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/stellar_alerts?schema=public',
  lagThresholdMs: 500,
  recoveryThresholdMs: 100,
  checkIntervalMs: 5000,
};

let currentLagStatus: ReplicaLagStatus = {
  activeReadTarget: 'REPLICA',
  currentLagMs: 0,
  isFallbackActive: false,
  lastCheckTime: null,
  status: 'HEALTHY',
};

let monitorInterval: NodeJS.Timeout | null = null;

/**
 * Calculates current PostgreSQL WAL replication lag in milliseconds.
 * Monitors pg_last_wal_receive_lsn() & pg_last_wal_replay_lsn() or replication timestamp.
 */
export async function calculateReplicationLag(
  fetchLagQueryFn?: () => Promise<number>
): Promise<number> {
  if (fetchLagQueryFn) {
    return await fetchLagQueryFn();
  }

  try {
    const result = await replicaPrisma.$queryRaw<Array<{ lag_ms: number | null }>>`
      SELECT 
        CASE 
          WHEN pg_is_in_recovery() THEN
            COALESCE(
              EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) * 1000,
              pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn()) / 1024,
              0
            )
          ELSE 0
        END AS lag_ms
    `;

    if (result && result.length > 0 && result[0].lag_ms !== null) {
      return Math.max(0, Number(result[0].lag_ms));
    }
    return 0;
  } catch (error) {
    console.warn(`[DB Health Engine] ⚠️ Error querying read-replica WAL lag: ${(error as Error).message}`);
    // Return high lag to trigger safety fallback to primary DB when lag query fails
    return 9999;
  }
}

/**
 * Evaluates read-replica WAL lag and dynamically updates database connection routing:
 * - Dynamically falls back to primary DB when read-replica lag exceeds 500ms
 * - Auto-resumes read-replica routing when replication lag normalizes below 100ms
 */
export async function checkAndCompensateLag(
  config: Partial<ReplicaLagConfig> = {},
  lagOverride?: number | null,
  fetchLagQueryFn?: () => Promise<number>
): Promise<ReplicaLagStatus> {
  const mergedConfig = { ...defaultConfig, ...config };

  let lagMs: number;
  let hasError = false;

  try {
    if (lagOverride !== undefined && lagOverride !== null) {
      lagMs = lagOverride;
    } else {
      lagMs = await calculateReplicationLag(fetchLagQueryFn);
    }
  } catch (err) {
    hasError = true;
    lagMs = 9999;
  }

  currentLagStatus.currentLagMs = lagMs;
  currentLagStatus.lastCheckTime = new Date();

  // High WAL lag spike (> 500ms) or DB error -> fall back to Primary DB
  if (hasError || lagMs > mergedConfig.lagThresholdMs) {
    if (currentLagStatus.activeReadTarget !== 'PRIMARY') {
      console.warn(
        `[DB Health Engine] 🚨 Read-replica WAL lag (${lagMs}ms) exceeds threshold (${mergedConfig.lagThresholdMs}ms). Auto-routing read traffic to primary DB.`
      );
    }
    currentLagStatus.activeReadTarget = 'PRIMARY';
    currentLagStatus.isFallbackActive = true;
    currentLagStatus.status = hasError ? 'ERROR' : 'LAGGING';
    setReadTarget('PRIMARY');
  }
  // Lag normalized below 100ms -> auto-resume routing to Read Replica
  else if (lagMs < mergedConfig.recoveryThresholdMs) {
    if (currentLagStatus.activeReadTarget !== 'REPLICA') {
      console.log(
        `[DB Health Engine] 🟢 Read-replica WAL lag (${lagMs}ms) normalized below ${mergedConfig.recoveryThresholdMs}ms. Auto-resuming read-replica routing.`
      );
    }
    currentLagStatus.activeReadTarget = 'REPLICA';
    currentLagStatus.isFallbackActive = false;
    currentLagStatus.status = 'HEALTHY';
    setReadTarget('REPLICA');
  }
  // Lag between recovery threshold (100ms) and lag threshold (500ms): preserve existing routing target (hysteresis)

  return { ...currentLagStatus };
}

/**
 * Returns current read-replica replication lag compensator status.
 */
export function getReplicaLagStatus(): ReplicaLagStatus {
  return { ...currentLagStatus };
}

/**
 * Resets the lag status state and read routing target (for testing/cleanup).
 */
export function resetReplicaLagState(config: Partial<ReplicaLagConfig> = {}): void {
  currentLagStatus = {
    activeReadTarget: 'REPLICA',
    currentLagMs: 0,
    isFallbackActive: false,
    lastCheckTime: null,
    status: 'HEALTHY',
  };
  setReadTarget('REPLICA');
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

/**
 * Starts periodic monitoring of read-replica WAL lag.
 */
export function startLagMonitor(
  config: Partial<ReplicaLagConfig> = {},
  fetchLagQueryFn?: () => Promise<number>
): NodeJS.Timeout {
  const mergedConfig = { ...defaultConfig, ...config };
  if (monitorInterval) {
    clearInterval(monitorInterval);
  }
  monitorInterval = setInterval(async () => {
    await checkAndCompensateLag(mergedConfig, undefined, fetchLagQueryFn);
  }, mergedConfig.checkIntervalMs);

  return monitorInterval;
}

/**
 * Stops periodic monitoring of read-replica WAL lag.
 */
export function stopLagMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}
