import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';

const getRawInitData = vi.fn<() => string | null>();
vi.mock('./telegram-client', () => ({
  getRawInitData: () => getRawInitData(),
  signalReady: vi.fn(),
}));

import TelegramMiniApp from './page';

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

describe('<TelegramMiniApp />', () => {
  beforeEach(() => {
    getRawInitData.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows an error prompt when launched outside Telegram (no initData)', async () => {
    getRawInitData.mockReturnValue(null);
    render(<TelegramMiniApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/Open this page from inside Telegram/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('authenticates with initData and renders the wallet dashboard', async () => {
    getRawInitData.mockReturnValue('query_id=AA&user=%7B%22id%22%3A1%7D&auth_date=1&hash=abc');

    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (String(url).endsWith('/auth/telegram')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              token: 'session.jwt',
              user: { id: 'u1', email: 'tg_1@telegram.stellar-alerts.org' },
              telegram: { id: 1, first_name: 'Ada' },
            }),
        });
      }
      if (String(url).endsWith('/wallets')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              wallets: [
                { id: 'w1', userId: 'u1', publicKey: 'GABChello world key here', label: 'Payroll' },
              ],
            }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });

    render(<TelegramMiniApp />);

    await waitFor(() => expect(screen.getByText(/Signed in as Ada/i)).toBeInTheDocument());
    expect(screen.getByText(/Watched wallets \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText('Payroll')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Toggle Telegram notifications/i })).toBeInTheDocument();

    const authCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).endsWith('/auth/telegram'),
    );
    expect(JSON.parse(authCall![1].body)).toEqual({
      initData: 'query_id=AA&user=%7B%22id%22%3A1%7D&auth_date=1&hash=abc',
    });
  });

  it('surfaces a friendly error when initData validation fails server-side', async () => {
    getRawInitData.mockReturnValue('auth_date=1&hash=bad');
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'x', code: 'INVALID_SIGNATURE' }),
    });

    render(<TelegramMiniApp />);
    await flush();

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not verify this session/i);
  });
});
