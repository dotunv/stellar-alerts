/**
 * Test fixture for supervisor.integration.test.ts: a "worker" that answers
 * heartbeat pings like a real one, then throws an uncaught exception after
 * a short delay so the supervisor's crash-and-restart path can be exercised
 * against a real child process instead of a mock.
 */
process.on('message', (message: any) => {
  if (message?.type === 'ping') {
    process.send?.({ type: 'pong', pid: process.pid });
  }
});

setTimeout(() => {
  throw new Error('simulated uncaught exception in worker child process');
}, 50);
