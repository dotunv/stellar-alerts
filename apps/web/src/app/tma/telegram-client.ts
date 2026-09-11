'use client';

import { retrieveRawInitData } from '@telegram-apps/sdk';

/**
 * Returns the raw, signed `initData` query string for the current Telegram Mini
 * App launch, or `null` when the page is not running inside a Telegram client.
 *
 * Tries the official SDK first, then falls back to the string the Telegram
 * `telegram-web-app.js` bootstrap script exposes on `window.Telegram.WebApp`.
 */
export function getRawInitData(): string | null {
  try {
    const raw = retrieveRawInitData();
    if (raw) return raw;
  } catch {
    // Not launched from Telegram, or the SDK could not read the environment.
  }

  if (typeof window !== 'undefined') {
    const fromGlobal = (window as unknown as {
      Telegram?: { WebApp?: { initData?: string } };
    }).Telegram?.WebApp?.initData;
    if (typeof fromGlobal === 'string' && fromGlobal.length > 0) return fromGlobal;
  }

  return null;
}

/** Signals to the Telegram client that the Mini App is ready to be displayed. */
export function signalReady(): void {
  if (typeof window === 'undefined') return;
  try {
    (window as unknown as {
      Telegram?: { WebApp?: { ready?: () => void; expand?: () => void } };
    }).Telegram?.WebApp?.ready?.();
    (window as unknown as {
      Telegram?: { WebApp?: { expand?: () => void } };
    }).Telegram?.WebApp?.expand?.();
  } catch {
    // no-op outside Telegram
  }
}
