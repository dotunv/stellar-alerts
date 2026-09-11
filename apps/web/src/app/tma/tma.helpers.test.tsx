import { describe, it, expect } from 'vitest';
import {
  parseTelegramAuthResponse,
  friendlyTelegramError,
  telegramDisplayName,
  shortKey,
} from './tma.helpers';

describe('tma.helpers', () => {
  describe('parseTelegramAuthResponse', () => {
    const okBody = {
      success: true,
      token: 'jwt.session.token',
      user: { id: 'u_1', email: 'tg_279058397@telegram.stellar-alerts.org' },
      telegram: { id: 279058397, first_name: 'Vlad', last_name: 'P', username: 'vlad' },
    };

    it('normalises a successful response', () => {
      const result = parseTelegramAuthResponse(200, okBody);
      expect(result).toEqual({
        token: 'jwt.session.token',
        email: 'tg_279058397@telegram.stellar-alerts.org',
        telegramName: 'Vlad P',
        telegramId: 279058397,
      });
    });

    it('throws friendly copy for a signature failure', () => {
      expect(() =>
        parseTelegramAuthResponse(401, { error: 'x', code: 'INVALID_SIGNATURE' }),
      ).toThrowError(/could not verify this session/i);
    });

    it('throws generic copy when the body has no known error code', () => {
      expect(() => parseTelegramAuthResponse(500, {})).toThrowError(/reopen the Mini App/i);
      expect(() => parseTelegramAuthResponse(200, { success: true })).toThrowError(/failed/i);
    });
  });

  describe('friendlyTelegramError', () => {
    it('maps known codes and falls back for unknown ones', () => {
      expect(friendlyTelegramError('EXPIRED')).toMatch(/expired/i);
      expect(friendlyTelegramError('SOMETHING_ELSE')).toMatch(/reopen the Mini App/i);
      expect(friendlyTelegramError(null)).toMatch(/reopen the Mini App/i);
    });
  });

  describe('telegramDisplayName', () => {
    it('prefers full name, then username, then a default', () => {
      expect(telegramDisplayName({ first_name: 'Ada', last_name: 'Lovelace' })).toBe('Ada Lovelace');
      expect(telegramDisplayName({ username: 'ada' })).toBe('ada');
      expect(telegramDisplayName({})).toBe('Telegram user');
      expect(telegramDisplayName(null)).toBe('Telegram user');
    });
  });

  describe('shortKey', () => {
    it('abbreviates long Stellar keys and leaves short strings alone', () => {
      expect(shortKey('GABCDEF1234567890XYZWXYZ')).toBe('GABC…WXYZ');
      expect(shortKey('GSHORT')).toBe('GSHORT');
    });
  });
});
