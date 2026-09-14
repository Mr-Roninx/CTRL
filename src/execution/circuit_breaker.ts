import { CacheManager } from '../cache/redis.js';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold?: number; // default: 5 consecutive failures
  cooldownMs?: number; // default: 30,000ms (30s)
  requestTimeoutMs?: number; // default: 10,000ms (10s)
  maxRetries?: number; // default: 5
  key?: string; // Cache key for persistence
}

export class CircuitBreaker {
  private static instance: CircuitBreaker | null = null;

  private state: CircuitState = 'CLOSED';
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private lastStateChange: number = Date.now();
  private cacheKey: string;

  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly requestTimeoutMs: number;
  private readonly maxRetries: number;

  public constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 30000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10000;
    this.maxRetries = options.maxRetries ?? 5;
    this.cacheKey = `ctrl:cb:${options.key || 'default'}`;

    // Load persisted state asynchronously
    this.loadPersistedState().catch(() => {});
  }

  private async loadPersistedState(): Promise<void> {
    try {
      const cache = CacheManager.getInstance();
      const saved = await cache.get<{ state: CircuitState; failureCount: number; lastFailureTime: number }>(this.cacheKey);
      if (saved) {
        this.state = saved.state;
        this.failureCount = saved.failureCount;
        this.lastFailureTime = saved.lastFailureTime;
      }
    } catch {}
  }

  private persistState(): void {
    try {
      const cache = CacheManager.getInstance();
      cache.set(this.cacheKey, {
        state: this.state,
        failureCount: this.failureCount,
        lastFailureTime: this.lastFailureTime,
      }, Math.ceil(this.cooldownMs / 1000) * 2).catch(() => {});
    } catch {}
  }

  public static getInstance(): CircuitBreaker {
    if (!CircuitBreaker.instance) {
      CircuitBreaker.instance = new CircuitBreaker();
    }
    return CircuitBreaker.instance;
  }

  public getState(): CircuitState {
    this.checkCooldown();
    return this.state;
  }

  public getMetrics() {
    return {
      state: this.getState(),
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastStateChange: this.lastStateChange,
    };
  }

  private checkCooldown(): void {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.cooldownMs) {
        this.state = 'HALF_OPEN';
        this.lastStateChange = Date.now();
        this.persistState();
        console.log('⚡ CircuitBreaker: Cooldown elapsed. Transitioned to HALF_OPEN (probing)');
      }
    }
  }

  private recordSuccess(): void {
    this.failureCount = 0;
    this.successCount++;
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      this.lastStateChange = Date.now();
      this.persistState();
      console.log('✅ CircuitBreaker: Probe successful. Circuit CLOSED.');
    }
  }

  private recordFailure(err: Error): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.lastStateChange = Date.now();
      console.warn(`🚨 CircuitBreaker: Failure threshold reached (${this.failureCount}). Circuit OPEN.`);
    }
    this.persistState();
  }

  /**
   * Executes an async operation with 10s timeout, exponential backoff with jitter, and circuit breaker protection.
   */
  public async executeWithResilience<T>(
    operation: () => Promise<T>,
    contextName: string = 'RazorpayAPI'
  ): Promise<T> {
    if (this.getState() === 'OPEN') {
      throw new Error(`CircuitBreaker is OPEN for ${contextName}. Operations are currently suspended.`);
    }

    let lastError: any = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // Enforce request timeout with guaranteed timer cleanup
        let timeoutTimer: NodeJS.Timeout | undefined;
        try {
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutTimer = setTimeout(
              () => reject(new Error(`Timeout: ${contextName} exceeded 10s limit`)),
              this.requestTimeoutMs
            );
          });

          const result = await Promise.race([operation(), timeoutPromise]);
          this.recordSuccess();
          return result;
        } finally {
          if (timeoutTimer) {
            clearTimeout(timeoutTimer);
          }
        }
      } catch (err: any) {
        lastError = err;

        const isRateLimitOrClientError =
          err?.statusCode === 429 ||
          err?.statusCode === 400 ||
          err?.error?.description?.includes('Too many requests') ||
          err?.error?.code === 'BAD_REQUEST_ERROR';

        if (attempt === this.maxRetries || isRateLimitOrClientError) {
          break;
        }

        // Exponential backoff with jitter: 2^(attempt-1) * base + random jitter
        const baseDelayMs = Math.pow(2, attempt - 1) * 1000;
        const jitterMs = Math.floor(Math.random() * (baseDelayMs * 0.3));
        const totalDelayMs = Math.min(baseDelayMs + jitterMs, 8000);

        const errMsg =
          err?.error?.description ||
          err?.description ||
          err?.message ||
          (typeof err === 'object' ? JSON.stringify(err) : String(err));

        console.warn(
          `⚠️ ${contextName} failed on attempt ${attempt}/${this.maxRetries}: ${errMsg}. Retrying in ${totalDelayMs}ms...`
        );
        await new Promise((r) => setTimeout(r, totalDelayMs));
      }
    }

    this.recordFailure(lastError);
    throw lastError;
  }

  /**
   * Shorthand alias for executeWithResilience
   */
  public async execute<T>(operation: () => Promise<T>): Promise<T> {
    return this.executeWithResilience(operation);
  }

  public reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
    this.lastStateChange = Date.now();
  }
}
