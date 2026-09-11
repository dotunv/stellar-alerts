import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

class FakeChild extends EventEmitter {
  pid = Math.floor(Math.random() * 100000);
  killed = false;
  send = vi.fn();
  kill = vi.fn((signal?: string) => {
    this.killed = true;
    this.emit('exit', signal === 'SIGKILL' ? null : 0, signal ?? null);
  });
}

const forkMock = vi.fn();

vi.mock('child_process', () => ({
  fork: (...args: any[]) => forkMock(...args),
}));

import { WorkerSupervisor } from '../supervisor';

describe('WorkerSupervisor', () => {
  let children: FakeChild[];

  beforeEach(() => {
    vi.useFakeTimers();
    children = [];
    forkMock.mockReset();
    forkMock.mockImplementation(() => {
      const child = new FakeChild();
      children.push(child);
      return child;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('spawns the worker as a forked child process', () => {
    const supervisor = new WorkerSupervisor();
    supervisor.spawn('watcher', 'watcher.worker');

    expect(forkMock).toHaveBeenCalledTimes(1);
    expect(children).toHaveLength(1);
  });

  it('pings the child every 10s and clears the timeout on pong', async () => {
    const supervisor = new WorkerSupervisor();
    supervisor.spawn('watcher', 'watcher.worker');
    const child = children[0];

    await vi.advanceTimersByTimeAsync(10_000);
    expect(child.send).toHaveBeenCalledWith({ type: 'ping' });

    child.emit('message', { type: 'pong', pid: child.pid });

    // No freeze-kill should fire once the pong is received in time.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('kills and restarts a worker that stops answering pings (frozen)', async () => {
    const supervisor = new WorkerSupervisor();
    supervisor.spawn('watcher', 'watcher.worker');
    const frozenChild = children[0];

    // Ping fires, worker never responds with a pong within the timeout window.
    await vi.advanceTimersByTimeAsync(10_000); // ping sent
    await vi.advanceTimersByTimeAsync(10_000); // pong timeout elapses

    expect(frozenChild.kill).toHaveBeenCalledWith('SIGKILL');

    // The exit triggered by kill() schedules a respawn after RESTART_DELAY_MS.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(forkMock).toHaveBeenCalledTimes(2);
    expect(supervisor.getRestartCount('watcher')).toBe(1);
  });

  it('logs the exit status and restart counter, then respawns on crash', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supervisor = new WorkerSupervisor();
    supervisor.spawn('watcher', 'watcher.worker');
    const crashedChild = children[0];

    // Simulate an uncaught exception inside the worker: Node exits the
    // process with a non-zero code and no signal.
    crashedChild.emit('exit', 1, null);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('exited — code=1 signal=null')
    );

    await vi.advanceTimersByTimeAsync(1_000);

    expect(forkMock).toHaveBeenCalledTimes(2);
    expect(supervisor.getRestartCount('watcher')).toBe(1);

    errorSpy.mockRestore();
  });

  it('increments the restart counter across repeated crashes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const supervisor = new WorkerSupervisor();
    supervisor.spawn('watcher', 'watcher.worker');

    children[0].emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(supervisor.getRestartCount('watcher')).toBe(1);

    children[1].emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(supervisor.getRestartCount('watcher')).toBe(2);
    expect(forkMock).toHaveBeenCalledTimes(3);
  });
});
