import { describe, it, expect, afterEach } from 'vitest';
import { WorkerSupervisor } from '../supervisor';

/**
 * Unlike supervisor.test.ts (which mocks child_process to unit-test the
 * scheduling logic), this exercises a real forked Node process that throws
 * an uncaught exception, verifying the supervisor detects and recovers from
 * an actual crash rather than a simulated event.
 */
function waitFor(condition: () => boolean, timeoutMs: number, intervalMs = 20): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (condition()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(check, intervalMs);
    };
    check();
  });
}

describe('WorkerSupervisor (integration)', () => {
  let supervisor: WorkerSupervisor | undefined;

  afterEach(() => {
    supervisor?.stopAll();
  });

  it('detects an uncaught exception in the worker child process and restarts it', async () => {
    supervisor = new WorkerSupervisor();
    supervisor.spawn('crasher', '__tests__/fixtures/crashing.worker');

    await waitFor(() => supervisor!.getRestartCount('crasher') >= 1, 10_000);

    expect(supervisor.getRestartCount('crasher')).toBeGreaterThanOrEqual(1);
  }, 15_000);
});
