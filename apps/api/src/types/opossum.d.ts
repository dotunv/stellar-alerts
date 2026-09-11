declare module "opossum" {
  interface CircuitBreakerOptions {
    timeout?: number;
    errorThresholdPercentage?: number;
    volumeThreshold?: number;
    rollingCountTimeout?: number;
    name?: string;
    [key: string]: any;
  }

  interface CircuitBreakerStats {
    fires: number;
    successes: number;
    failures: number;
    rejects: number;
    opens: number;
    halfOpens: number;
    closes: number;
    fallbacks: number;
    fires: number;
    percentiles: {
      [key: string]: number;
    };
  }

  class CircuitBreaker<T extends (...args: any[]) => Promise<any>> {
    constructor(
      fn: T,
      options?: CircuitBreakerOptions
    );
    fire(...args: Parameters<T>): ReturnType<T>;
    fallback(...args: Parameters<T>): ReturnType<T>;
    stats(): CircuitBreakerStats;
    open(): this;
    close(): this;
    halfOpen(): this;
    isClosed(): boolean;
    isOpen(): boolean;
    isHalfOpen(): boolean;
  }

  export = CircuitBreaker;
}
