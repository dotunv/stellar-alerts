import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

/**
 * Automated dependency vulnerability remediation & security advisory engine
 * (issue #140).
 *
 * Scans every package/version pinned in the repo's `package-lock.json`
 * against the OSV (Open Source Vulnerabilities, https://osv.dev) database
 * and produces a vulnerability report. Run in CI on every push/PR (see
 * `.github/workflows/security.yml`) so newly-disclosed CVEs affecting an
 * already-installed dependency are caught between releases, not just at
 * `npm audit` time.
 *
 * Deliberately talks to the public OSV HTTP API directly (`api.osv.dev`)
 * rather than shelling out to `npm audit`: `npm audit` only reports against
 * npm's own advisory database and requires a registry round-trip per
 * install, whereas OSV aggregates GHSA/npm/PyPI/etc. advisories and exposes
 * a batch query endpoint built for exactly this (one POST for the whole
 * lockfile). No new dependency is introduced for this — the script uses
 * only `fetch` (global since Node 18) and `node:fs`.
 */

const OSV_BATCH_URL = 'https://api.osv.dev/v1/querybatch';
const OSV_VULN_URL = 'https://api.osv.dev/v1/vulns';
const REQUEST_TIMEOUT_MS = 15_000;

export type Severity = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' | 'UNKNOWN';

export interface LockfilePackage {
  name: string;
  version: string;
}

export interface VulnerabilityFinding {
  packageName: string;
  packageVersion: string;
  vulnId: string;
  severity: Severity;
  summary: string | null;
}

export interface SecurityAuditReport {
  scannedPackageCount: number;
  findings: VulnerabilityFinding[];
  /** Findings at CRITICAL or HIGH severity — these are what fail CI. */
  blockingFindings: VulnerabilityFinding[];
  generatedAt: string;
}

const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MODERATE: 2,
  LOW: 1,
  UNKNOWN: 0,
};

const BLOCKING_SEVERITIES = new Set<Severity>(['CRITICAL', 'HIGH']);

function normalizeSeverity(value: unknown): Severity {
  if (typeof value !== 'string') return 'UNKNOWN';
  const upper = value.toUpperCase();
  return upper === 'CRITICAL' || upper === 'HIGH' || upper === 'MODERATE' || upper === 'LOW'
    ? (upper as Severity)
    : 'UNKNOWN';
}

/**
 * Extracts the set of resolved third-party packages (name + exact version)
 * from an npm v3-format `package-lock.json`. Workspace-local packages (no
 * `resolved` tarball URL — i.e. this repo's own `apps/*`/`packages/*`
 * entries) are skipped, since they're not something OSV can look up and
 * aren't "third-party" in the sense the advisory engine cares about.
 */
export function extractLockfilePackages(lockfileJson: string): LockfilePackage[] {
  const lockfile = JSON.parse(lockfileJson);
  const packages = lockfile.packages ?? {};

  const seen = new Map<string, LockfilePackage>();

  for (const [key, meta] of Object.entries<any>(packages)) {
    if (!key || !meta || typeof meta.version !== 'string') continue;
    if (!meta.resolved) continue; // workspace-local package, not a registry dependency

    // node_modules/@scope/name or node_modules/name (possibly nested under
    // another package's node_modules for a private duplicate).
    const match = key.match(/node_modules\/((?:@[^/]+\/)?[^/]+)$/);
    if (!match) continue;
    const name = match[1];

    // Dedup by name+version: the same package/version can appear nested
    // under many parents, but only needs to be checked against OSV once.
    const dedupeKey = `${name}@${meta.version}`;
    if (!seen.has(dedupeKey)) {
      seen.set(dedupeKey, { name, version: meta.version });
    }
  }

  return Array.from(seen.values());
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

/**
 * Queries the OSV batch endpoint for every package, returning the vuln IDs
 * (without full details — that's a second round-trip, see
 * `fetchVulnerabilityDetails`) affecting each one. OSV caps batch queries at
 * 1000 entries per request, so packages are chunked defensively.
 */
async function queryOsvBatch(pkgs: LockfilePackage[]): Promise<Map<string, string[]>> {
  const CHUNK_SIZE = 500;
  const idsByPackage = new Map<string, string[]>();

  for (let i = 0; i < pkgs.length; i += CHUNK_SIZE) {
    const chunk = pkgs.slice(i, i + CHUNK_SIZE);
    const response = await fetchWithTimeout(OSV_BATCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queries: chunk.map((pkg) => ({
          package: { name: pkg.name, ecosystem: 'npm' },
          version: pkg.version,
        })),
      }),
    });

    if (!response.ok) {
      throw new Error(`OSV batch query failed with HTTP ${response.status}`);
    }

    const body: any = await response.json();
    const results: any[] = body?.results ?? [];

    results.forEach((result, index) => {
      const pkg = chunk[index];
      const ids: string[] = (result?.vulns ?? []).map((v: any) => v.id).filter(Boolean);
      if (ids.length > 0) {
        idsByPackage.set(`${pkg.name}@${pkg.version}`, ids);
      }
    });
  }

  return idsByPackage;
}

/**
 * Fetches full advisory details (severity + summary) for a set of vuln IDs.
 * The batch endpoint intentionally omits these fields to keep the batch
 * response small, so a per-ID follow-up is required to know how severe each
 * hit is.
 */
async function fetchVulnerabilityDetails(
  vulnIds: string[],
): Promise<Map<string, { severity: Severity; summary: string | null }>> {
  const details = new Map<string, { severity: Severity; summary: string | null }>();

  await Promise.all(
    vulnIds.map(async (id) => {
      try {
        const response = await fetchWithTimeout(`${OSV_VULN_URL}/${encodeURIComponent(id)}`, { method: 'GET' });
        if (!response.ok) {
          details.set(id, { severity: 'UNKNOWN', summary: null });
          return;
        }
        const body: any = await response.json();
        details.set(id, {
          severity: normalizeSeverity(body?.database_specific?.severity),
          summary: typeof body?.summary === 'string' ? body.summary : null,
        });
      } catch {
        details.set(id, { severity: 'UNKNOWN', summary: null });
      }
    }),
  );

  return details;
}

/**
 * Runs the full audit: reads `package-lock.json`, checks every resolved
 * package against OSV, and returns a structured report. Never throws for an
 * individual package/vuln lookup failure — a single flaky advisory fetch
 * degrades that finding's severity to UNKNOWN rather than aborting the
 * whole scan.
 */
export async function runSecurityAudit(lockfilePath: string): Promise<SecurityAuditReport> {
  const lockfileJson = await fs.readFile(lockfilePath, 'utf8');
  const pkgs = extractLockfilePackages(lockfileJson);

  const idsByPackage = await queryOsvBatch(pkgs);
  const allVulnIds = Array.from(new Set(Array.from(idsByPackage.values()).flat()));
  const vulnDetails = await fetchVulnerabilityDetails(allVulnIds);

  const findings: VulnerabilityFinding[] = [];
  for (const pkg of pkgs) {
    const ids = idsByPackage.get(`${pkg.name}@${pkg.version}`);
    if (!ids) continue;

    for (const vulnId of ids) {
      const detail = vulnDetails.get(vulnId) ?? { severity: 'UNKNOWN' as Severity, summary: null };
      findings.push({
        packageName: pkg.name,
        packageVersion: pkg.version,
        vulnId,
        severity: detail.severity,
        summary: detail.summary,
      });
    }
  }

  findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  return {
    scannedPackageCount: pkgs.length,
    findings,
    blockingFindings: findings.filter((f) => BLOCKING_SEVERITIES.has(f.severity)),
    generatedAt: new Date().toISOString(),
  };
}

function formatReport(report: SecurityAuditReport): string {
  const lines: string[] = [];
  lines.push(`[security-audit] Scanned ${report.scannedPackageCount} package(s) against OSV.`);

  if (report.findings.length === 0) {
    lines.push('[security-audit] No known vulnerabilities found.');
    return lines.join('\n');
  }

  lines.push(`[security-audit] Found ${report.findings.length} advisory match(es):`);
  for (const finding of report.findings) {
    lines.push(
      `  - [${finding.severity}] ${finding.packageName}@${finding.packageVersion} — ${finding.vulnId}` +
        (finding.summary ? `: ${finding.summary}` : ''),
    );
  }

  if (report.blockingFindings.length > 0) {
    lines.push(
      `[security-audit] ${report.blockingFindings.length} finding(s) are CRITICAL or HIGH severity — failing.`,
    );
  }

  return lines.join('\n');
}

/**
 * CLI entry point. Exits non-zero when any CRITICAL/HIGH finding is present
 * (what `.github/workflows/security.yml` relies on to fail the build) or
 * when the scan itself could not complete.
 */
export async function run({
  lockfilePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package-lock.json'),
  reportPath,
}: { lockfilePath?: string; reportPath?: string } = {}): Promise<boolean> {
  const report = await runSecurityAudit(lockfilePath);
  console.log(formatReport(report));

  if (reportPath) {
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`[security-audit] Wrote JSON report to ${path.relative(process.cwd(), reportPath)}`);
  }

  return report.blockingFindings.length === 0;
}

async function main() {
  const reportArgIndex = process.argv.indexOf('--report');
  const reportPath = reportArgIndex !== -1 ? process.argv[reportArgIndex + 1] : undefined;

  try {
    const ok = await run({ reportPath });
    if (!ok) process.exitCode = 1;
  } catch (err) {
    console.error('[security-audit] Failed:', err);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
