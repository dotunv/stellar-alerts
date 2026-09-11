import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../auth.service';
import { generateMagicToken } from '../../../utils/jwt';

vi.mock('../../../config/env', () => ({
  env: {
    JWT_SECRET: 'test-super-secret-jwt-key-12345',
  },
}));

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    user: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from '../../../lib/prisma';

describe('AuthService', () => {
  let authService: AuthService;

  beforeEach(() => {
    authService = new AuthService();
    vi.clearAllMocks();
  });

  describe('requestMagicLink', () => {
    it('should return a valid magic token string', async () => {
      const email = 'maintainer@stellar-alerts.org';
      const token = await authService.requestMagicLink(email);
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(20);
    });
  });

  describe('verifyMagicLink', () => {
    it('should successfully verify a valid magic token and upsert user', async () => {
      const email = 'maintainer@stellar-alerts.org';
      const magicToken = await authService.requestMagicLink(email);

      const mockUser = { id: 'user_cuid_123', email, createdAt: new Date() };
      (prisma.user.upsert as any).mockResolvedValue(mockUser);

      const result = await authService.verifyMagicLink(magicToken);

      expect(prisma.user.upsert).toHaveBeenCalledWith({
        where: { email },
        update: {},
        create: { email },
      });
      expect(result.user).toEqual({ id: mockUser.id, email: mockUser.email });
      expect(typeof result.token).toBe('string');
    });

    it('should throw error for an invalid magic token', async () => {
      await expect(authService.verifyMagicLink('invalid.token.str')).rejects.toThrow(
        'Invalid or expired token'
      );
    });
  });

  describe('getMe', () => {
    it('should return user profile with wallets and notifyPrefs', async () => {
      const userId = 'user_cuid_123';
      const mockUser = {
        id: userId,
        email: 'user@stellar.org',
        wallets: [],
        notifyPrefs: null,
      };

      (prisma.user.findUnique as any).mockResolvedValue(mockUser);

      const user = await authService.getMe(userId);
      expect(user).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: userId },
        include: { wallets: true, notifyPrefs: true },
      });
    });

    it('should throw error if user is not found', async () => {
      (prisma.user.findUnique as any).mockResolvedValue(null);
      await expect(authService.getMe('nonexistent_id')).rejects.toThrow('User not found');
    });
  });
});
