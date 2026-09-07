import { PrismaClient } from '../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env';

export let activeDatabaseUrl = process.env.DATABASE_URL || env.DATABASE_URL || 'postgresql://user:password@localhost:5432/stellar_alerts?schema=public';
export let activeReadDatabaseUrl = process.env.READ_REPLICA_URL || process.env.DATABASE_URL || env.DATABASE_URL || 'postgresql://user:password@localhost:5432/stellar_alerts?schema=public';

let adapter = new PrismaPg({
  connectionString: activeDatabaseUrl,
});

export let prisma = new PrismaClient({ adapter });

let readAdapter = new PrismaPg({
  connectionString: activeReadDatabaseUrl,
});

export let replicaPrisma = new PrismaClient({ adapter: readAdapter });

export type DatabaseTarget = 'PRIMARY' | 'REPLICA';
export let activeReadTarget: DatabaseTarget = 'REPLICA';

/**
 * Returns the active PrismaClient for read operations.
 * Dynamically routes to replicaPrisma or primary prisma based on lag status.
 */
export function getReadClient(): PrismaClient {
  return activeReadTarget === 'PRIMARY' ? prisma : replicaPrisma;
}

/**
 * Updates active read traffic target (PRIMARY or REPLICA).
 */
export function setReadTarget(target: DatabaseTarget): void {
  activeReadTarget = target;
  console.log(`[DB Pool Engine] 🔀 Read traffic target updated to: ${target}`);
}

export async function switchDatabaseUrl(newConnectionString: string): Promise<void> {
  console.log(`[DR Engine] 🔄 Switching database connection pool to secondary region: ${newConnectionString}`);
  activeDatabaseUrl = newConnectionString;
  process.env.DATABASE_URL = newConnectionString;

  try {
    await prisma.$disconnect();
  } catch (_) {}

  adapter = new PrismaPg({
    connectionString: newConnectionString,
  });
  prisma = new PrismaClient({ adapter });
}

export async function switchReadDatabaseUrl(newConnectionString: string): Promise<void> {
  console.log(`[DB Pool Engine] 🔄 Switching read replica connection pool: ${newConnectionString}`);
  activeReadDatabaseUrl = newConnectionString;
  process.env.READ_REPLICA_URL = newConnectionString;

  try {
    await replicaPrisma.$disconnect();
  } catch (_) {}

  readAdapter = new PrismaPg({
    connectionString: newConnectionString,
  });
  replicaPrisma = new PrismaClient({ adapter: readAdapter });
}

export async function connectWithRetry(retries = 5, delay = 1000) {
  let attempt = 0;
  while (attempt < retries) {
    try {
      await prisma.$connect();
      console.log('✅ Successfully connected to database');
      return;
    } catch (error: any) {
      attempt++;
      console.warn(`⚠️ Database connection failed (attempt ${attempt}/${retries}): ${error.message}`);
      if (attempt >= retries) {
        console.error('❌ Exceeded maximum retries for database connection. Exiting.');
        process.exit(1);
      }
      await new Promise(res => setTimeout(res, delay));
      delay *= 2; // Exponential backoff
    }
  }
}
