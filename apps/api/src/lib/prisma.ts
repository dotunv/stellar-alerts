import { PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env';
import { resolvePoolConfig } from './db-pool';

function createClient(databaseUrl: string, label: string) {
  const config = resolvePoolConfig(databaseUrl);
  console.log(
    `[Prisma] ${label} pool: max=${config.max} connections, acquire timeout=${config.connectionTimeoutMillis}ms, idle timeout=${config.idleTimeoutMillis}ms`
  );

  return new PrismaClient({ adapter: new PrismaPg(config) });
}

const primaryUrl = env.DATABASE_URL || process.env.DATABASE_URL!;
const replicaUrl = env.DATABASE_REPLICA_URL || process.env.DATABASE_REPLICA_URL;

export const prisma = createClient(primaryUrl, 'primary');

/**
 * Client for read-only queries. Points at DATABASE_REPLICA_URL when a read
 * replica is configured and falls back to the primary otherwise, so callers can
 * use it unconditionally.
 */
export const prismaRead = replicaUrl ? createClient(replicaUrl, 'replica') : prisma;
