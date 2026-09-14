import { CacheManager } from '../../src/cache/redis.js';
import { DistributedRateLimiter } from '../../src/cache/rate_limiter.js';

export async function runRedisCachingTests() {
  console.log('🧪 Running Test: Redis Caching & Message Layer...');

  const cache = CacheManager.getInstance();

  // 1. Probability Table Caching Test
  const mockTable = { p_natural: 0.15, p_intervention: 0.70 };
  await cache.setCachedProbabilityTable('test_insufficient_funds', mockTable);

  const cachedTable = await cache.getCachedProbabilityTable('test_insufficient_funds');
  if (!cachedTable || cachedTable.p_intervention !== 0.70) {
    throw new Error('Probability table caching failed');
  }

  // 2. Customer Trust Score Invalidation Test (Write-Through)
  const custId = 'cust_test_123';
  await cache.setCachedCustomerTrust(custId, 0.85);

  let trustScore = await cache.getCachedCustomerTrust(custId);
  if (trustScore !== 0.85) {
    throw new Error('Customer trust score cache failed');
  }

  await cache.invalidateCustomerTrust(custId);
  trustScore = await cache.getCachedCustomerTrust(custId);
  if (trustScore !== null) {
    throw new Error('Customer trust score invalidation failed');
  }

  // 3. Distributed Idempotency Key Lock (SETNX)
  const idempKey = `key_${Date.now()}`;
  const firstAcquire = await cache.acquireIdempotencyKey(idempKey, 10);
  if (!firstAcquire) {
    throw new Error('First idempotency key acquisition failed');
  }

  const secondAcquire = await cache.acquireIdempotencyKey(idempKey, 10);
  if (secondAcquire) {
    throw new Error('Duplicate idempotency key was allowed (expected lock collision)');
  }

  // 4. Kill Switch Pub/Sub Event Broadcast (< 5s)
  let receivedKillState = false;
  cache.onKillSwitchBroadcast((active) => {
    if (active === true) {
      receivedKillState = true;
    }
  });

  await cache.broadcastKillSwitch(true);
  // Wait brief event tick
  await new Promise((r) => setTimeout(r, 50));

  if (!receivedKillState) {
    throw new Error('Kill switch pub/sub broadcast was not received by subscriber');
  }

  // 5. Sliding Window Rate Limiter Test
  DistributedRateLimiter.clear();
  const rateLimitKey = 'test_limiter_user_1';

  // Request 1: allowed
  const r1 = await DistributedRateLimiter.checkLimit(rateLimitKey, 2, 60);
  if (!r1.allowed || r1.remaining !== 1) {
    throw new Error('Rate limit check 1 failed');
  }

  // Request 2: allowed
  const r2 = await DistributedRateLimiter.checkLimit(rateLimitKey, 2, 60);
  if (!r2.allowed || r2.remaining !== 0) {
    throw new Error('Rate limit check 2 failed');
  }

  // Request 3: blocked
  const r3 = await DistributedRateLimiter.checkLimit(rateLimitKey, 2, 60);
  if (r3.allowed) {
    throw new Error('Rate limit check 3 should have been blocked');
  }

  console.log('  ✅ PASS: Caching, Idempotency Locks, Rate Limiting & Kill Switch Pub/Sub verified.');
}

if (process.argv[1]?.endsWith('test_redis_caching.ts')) {
  runRedisCachingTests();
}
