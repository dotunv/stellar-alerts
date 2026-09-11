'use client';

import { useCallback, useEffect, useState } from 'react';
import type { WalletDTO } from '@stellar-alerts/shared';
import { isValidStellarPublicKey } from '@stellar-alerts/shared';
import { getRawInitData, signalReady } from './telegram-client';
import { parseTelegramAuthResponse, shortKey, type TmaAuthResult } from './tma.helpers';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type Phase = 'authenticating' | 'error' | 'ready';

export default function TelegramMiniApp() {
  const [phase, setPhase] = useState<Phase>('authenticating');
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<TmaAuthResult | null>(null);

  const [wallets, setWallets] = useState<WalletDTO[]>([]);
  const [newKey, setNewKey] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [telegramAlerts, setTelegramAlerts] = useState(true);

  const authHeaders = useCallback(
    (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` }),
    [],
  );

  const loadWallets = useCallback(
    async (token: string) => {
      try {
        const res = await fetch(`${API_BASE}/wallets`, { headers: authHeaders(token) });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.success && Array.isArray(body.wallets)) {
          setWallets(body.wallets);
        }
      } catch {
        /* keep whatever list we already have */
      }
    },
    [authHeaders],
  );

  // Authenticate against the Telegram init-data flow as soon as the app mounts.
  useEffect(() => {
    let cancelled = false;
    signalReady();

    (async () => {
      const initData = getRawInitData();
      if (!initData) {
        if (!cancelled) {
          setError('Open this page from inside Telegram to manage your wallet alerts.');
          setPhase('error');
        }
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/auth/telegram`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData }),
        });
        const body = await res.json().catch(() => ({}));
        const result = parseTelegramAuthResponse(res.status, body);
        if (cancelled) return;
        setSession(result);
        setPhase('ready');
        await loadWallets(result.token);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Telegram sign-in failed.');
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadWallets]);

  const handleAddWallet = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!session) return;
    const publicKey = newKey.trim();
    if (!isValidStellarPublicKey(publicKey)) {
      setFormError('Enter a valid Stellar public key (starts with G, 56 characters).');
      return;
    }
    setFormError(null);
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/wallets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(session.token) },
        body: JSON.stringify({ publicKey }),
      });
      if (res.ok) {
        setNewKey('');
        await loadWallets(session.token);
      } else {
        const body = await res.json().catch(() => ({}));
        setFormError(body.error || body.message || 'Could not add that wallet.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveWallet = async (id: string) => {
    if (!session) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/wallets/${id}`, {
        method: 'DELETE',
        headers: authHeaders(session.token),
      });
      if (res.ok) setWallets((prev) => prev.filter((w) => w.id !== id));
    } finally {
      setBusy(false);
    }
  };

  const handleToggleTelegramAlerts = async () => {
    if (!session) return;
    const next = !telegramAlerts;
    setTelegramAlerts(next);
    try {
      await fetch(`${API_BASE}/notifications/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(session.token) },
        body: JSON.stringify({ telegramEnabled: next }),
      });
    } catch {
      /* optimistic: leave the toggle where the user put it */
    }
  };

  return (
    <div className="min-h-[100dvh] w-full bg-[#0b0b12] text-slate-100 px-4 py-5 flex flex-col gap-5">
      <header className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-white text-sm font-bold">
          ⚡
        </div>
        <div className="min-w-0">
          <h1 className="text-base font-bold leading-tight">Wallet Alerts</h1>
          <p className="text-xs text-slate-400 truncate">
            {session ? `Signed in as ${session.telegramName}` : 'Telegram Mini App'}
          </p>
        </div>
      </header>

      {phase === 'authenticating' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
          <div className="w-8 h-8 rounded-full border-2 border-slate-600 border-t-cyan-400 animate-spin" />
          <p className="text-sm" role="status">
            Verifying your Telegram session…
          </p>
        </div>
      )}

      {phase === 'error' && (
        <div
          className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6"
          role="alert"
        >
          <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-2xl">
            🚫
          </div>
          <p className="text-sm text-slate-300 max-w-xs">{error}</p>
        </div>
      )}

      {phase === 'ready' && session && (
        <main className="flex flex-col gap-5">
          <section className="rounded-2xl bg-slate-900/70 border border-slate-800 p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Telegram notifications</p>
              <p className="text-xs text-slate-400">Ping this chat on every incoming payment.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={telegramAlerts}
              aria-label="Toggle Telegram notifications"
              onClick={handleToggleTelegramAlerts}
              className={`relative w-12 h-7 rounded-full transition-colors flex-shrink-0 ${
                telegramAlerts ? 'bg-cyan-500' : 'bg-slate-700'
              }`}
            >
              <span
                className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform ${
                  telegramAlerts ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-slate-300">
              Watched wallets ({wallets.length})
            </h2>

            {wallets.length === 0 ? (
              <p className="text-xs text-slate-500 rounded-2xl bg-slate-900/50 border border-slate-800 p-4">
                No wallets yet. Add a Stellar public key below to start receiving alerts.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {wallets.map((wallet) => (
                  <li
                    key={wallet.id}
                    className="rounded-2xl bg-slate-900/70 border border-slate-800 p-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {wallet.label || 'Stellar wallet'}
                      </p>
                      <p className="text-xs font-mono text-slate-400">{shortKey(wallet.publicKey)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveWallet(wallet.id)}
                      disabled={busy}
                      aria-label={`Remove wallet ${shortKey(wallet.publicKey)}`}
                      className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-300 border border-red-500/30 disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <form onSubmit={handleAddWallet} className="flex flex-col gap-2">
            <label htmlFor="tma-wallet-key" className="text-sm font-semibold text-slate-300">
              Add a wallet
            </label>
            <input
              id="tma-wallet-key"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="G…"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-sm font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
            />
            {formError && (
              <p className="text-xs text-red-400" role="alert">
                {formError}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold text-sm disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Add wallet'}
            </button>
          </form>
        </main>
      )}
    </div>
  );
}
