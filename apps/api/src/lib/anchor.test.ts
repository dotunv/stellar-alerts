import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchSep24TransactionStatus,
  fetchSep31TransactionStatus,
  fetchAnchorTransactionStatus,
  isTerminalAnchorStatus,
} from './anchor';

const originalFetch = global.fetch;

describe('anchor SEP-24/SEP-31 status fetching', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('fetchSep24TransactionStatus', () => {
    it('parses a mocked SEP-24 transaction response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          transaction: {
            id: 'tx-1',
            status: 'pending_external',
            amount_in: '100.00',
            amount_out: '98.50',
            more_info_url: 'https://anchor.example.com/info/tx-1',
          },
        }),
      }) as any;

      const result = await fetchSep24TransactionStatus('https://anchor.example.com/sep24', 'tx-1');

      expect(result).toEqual({
        id: 'tx-1',
        status: 'pending_external',
        statusMessage: null,
        amountIn: '100.00',
        amountOut: '98.50',
        moreInfoUrl: 'https://anchor.example.com/info/tx-1',
      });
    });

    it('strips a trailing slash from the endpoint before building the URL', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ transaction: { id: 'tx-1', status: 'completed' } }),
      });
      global.fetch = fetchMock as any;

      await fetchSep24TransactionStatus('https://anchor.example.com/sep24/', 'tx-1');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://anchor.example.com/sep24/transaction?id=tx-1',
        expect.any(Object),
      );
    });

    it('returns null on a non-2xx response instead of throwing', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any;

      const result = await fetchSep24TransactionStatus('https://anchor.example.com/sep24', 'missing-tx');

      expect(result).toBeNull();
    });

    it('returns null on a network error instead of throwing', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;

      const result = await fetchSep24TransactionStatus('https://anchor.example.com/sep24', 'tx-1');

      expect(result).toBeNull();
    });

    it('returns null when the response body is malformed', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any;

      const result = await fetchSep24TransactionStatus('https://anchor.example.com/sep24', 'tx-1');

      expect(result).toBeNull();
    });
  });

  describe('fetchSep31TransactionStatus', () => {
    it('parses a mocked SEP-31 transaction response with auth header', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          transaction: { id: 'tx-2', status: 'pending_receiver', status_message: 'awaiting funds' },
        }),
      });
      global.fetch = fetchMock as any;

      const result = await fetchSep31TransactionStatus('https://anchor.example.com/sep31', 'tx-2', 'jwt-token');

      expect(result?.status).toBe('pending_receiver');
      expect(result?.statusMessage).toBe('awaiting funds');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://anchor.example.com/sep31/transactions/tx-2',
        expect.objectContaining({ headers: { Authorization: 'Bearer jwt-token' } }),
      );
    });

    it('returns null on a non-2xx response', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as any;

      const result = await fetchSep31TransactionStatus('https://anchor.example.com/sep31', 'tx-2', 'bad-token');

      expect(result).toBeNull();
    });
  });

  describe('fetchAnchorTransactionStatus', () => {
    beforeEach(() => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ transaction: { id: 'tx-1', status: 'completed' } }),
      }) as any;
    });

    it('dispatches to the SEP-24 fetcher for protocol "sep24"', async () => {
      const result = await fetchAnchorTransactionStatus('sep24', 'https://anchor.example.com/sep24', 'tx-1');
      expect(result?.status).toBe('completed');
    });

    it('dispatches to the SEP-31 fetcher for protocol "sep31" when an auth token is provided', async () => {
      const result = await fetchAnchorTransactionStatus(
        'sep31',
        'https://anchor.example.com/sep31',
        'tx-1',
        'jwt-token',
      );
      expect(result?.status).toBe('completed');
    });

    it('skips SEP-31 lookups with no auth token rather than making an unauthenticated request', async () => {
      const fetchMock = global.fetch as any;
      const result = await fetchAnchorTransactionStatus('sep31', 'https://anchor.example.com/sep31', 'tx-1');

      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('isTerminalAnchorStatus', () => {
    it.each(['completed', 'refunded', 'expired', 'error'])('treats SEP-24 "%s" as terminal', (status) => {
      expect(isTerminalAnchorStatus('sep24', status)).toBe(true);
    });

    it.each(['incomplete', 'pending_external', 'pending_user_transfer_start'])(
      'treats SEP-24 "%s" as non-terminal',
      (status) => {
        expect(isTerminalAnchorStatus('sep24', status)).toBe(false);
      },
    );

    it('treats SEP-31 "completed" as terminal and "pending_receiver" as non-terminal', () => {
      expect(isTerminalAnchorStatus('sep31', 'completed')).toBe(true);
      expect(isTerminalAnchorStatus('sep31', 'pending_receiver')).toBe(false);
    });
  });
});
