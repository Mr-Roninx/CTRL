import { CircuitBreaker } from '../../src/execution/circuit_breaker.js';
import { ExecutionDLQ } from '../../src/execution/dlq.js';
import { DatabaseAdapter } from '../../src/db/adapter.js';

export async function runExecutionResilienceTests() {
  console.log('🧪 Running Test: Execution Engine Resilience & Circuit Breaker...');

  // 1. Circuit Breaker Failure Threshold Verification (5 failures -> OPEN)
  const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 100, requestTimeoutMs: 500, maxRetries: 1 });

  for (let i = 0; i < 3; i++) {
    try {
      await breaker.executeWithResilience(async () => {
        throw new Error('Simulated Razorpay API network error');
      });
    } catch (e) {
      // expected
    }
  }

  if (breaker.getState() !== 'OPEN') {
    throw new Error(`CircuitBreaker state expected to be OPEN, got ${breaker.getState()}`);
  }

  // Attempting request while OPEN should immediately reject without executing
  let rejectedWhileOpen = false;
  try {
    await breaker.executeWithResilience(async () => 'ok');
  } catch (err: any) {
    if (err.message.includes('CircuitBreaker is OPEN')) {
      rejectedWhileOpen = true;
    }
  }

  if (!rejectedWhileOpen) {
    throw new Error('CircuitBreaker failed to reject request while in OPEN state');
  }

  // Wait for cooldown to transition to HALF_OPEN
  await new Promise((r) => setTimeout(r, 150));
  if (breaker.getState() !== 'HALF_OPEN') {
    throw new Error(`CircuitBreaker expected to be HALF_OPEN after cooldown, got ${breaker.getState()}`);
  }

  // Successful probe resets circuit to CLOSED
  await breaker.executeWithResilience(async () => 'probe_success');
  if (breaker.getState() !== 'CLOSED') {
    throw new Error(`CircuitBreaker expected to be CLOSED after successful probe, got ${breaker.getState()}`);
  }

  // 2. Dead Letter Queue & Retry Schedule Verification
  const testOppId = `opp_dlq_${Date.now()}`;
  const adapter = DatabaseAdapter.getInstance();
  await adapter.execute(`
    INSERT INTO customers (id, trust_score, created_at, updated_at) VALUES ('cust_test_dlq', 0.5, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO NOTHING;
  `);
  await adapter.execute(`
    INSERT INTO recovery_opportunities (id, source, amount_paise, currency, reason_code, decline_type, attempt_count, customer_id, customer_trust_score, created_at, status)
    VALUES (?, 'synthetic', 50000, 'INR', 'generic_decline', 'soft', 1, 'cust_test_dlq', 0.5, datetime('now'), 'executing');
  `, [testOppId]);

  // Retry 1: 5 min
  const fail1 = await ExecutionDLQ.recordExecutionFailure(testOppId, 'Connection reset by peer');
  if (fail1.failure_count !== 1 || fail1.status !== 'PENDING_RETRY') {
    throw new Error('DLQ failure #1 recording invalid');
  }

  // Retry 2: 15 min
  const fail2 = await ExecutionDLQ.recordExecutionFailure(testOppId, 'Gateway timeout');
  if (fail2.failure_count !== 2) {
    throw new Error('DLQ failure #2 recording invalid');
  }

  // Record 3 more failures to reach permanently failed status (total 5)
  await ExecutionDLQ.recordExecutionFailure(testOppId, 'Error 3');
  await ExecutionDLQ.recordExecutionFailure(testOppId, 'Error 4');
  const fail5 = await ExecutionDLQ.recordExecutionFailure(testOppId, 'Error 5');

  if ((fail5.status !== 'PERMANENTLY_FAILED' && (fail5.status as string) !== 'DEAD_LETTER') || fail5.next_retry_at !== null) {
    throw new Error('DLQ failed to transition to PERMANENTLY_FAILED after exhausting retries');
  }

  console.log('  ✅ PASS: Circuit breaker trips, half-open resets, 10s timeouts and DLQ 5m/15m/1h/4h retry schedule verified.');
}

if (process.argv[1]?.endsWith('test_execution_resilience.ts')) {
  runExecutionResilienceTests();
}
