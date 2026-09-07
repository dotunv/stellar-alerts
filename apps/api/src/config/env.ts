import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  READ_REPLICA_URL: z.string().url().optional(),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  REDIS_URL: z.string().url(),
  REDIS_SENTINELS: z.string().optional(),
  REDIS_SENTINEL_MASTER_NAME: z.string().optional().default("mymaster"),
  REDIS_SENTINEL_PASSWORD: z.string().optional(),
  PORT: z.string().optional().default("3001"),
  // Requests/minute allowed per client before @fastify/rate-limit responds 429.
  // Overridable so load-test runs (k6, etc.) can measure real server capacity
  // instead of hitting the rate limiter almost immediately.
  RATE_LIMIT_MAX: z.coerce.number().int().positive().optional().default(100),
  SOROBAN_RENT_WORKER_ENABLED: z.string().optional().default("true"),
  SOROBAN_RENT_WORKER_INTERVAL_MS: z.string().optional().default("60000"),
  SOROBAN_RENT_WORKER_SECRET: z.string().optional(),
  SOROBAN_RENT_RENEWAL_THRESHOLD: z.string().optional().default("5000"),
  SOROBAN_RENT_TARGET_TTL: z.string().optional().default("10000"),
  SOROBAN_RENT_MAX_CONCURRENCY: z.string().optional().default("5"),
  SOROBAN_STAKING_REWARD_WORKER_ENABLED: z.string().optional().default("true"),
});
export type Env = z.infer<typeof envSchema>;

const parseEnv = (): Env => {
  const envInput = {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL || (process.env.NODE_ENV === 'test' || process.env.VITEST ? "postgresql://postgres:postgres@localhost:5432/stellar_alerts" : undefined),
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || (process.env.NODE_ENV === 'test' || process.env.VITEST ? "dummy-telegram-bot-token" : undefined),
    JWT_SECRET: process.env.JWT_SECRET || (process.env.NODE_ENV === 'test' || process.env.VITEST ? "dummy-jwt-secret-key-12345" : undefined),
    REDIS_URL: process.env.REDIS_URL || (process.env.NODE_ENV === 'test' || process.env.VITEST ? "redis://localhost:6379" : undefined),
    REDIS_SENTINELS: process.env.REDIS_SENTINELS,
    REDIS_SENTINEL_MASTER_NAME: process.env.REDIS_SENTINEL_MASTER_NAME || "mymaster",
    REDIS_SENTINEL_PASSWORD: process.env.REDIS_SENTINEL_PASSWORD,
    SOROBAN_RENT_WORKER_ENABLED: process.env.SOROBAN_RENT_WORKER_ENABLED || "true",
    SOROBAN_RENT_WORKER_INTERVAL_MS: process.env.SOROBAN_RENT_WORKER_INTERVAL_MS || "60000",
    SOROBAN_RENT_WORKER_SECRET: process.env.SOROBAN_RENT_WORKER_SECRET,
    SOROBAN_RENT_RENEWAL_THRESHOLD: process.env.SOROBAN_RENT_RENEWAL_THRESHOLD || "5000",
    SOROBAN_RENT_TARGET_TTL: process.env.SOROBAN_RENT_TARGET_TTL || "10000",
    SOROBAN_RENT_MAX_CONCURRENCY: process.env.SOROBAN_RENT_MAX_CONCURRENCY || "5",
    SOROBAN_STAKING_REWARD_WORKER_ENABLED: process.env.SOROBAN_STAKING_REWARD_WORKER_ENABLED || "true",
  };
  const parsed = envSchema.safeParse(envInput);

  if (!parsed.success) {
    console.error("❌ Invalid environment variables:", parsed.error.format());
    if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
      process.exit(1);
    }
    // Return a typed fallback matching Env so downstream code has consistent shape
    return {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/stellar_alerts",
      TELEGRAM_BOT_TOKEN: "dummy-telegram-bot-token",
      JWT_SECRET: "dummy-jwt-secret-key-12345",
      REDIS_URL: "redis://localhost:6379",
      PORT: "3001",
      RATE_LIMIT_MAX: 100,
      SOROBAN_RENT_WORKER_ENABLED: "true",
      SOROBAN_RENT_WORKER_INTERVAL_MS: "60000",
      SOROBAN_RENT_WORKER_SECRET: undefined,
      SOROBAN_RENT_RENEWAL_THRESHOLD: "5000",
      SOROBAN_RENT_TARGET_TTL: "10000",
      SOROBAN_RENT_MAX_CONCURRENCY: "5",
      SOROBAN_STAKING_REWARD_WORKER_ENABLED: "true",
    } as Env;
  }

  return parsed.data || {
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/stellar_alerts",
    TELEGRAM_BOT_TOKEN: "dummy-telegram-bot-token",
    JWT_SECRET: "dummy-jwt-secret-key-12345",
    REDIS_URL: "redis://localhost:6379",
    REDIS_SENTINELS: undefined,
    REDIS_SENTINEL_MASTER_NAME: "mymaster",
    REDIS_SENTINEL_PASSWORD: undefined,
    PORT: "3001",
    RATE_LIMIT_MAX: 100,
    SOROBAN_RENT_WORKER_ENABLED: "true",
    SOROBAN_RENT_WORKER_INTERVAL_MS: "60000",
    SOROBAN_RENT_WORKER_SECRET: undefined,
    SOROBAN_RENT_RENEWAL_THRESHOLD: "5000",
    SOROBAN_RENT_TARGET_TTL: "10000",
    SOROBAN_RENT_MAX_CONCURRENCY: "5",
    SOROBAN_STAKING_REWARD_WORKER_ENABLED: "true",
  };
};

export const env = parseEnv();
