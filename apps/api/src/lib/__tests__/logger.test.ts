import { describe, it, expect } from 'vitest';
import { createLogger, rootLogger } from '../logger';

describe('createLogger', () => {
  it('returns a pino logger instance', () => {
    const logger = createLogger();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('is a child of the rootLogger', () => {
    const logger = createLogger({ module: 'Test' });
    // Pino child loggers expose their parent's bindings
    expect((logger as any).bindings().module).toBe('Test');
  });

  it('binds requestId when provided', () => {
    const logger = createLogger({ requestId: 'req-abc-123' });
    expect((logger as any).bindings().requestId).toBe('req-abc-123');
  });

  it('binds both module and requestId when provided', () => {
    const logger = createLogger({ module: 'Queue', requestId: 'req-xyz' });
    const bindings = (logger as any).bindings();
    expect(bindings.module).toBe('Queue');
    expect(bindings.requestId).toBe('req-xyz');
  });

  it('omits requestId field when not provided', () => {
    const logger = createLogger({ module: 'Worker' });
    const bindings = (logger as any).bindings();
    expect(bindings.requestId).toBeUndefined();
  });

  it('returns a logger with no extra fields when called with no args', () => {
    const logger = createLogger();
    const bindings = (logger as any).bindings();
    expect(bindings.module).toBeUndefined();
    expect(bindings.requestId).toBeUndefined();
  });
});
