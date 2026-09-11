import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const { BOT_TOKEN } = vi.hoisted(() => ({ BOT_TOKEN: 'test-bot-token:AAABBB' }));

vi.mock('../../../config/env', () => ({
  env: { JWT_SECRET: 'test-super-secret-jwt-key-12345', TELEGRAM_BOT_TOKEN: BOT_TOKEN },
}));

vi.mock('../../../lib/prisma', () => ({
  prisma: { user: { upsert: vi.fn() } },
}));

import { AuthService } from '../auth.service';
import { TelegramInitDataError } from '../../../utils/telegram';
import { prisma } from '../../../lib/prisma';

function signInitData(fields: Record<string, string>, botToken = BOT_TOKEN): string {
  const params = new URLSearchParams(fields);
  const dcs = [...params.keys()]
    .sort()
    .map((k) => `${k}=${params.get(k)}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}

describe('AuthService.verifyTelegramInitData', () => {
  let service: AuthService;

  beforeEach(() => {
    service = new AuthService();
    vi.clearAllMocks();
  });

  it('issues a session token for valid init data and upserts a synthetic user', async () => {
    (prisma.user.upsert as any).mockResolvedValue({
      id: 'user-1',
      email: 'tg_777@telegram.stellar-alerts.org',
    });

    const initData = signInitData({
      user: JSON.stringify({ id: 777, first_name: 'Grace' }),
      auth_date: String(Math.floor(Date.now() / 1000)),
    });

    const result = await service.verifyTelegramInitData(initData);

    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'tg_777@telegram.stellar-alerts.org' } }),
    );
    expect(typeof result.token).toBe('string');
    expect(result.token.length).toBeGreaterThan(20);
    expect(result.user).toEqual({ id: 'user-1', email: 'tg_777@telegram.stellar-alerts.org' });
    expect(result.telegram.id).toBe(777);
  });

  it('rejects init data signed with the wrong bot token', async () => {
    const initData = signInitData(
      { user: JSON.stringify({ id: 1 }), auth_date: String(Math.floor(Date.now() / 1000)) },
      'attacker-token',
    );

    await expect(service.verifyTelegramInitData(initData)).rejects.toBeInstanceOf(
      TelegramInitDataError,
    );
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it('rejects valid-signature init data that carries no user', async () => {
    const initData = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)) });
    await expect(service.verifyTelegramInitData(initData)).rejects.toMatchObject({
      code: 'MALFORMED',
    });
  });
});
