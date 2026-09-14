process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker } from '../../src/execution/circuit_breaker.js';

describe('V6 Phase 10: Circuit Breaker Failure Protection & Half-Open Probing', () => {
  it('trips from CLOSED to OPEN after consecutive failure threshold is reached and fails fast', async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 3,
      cooldownMs: 100, // Short cooldown for testing
      requestTimeoutMs: 500,
      maxRetries: 1,
    });

    assert.equal(cb.getState(), 'CLOSED');

    // 3 consecutive failures
    for (let i = 0; i < 3; i++) {
      await assert.rejects(
        async () => {
          await cb.executeWithResilience(async () => {
            throw new Error('Simulated Razorpay 503 API Outage');
          });
        },
        /Simulated Razorpay 503 API Outage/
      );
    }

    // Circuit should now be OPEN
    assert.equal(cb.getState(), 'OPEN');

    // Fail fast without executing operation
    let attemptedExecution = false;
    await assert.rejects(
      async () => {
        await cb.executeWithResilience(async () => {
          attemptedExecution = true;
          return { success: true };
        });
      },
      /CircuitBreaker is OPEN/
    );

    assert.equal(attemptedExecution, false, 'Must fail fast without invoking provider operation');
  });

  it('transitions to HALF_OPEN after cooldown and resets to CLOSED upon successful probe', async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 80,
      requestTimeoutMs: 500,
      maxRetries: 1,
    });

    // Cause 2 failures to trip circuit
    for (let i = 0; i < 2; i++) {
      try {
        await cb.executeWithResilience(async () => {
          throw new Error('500 Error');
        });
      } catch {}
    }

    assert.equal(cb.getState(), 'OPEN');

    // Wait for cooldown to elapse
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Cooldown elapsed -> transitions to HALF_OPEN
    assert.equal(cb.getState(), 'HALF_OPEN');

    // Probe succeeds
    const probeResult = await cb.executeWithResilience(async () => {
      return { id: 'plink_probe_123', status: 'created' };
    });

    assert.equal(probeResult.id, 'plink_probe_123');
    // Successful probe resets circuit to CLOSED
    assert.equal(cb.getState(), 'CLOSED');
  });
});
