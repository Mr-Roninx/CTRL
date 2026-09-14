process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucketRateLimiter } from '../../src/execution/rate_limiter.js';

describe('V6 Phase 10: Provider Token Bucket Rate Limiting', () => {
  it('enforces token capacity and rate limits burst requests beyond bucket size', () => {
    const limiter = new TokenBucketRateLimiter({
      capacity: 5,
      refillRatePerSecond: 10,
    });

    assert.equal(limiter.getAvailableTokens(), 5);

    // Consume all 5 tokens
    for (let i = 0; i < 5; i++) {
      assert.equal(limiter.tryConsume(1), true, `Token ${i + 1} must be granted`);
    }

    // 6th request must be rate limited
    assert.equal(limiter.tryConsume(1), false, 'Burst exceeding bucket capacity must be rejected');
  });

  it('refills tokens over time and resumes granting capacity', async () => {
    const limiter = new TokenBucketRateLimiter({
      capacity: 5,
      refillRatePerSecond: 20, // 20 tokens/sec -> 1 token every 50ms
    });

    // Exhaust bucket
    for (let i = 0; i < 5; i++) limiter.tryConsume(1);
    assert.equal(limiter.tryConsume(1), false);

    // Wait 120ms (refills ~2 tokens)
    await new Promise((resolve) => setTimeout(resolve, 120));

    assert.ok(limiter.getAvailableTokens() >= 1, 'Tokens must have refilled');
    assert.equal(limiter.tryConsume(1), true, 'Request must succeed after refill');
  });
});
