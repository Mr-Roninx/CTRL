import { Request, Response, NextFunction } from 'express';
import { CacheManager } from '../cache/redis.js';
import { resolveTenantId } from '../security/tenant_guard.js';
import { getDatabase } from '../db/database.js';

export type RateLimitTier = 'FREE' | 'STARTER' | 'GROWTH' | 'ENTERPRISE';

export interface TierConfig {
  maxRequestsPerMinute: number;
  burstAllowance: number;
}

export const TIER_CONFIGS: Record<RateLimitTier, TierConfig> = {
  FREE: { maxRequestsPerMinute: 60, burstAllowance: 10 },
  STARTER: { maxRequestsPerMinute: 300, burstAllowance: 50 },
  GROWTH: { maxRequestsPerMinute: 1200, burstAllowance: 200 },
  ENTERPRISE: { maxRequestsPerMinute: 6000, burstAllowance: 1000 },
};

// In-memory sliding window bucket fallback when Redis is unavailable
interface BucketEntry {
  count: number;
  windowStart: number;
}
const memoryBuckets = new Map<string, BucketEntry>();

/**
 * Resolves the plan tier for a tenant from the database with default to FREE or STARTER.
 */
export async function resolveTenantTier(tenantId: string): Promise<RateLimitTier> {
  if (!tenantId || tenantId === 'tenant_system_default') {
    return 'ENTERPRISE';
  }

  try {
    const db = getDatabase();
    const row = db.prepare('SELECT plan_tier, tier FROM tenants WHERE id = ? LIMIT 1;').get(tenantId) as any;
    const tier = (row?.plan_tier || row?.tier || '').toUpperCase();
    if (['FREE', 'STARTER', 'GROWTH', 'ENTERPRISE'].includes(tier)) {
      return tier as RateLimitTier;
    }
  } catch {
    // Ignore DB error and fallback
  }

  return 'STARTER';
}

/**
 * Express middleware enforcing tiered sliding-window rate limits.
 */
export function tieredRateLimiter(options?: { overrideTier?: RateLimitTier }) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Skip OPTIONS preflight, health, and static asset routes
    if (req.method === 'OPTIONS' || req.path.startsWith('/health') || req.path === '/metrics' || req.path === '/openapi.json' || req.path.startsWith('/docs')) {
      return next();
    }

    const tenantId = resolveTenantId(req) || 'tenant_system_default';
    const tier: RateLimitTier = options?.overrideTier || (await resolveTenantTier(tenantId));
    const config = TIER_CONFIGS[tier];

    const now = Date.now();
    const windowMs = 60 * 1000;
    const windowKey = `ratelimit:${tenantId}:${Math.floor(now / windowMs)}`;
    const cache = CacheManager.getInstance();

    let currentCount = 0;

    if (cache.isHealthy()) {
      try {
        currentCount = await cache.incr(windowKey);
        if (currentCount === 1) {
          await cache.expire(windowKey, 65);
        }
      } catch {
        currentCount = incrementMemoryBucket(tenantId, now, windowMs);
      }
    } else {
      currentCount = incrementMemoryBucket(tenantId, now, windowMs);
    }

    const limit = config.maxRequestsPerMinute;
    const remaining = Math.max(0, limit - currentCount);
    const resetTimeSeconds = Math.ceil((Math.floor(now / windowMs) * windowMs + windowMs - now) / 1000);

    // Standard RFC RateLimit headers
    res.setHeader('X-RateLimit-Tier', tier);
    res.setHeader('X-RateLimit-Limit', limit.toString());
    res.setHeader('X-RateLimit-Remaining', remaining.toString());
    res.setHeader('X-RateLimit-Reset', resetTimeSeconds.toString());

    if (currentCount > limit) {
      res.setHeader('Retry-After', resetTimeSeconds.toString());
      res.status(429).json({
        type: 'https://ctrl.dev/errors/rate-limit-exceeded',
        title: 'Rate Limit Exceeded',
        status: 429,
        detail: `Tenant [${tenantId}] on ${tier} plan exceeded the limit of ${limit} req/min. Please retry in ${resetTimeSeconds}s or upgrade your plan.`,
        tier,
        limit,
        retry_after_seconds: resetTimeSeconds,
      });
      return;
    }

    next();
  };
}

function incrementMemoryBucket(tenantId: string, now: number, windowMs: number): number {
  const currentWindowStart = Math.floor(now / windowMs) * windowMs;
  const entry = memoryBuckets.get(tenantId);

  if (!entry || entry.windowStart !== currentWindowStart) {
    memoryBuckets.set(tenantId, { count: 1, windowStart: currentWindowStart });
    // Garbage collection of old buckets
    if (memoryBuckets.size > 5000) {
      for (const [k, v] of memoryBuckets.entries()) {
        if (now - v.windowStart > windowMs * 2) {
          memoryBuckets.delete(k);
        }
      }
    }
    return 1;
  }

  entry.count += 1;
  return entry.count;
}
