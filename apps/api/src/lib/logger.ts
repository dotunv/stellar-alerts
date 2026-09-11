/**
 * Shared structured Pino logger for use outside the Fastify request lifecycle
 * (BullMQ workers, background jobs, etc.).
 *
 * Within Fastify routes, prefer `request.log` which already carries the
 * correlation `requestId` automatically.
 */
import pino from 'pino';

/** Root logger – all child loggers inherit this configuration. */
export const rootLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
});

/**
 * Create a child logger bound to an optional correlation ID.
 *
 * @example
 * // In a BullMQ worker job handler:
 * const log = createLogger({ requestId: job.data.requestId, module: 'WatcherWorker' });
 * log.info({ walletId }, 'Processing wallet payments');
 */
export function createLogger(
  bindings: { requestId?: string; module?: string } = {}
): pino.Logger {
  const fields: Record<string, string> = {};
  if (bindings.module) fields['module'] = bindings.module;
  if (bindings.requestId) fields['requestId'] = bindings.requestId;
  return rootLogger.child(fields);
}
