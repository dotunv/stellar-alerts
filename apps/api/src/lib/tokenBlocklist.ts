import { redis } from '../lib/redis';

const BLOCKLIST_PREFIX = 'jwt_blocklist:';

/**
 * Adds a token JTI to the Redis blocklist with an expiry that matches
 * the token's remaining TTL (so the key auto-expires when the JWT would
 * have naturally expired anyway).
 *
 * @param jti  - The JWT ID claim (jti) to revoke.
 * @param exp  - The JWT expiration Unix timestamp (seconds).
 */
export async function revokeToken(jti: string, exp: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = exp - now;

  if (ttlSeconds <= 0) {
    // Token already expired — no need to blocklist it.
    return;
  }

  await redis.set(`${BLOCKLIST_PREFIX}${jti}`, '1', 'EX', ttlSeconds);
  console.log(`[TokenBlocklist] 🔒 Revoked token jti=${jti} (TTL: ${ttlSeconds}s)`);
}

/**
 * Checks whether a token JTI has been revoked.
 *
 * @param jti - The JWT ID claim to check.
 * @returns   `true` if the token is blocklisted (revoked), `false` otherwise.
 */
export async function isTokenRevoked(jti: string): Promise<boolean> {
  const value = await redis.get(`${BLOCKLIST_PREFIX}${jti}`);
  return value !== null;
}
