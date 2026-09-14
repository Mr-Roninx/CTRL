import { CacheManager } from './redis.js';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

export class DistributedRateLimiter {
  private static memoryBuckets: Map<string, number[]> = new Map();

  /**
   * Evaluates sliding window rate limit for a given key using Redis if available, fallback to memory.
   *
   * @param key Unique limiter identifier
   * @param maxRequests Allowed requests per window
   * @param windowSeconds Window length in seconds (e.g. 60)
   */
  public static async checkLimit(
    key: string,
    maxRequests: number,
    windowSeconds: number = 60
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const cutoff = now - windowMs;
    const redis = CacheManager.getInstance().getRedisClient();

    if (redis) {
      try {
        const pipeline = redis.pipeline();
        // Remove older entries
        pipeline.zremrangebyscore(key, 0, cutoff);
        // Add current timestamp
        pipeline.zadd(key, now, `${now}-${Math.random().toString(36).substring(2, 7)}`);
        // Count entries in the window
        pipeline.zcard(key);
        // Set expiry for the key
        pipeline.expire(key, windowSeconds);

        const results = await pipeline.exec();
        if (results && results[2] && results[2][1] !== null) {
          const count = results[2][1] as number;
          if (count > maxRequests) {
            // Need to get oldest timestamp to calculate reset
            const oldestArr = await redis.zrange(key, 0, 0, 'WITHSCORES');
            let oldest = now;
            if (oldestArr && oldestArr.length > 1) {
              oldest = parseInt(oldestArr[1], 10);
            }
            const resetSeconds = Math.ceil((oldest + windowMs - now) / 1000);
            return {
              allowed: false,
              remaining: 0,
              resetSeconds: Math.max(1, resetSeconds),
            };
          }
          return {
            allowed: true,
            remaining: Math.max(0, maxRequests - count),
            resetSeconds: windowSeconds,
          };
        }
      } catch (e) {
        console.warn('⚠️ RateLimiter Redis Error, falling back to memory', e);
      }
    }

    // Fallback to in-memory implementation
    let timestamps = this.memoryBuckets.get(key) || [];
    timestamps = timestamps.filter((t) => t > cutoff);

    if (timestamps.length >= maxRequests) {
      const oldest = timestamps[0] ?? now;
      const resetSeconds = Math.ceil((oldest + windowMs - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        resetSeconds: Math.max(1, resetSeconds),
      };
    }

    timestamps.push(now);
    this.memoryBuckets.set(key, timestamps);

    return {
      allowed: true,
      remaining: maxRequests - timestamps.length,
      resetSeconds: windowSeconds,
    };
  }

  public static clear(): void {
    this.memoryBuckets.clear();
  }
}
