import Redis from 'ioredis';

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

export const redis = new Redis({
  host: redisHost,
  port: redisPort,
  lazyConnect: true, // Connects on first command, no eager connection failure at startup
  maxRetriesPerRequest: 1,
});

redis.on('error', (err) => {
  console.warn(`[Redis] Connection error: ${err.message}`);
});
