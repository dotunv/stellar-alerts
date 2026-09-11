import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  extractLockfilePackages,
  runSecurityAudit,
  run,
} from '../../../../../scripts/security-audit';

const originalFetch = global.fetch;

function sampleLockfile(overrides: Record<string, any> = {}): string {
  return JSON.stringify({
    name: 'stellar-alerts',
    lockfileVersion: 3,
    packages: {
      '': { name: 'stellar-alerts', version: '1.0.0' },
      'apps/api': { name: 'api', version: '1.0.0' }, // workspace package, no `resolved`
      'node_modules/lodash': {
        version: '4.17.15',
        resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.15.tgz',
      },
      'apps/api/node_modules/lodash': {
        version: '4.17.15',
        resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.15.tgz',
      },
      'node_modules/@scope/pkg': {
        version: '2.0.0',
        resolved: 'https://registry.npmjs.org/@scope/pkg/-/pkg-2.0.0.tgz',
      },
      ...overrides,
    },
  });
}

describe('extractLockfilePackages', () => {
  it('extracts third-party packages with their exact resolved version', () => {
    const pkgs = extractLockfilePackages(sampleLockfile());
    expect(pkgs).toContainEqual({ name: 'lodash', version: '4.17.15' });
    expect(pkgs).toContainEqual({ name: '@scope/pkg', version: '2.0.0' });
  });

  it('skips workspace-local packages that have no `resolved` field', () => {
    const pkgs = extractLockfilePackages(sampleLockfile());
    expect(pkgs.some((p) => p.name === 'api')).toBe(false);
    expect(pkgs.some((p) => p.name === 'stellar-alerts')).toBe(false);
  });

  it('deduplicates the same package/version nested under multiple parents', () => {
    const pkgs = extractLockfilePackages(sampleLockfile());
    const lodashEntries = pkgs.filter((p) => p.name === 'lodash');
    expect(lodashEntries).toHaveLength(1);
  });

  it('treats two different versions of the same package as separate entries', () => {
    const pkgs = extractLockfilePackages(
      sampleLockfile({
        'node_modules/foo/node_modules/lodash': {
          version: '3.0.0',
          resolved: 'https://registry.npmjs.org/lodash/-/lodash-3.0.0.tgz',
        },
      }),
    );
    const versions = pkgs.filter((p) => p.name === 'lodash').map((p) => p.version);
    expect(versions.sort()).toEqual(['3.0.0', '4.17.15']);
  });

  it('returns an empty array for a lockfile with no packages', () => {
    const pkgs = extractLockfilePackages(JSON.stringify({ packages: {} }));
    expect(pkgs).toEqual([]);
  });
});

describe('runSecurityAudit', () => {
  const tmpFiles: string[] = [];

  afterEach(() => {
    global.fetch = originalFetch;
    return Promise.all(tmpFiles.splice(0).map((file) => fs.rm(file, { force: true })));
  });

  async function tmpLockfile(content: string): Promise<string> {
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'security-audit-test-')), 'package-lock.json');
    await fs.writeFile(file, content, 'utf8');
    tmpFiles.push(file);
    return file;
  }

  it('reports no findings when OSV returns no vulnerabilities for any package', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{}, {}, {}] }),
    }) as any;

    const lockfilePath = await tmpLockfile(sampleLockfile());
    const report = await runSecurityAudit(lockfilePath);

    expect(report.findings).toHaveLength(0);
    expect(report.blockingFindings).toHaveLength(0);
    expect(report.scannedPackageCount).toBeGreaterThan(0);
  });

  it('reports a CRITICAL finding as blocking', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('querybatch')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            results: [{ vulns: [{ id: 'GHSA-critical-1' }] }, {}, {}],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          database_specific: { severity: 'CRITICAL' },
          summary: 'Remote code execution',
        }),
      });
    });
    global.fetch = fetchMock as any;

    const lockfilePath = await tmpLockfile(sampleLockfile());
    const report = await runSecurityAudit(lockfilePath);

    expect(report.findings).toHaveLength(1);
    expect(report.blockingFindings).toHaveLength(1);
    expect(report.blockingFindings[0].severity).toBe('CRITICAL');
    expect(report.blockingFindings[0].vulnId).toBe('GHSA-critical-1');
  });

  it('does not treat a LOW severity finding as blocking', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('querybatch')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ results: [{ vulns: [{ id: 'GHSA-low-1' }] }, {}, {}] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ database_specific: { severity: 'LOW' }, summary: 'Minor issue' }),
      });
    });
    global.fetch = fetchMock as any;

    const lockfilePath = await tmpLockfile(sampleLockfile());
    const report = await runSecurityAudit(lockfilePath);

    expect(report.findings).toHaveLength(1);
    expect(report.blockingFindings).toHaveLength(0);
  });

  it('sorts findings with the highest severity first', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('querybatch')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            results: [{ vulns: [{ id: 'GHSA-low-1' }, { id: 'GHSA-crit-1' }] }, {}, {}],
          }),
        });
      }
      const severity = url.includes('crit') ? 'CRITICAL' : 'LOW';
      return Promise.resolve({ ok: true, json: async () => ({ database_specific: { severity } }) });
    });
    global.fetch = fetchMock as any;

    const lockfilePath = await tmpLockfile(sampleLockfile());
    const report = await runSecurityAudit(lockfilePath);

    expect(report.findings[0].severity).toBe('CRITICAL');
    expect(report.findings.at(-1)!.severity).toBe('LOW');
  });

  it('degrades to UNKNOWN severity (non-blocking) when a vuln detail lookup fails, without aborting the scan', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('querybatch')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ results: [{ vulns: [{ id: 'GHSA-unreachable-1' }] }, {}, {}] }),
        });
      }
      return Promise.resolve({ ok: false, status: 500 });
    });
    global.fetch = fetchMock as any;

    const lockfilePath = await tmpLockfile(sampleLockfile());
    const report = await runSecurityAudit(lockfilePath);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].severity).toBe('UNKNOWN');
    expect(report.blockingFindings).toHaveLength(0);
  });

  it('throws when the OSV batch endpoint itself fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as any;

    const lockfilePath = await tmpLockfile(sampleLockfile());
    await expect(runSecurityAudit(lockfilePath)).rejects.toThrow(/503/);
  });
});

describe('run (CLI entry)', () => {
  const tmpFiles: string[] = [];

  afterEach(() => {
    global.fetch = originalFetch;
    return Promise.all(tmpFiles.splice(0).map((file) => fs.rm(file, { force: true })));
  });

  it('returns true and writes a JSON report when there are no blocking findings', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [{}, {}, {}] }) }) as any;

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'security-audit-run-'));
    const lockfilePath = path.join(dir, 'package-lock.json');
    await fs.writeFile(lockfilePath, sampleLockfile(), 'utf8');
    const reportPath = path.join(dir, 'report.json');
    tmpFiles.push(lockfilePath, reportPath);

    const ok = await run({ lockfilePath, reportPath });

    expect(ok).toBe(true);
    const written = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    expect(written.blockingFindings).toEqual([]);
  });

  it('returns false when a blocking finding is present', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('querybatch')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ results: [{ vulns: [{ id: 'GHSA-high-1' }] }, {}, {}] }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ database_specific: { severity: 'HIGH' } }) });
    });
    global.fetch = fetchMock as any;

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'security-audit-run-'));
    const lockfilePath = path.join(dir, 'package-lock.json');
    await fs.writeFile(lockfilePath, sampleLockfile(), 'utf8');
    tmpFiles.push(lockfilePath);

    const ok = await run({ lockfilePath });

    expect(ok).toBe(false);
  });
});
