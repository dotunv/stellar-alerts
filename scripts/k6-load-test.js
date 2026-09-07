/**
 * K6 performance benchmark for the Stellar Alerts API.
 *
 * Simulates the real dashboard hot path — health check, dev-mode magic-link
 * login, then the authenticated reads a freshly-loaded dashboard fires
 * (wallets, payments, payments summary) — under ramping virtual-user load,
 * and fails the run if latency or error-rate budgets are blown.
 *
 * Usage:
 *   k6 run scripts/k6-load-test.js
 *   BASE_URL=https://staging.example.com VUS=500 DURATION=60s k6 run scripts/k6-load-test.js
 *
 * Env vars:
 *   BASE_URL  Target API base URL.            Default: http://localhost:3001
 *   VUS       Peak concurrent virtual users.   Default: 50 (Drips Wave issue #153 asks for 500 — pass VUS=500 for that profile)
 *   DURATION  How long to hold at peak VUs.    Default: 30s
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const VUS = Number(__ENV.VUS) || 50;
const DURATION = __ENV.DURATION || '30s';

// Explicit 5xx counter — independent of k6's built-in `http_req_failed`,
// which only flags network-level failures unless a response callback is set.
export const serverErrors = new Counter('server_errors_5xx');

export const options = {
  scenarios: {
    dashboard_hot_path: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: VUS }, // ramp-up
        { duration: DURATION, target: VUS }, // sustained load
        { duration: '10s', target: 0 }, // ramp-down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // Acceptance criteria (#153): p95 < 100ms, zero 5xx responses.
    http_req_duration: ['p(95)<100', 'p(99)<200'],
    server_errors_5xx: ['count==0'],
    // Network-level failures (timeouts, connection resets) capped at 1%.
    http_req_failed: ['rate<0.01'],
  },
};

function recordStatus(res, label) {
  check(res, { [`${label}: no server error`]: (r) => r.status < 500 });
  if (res.status >= 500) serverErrors.add(1);
  return res;
}

export default function () {
  // 1. Liveness probe — cheapest, highest-volume endpoint.
  recordStatus(http.get(`${BASE_URL}/health`), 'health');

  // 2. Dev-mode magic-link login. NODE_ENV !== 'production' returns the raw
  //    token in the response body, so load generation doesn't need a real inbox.
  const email = `k6-vu${__VU}-iter${__ITER}@loadtest.local`;
  const requestLinkRes = recordStatus(
    http.post(
      `${BASE_URL}/auth/request-link`,
      JSON.stringify({ email }),
      { headers: { 'Content-Type': 'application/json' } },
    ),
    'auth:request-link',
  );

  const magicToken = safeJson(requestLinkRes, 'token');
  if (!magicToken) {
    sleep(1);
    return;
  }

  const verifyRes = recordStatus(
    http.get(`${BASE_URL}/auth/verify?token=${encodeURIComponent(magicToken)}`),
    'auth:verify',
  );

  const sessionToken = safeJson(verifyRes, 'token');
  if (!sessionToken) {
    sleep(1);
    return;
  }

  const authParams = { headers: { Authorization: `Bearer ${sessionToken}` } };

  // 3. Authenticated dashboard reads — the requests a real user's browser
  //    fires on every page load.
  recordStatus(http.get(`${BASE_URL}/wallets`, authParams), 'wallets');
  recordStatus(http.get(`${BASE_URL}/payments`, authParams), 'payments');
  recordStatus(http.get(`${BASE_URL}/payments/summary`, authParams), 'payments:summary');

  sleep(1);
}

function safeJson(res, field) {
  try {
    const body = typeof res?.json === 'function' ? res.json() : null;
    if (!body || typeof body !== 'object') return undefined;
    return Object.prototype.hasOwnProperty.call(body, field) ? body[field] : undefined;
  } catch {
    return undefined;
  }
}
