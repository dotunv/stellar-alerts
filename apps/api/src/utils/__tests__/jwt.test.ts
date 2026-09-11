import { describe, it, expect, vi } from 'vitest';
import { generateMagicToken, generateSessionToken, verifyToken, MagicLinkPayload, UserPayload } from '../jwt';

// Mock env for isolated test execution
vi.mock('../../config/env', () => ({
  env: {
    JWT_SECRET: 'test-super-secret-jwt-key-12345',
  },
}));

describe('JWT Utilities', () => {
  it('should generate and verify a valid magic link token', () => {
    const email = 'reviewer@drips.network';
    const token = generateMagicToken(email);

    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(10);

    const decoded = verifyToken<MagicLinkPayload>(token);
    expect(decoded.email).toBe(email);
  });

  it('should generate and verify a valid session token with a unique jti', () => {
    const userPayload: UserPayload = {
      id: 'cuid_test_user_123',
      email: 'user@stellar-alerts.org',
    };

    const token = generateSessionToken(userPayload);
    expect(typeof token).toBe('string');

    const decoded = verifyToken<UserPayload>(token);
    expect(decoded.id).toBe(userPayload.id);
    expect(decoded.email).toBe(userPayload.email);
    // Every session token must carry a unique jti for revocation support.
    expect(typeof decoded.jti).toBe('string');
    expect(decoded.jti!.length).toBeGreaterThan(0);

    // Two tokens for the same user must have distinct jtis.
    const token2 = generateSessionToken(userPayload);
    const decoded2 = verifyToken<UserPayload>(token2);
    expect(decoded.jti).not.toBe(decoded2.jti);
  });

  it('should throw error when verifying an invalid token', () => {
    expect(() => verifyToken('invalid-malformed-token-string')).toThrow();
  });
});
