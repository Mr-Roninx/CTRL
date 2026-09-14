import { ExecutionDLQ } from '../../src/execution/dlq.js';
import { CircuitBreaker } from '../../src/execution/circuit_breaker.js';
import { JobScheduler } from '../../src/execution/job_scheduler.js';
import { DatabaseAdapter } from '../../src/db/adapter.js';
import { initDatabase, insertOpportunity } from '../../src/db/database.js';

async function runResilientExecutionTests() {
  console.log('🧪 Running Phase 5 Resilient Execution Engine Test Suite...\n');
  initDatabase();
  const db = DatabaseAdapter.getInstance();
  await ExecutionDLQ.initTable(db);

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      failed++;
    }
  }

  // Seed test opportunities
  const testOpp1 = {
    id: `opp_test_dlq_${Date.now()}_1`,
    source: 'synthetic' as const,
    amount_paise: 500000,
    currency: 'INR',
    reason_code: 'BANK_SERVER_OUTAGE',
    decline_type: 'soft' as const,
    attempt_count: 1,
    customer_id: 'cust_dlq_1',
    customer_trust_score: 85,
    created_at: new Date().toISOString(),
    status: 'allocated' as const,
  };

  const testOpp2 = {
    id: `opp_test_dlq_${Date.now()}_2`,
    source: 'synthetic' as const,
    amount_paise: 1200000,
    currency: 'INR',
    reason_code: 'PAYMENT_CANCELLED',
    decline_type: 'soft' as const,
    attempt_count: 1,
    customer_id: 'cust_dlq_2',
    customer_trust_score: 90,
    created_at: new Date().toISOString(),
    status: 'allocated' as const,
  };

  insertOpportunity(testOpp1);
  insertOpportunity(testOpp2);

  // 1. DLQ Recording & Exponential Backoff
  console.log('--- Test 1: DLQ Record & Backoff Progression ---');
  const record1 = await ExecutionDLQ.recordExecutionFailure(testOpp1.id, 'Connection timeout to gateway');
  assert(record1.failure_count === 1, 'First failure records failure_count = 1');
  assert(record1.status === 'PENDING_RETRY', 'First failure status is PENDING_RETRY');
  assert(record1.next_retry_at !== null, 'First failure has next_retry_at set');

  const record2 = await ExecutionDLQ.recordExecutionFailure(testOpp1.id, 'Second timeout');
  assert(record2.failure_count === 2, 'Second failure records failure_count = 2');
  assert(record2.status === 'PENDING_RETRY', 'Second failure status is still PENDING_RETRY');

  // 2. DLQ Dead-Letter & Escalation on Max Retries
  console.log('\n--- Test 2: DLQ Dead-Letter Escalation ---');
  await ExecutionDLQ.recordExecutionFailure(testOpp1.id, 'Retry 3 failed');
  await ExecutionDLQ.recordExecutionFailure(testOpp1.id, 'Retry 4 failed');
  await ExecutionDLQ.recordExecutionFailure(testOpp1.id, 'Retry 5 failed');
  const dlRecord = await ExecutionDLQ.recordExecutionFailure(testOpp1.id, 'Exhausted retry 6');
  assert(dlRecord.status === 'DEAD_LETTER', 'Exceeding retry intervals transitions to DEAD_LETTER');
  assert(dlRecord.next_retry_at === null, 'Dead-lettered record has null next_retry_at');

  // 3. DLQ Resolution
  console.log('\n--- Test 3: DLQ Retry Resolution ---');
  const opp2Failure = await ExecutionDLQ.recordExecutionFailure(testOpp2.id, 'Transient 503');
  assert(opp2Failure.status === 'PENDING_RETRY', 'Opp 2 initial failure recorded as PENDING_RETRY');
  await ExecutionDLQ.markRetrySuccess(testOpp2.id);
  const opp2Db = await db.query<any>('SELECT * FROM dlq_jobs WHERE opportunity_id = ? ORDER BY id DESC LIMIT 1;', [testOpp2.id]);
  assert(opp2Db[0]?.status === 'RESOLVED', 'Opp 2 successfully resolved in dlq_jobs table');

  // 4. Circuit Breaker Trips on Consecutive Failures
  console.log('\n--- Test 4: Circuit Breaker State Transitions ---');
  const cb = new CircuitBreaker({
    failureThreshold: 3,
    cooldownMs: 500, // short cooldown for testing
    requestTimeoutMs: 1000,
    maxRetries: 1,
    key: `test_${Date.now()}`,
  });

  assert(cb.getState() === 'CLOSED', 'CircuitBreaker initializes in CLOSED state');

  // Trip the breaker with failures
  for (let i = 0; i < 3; i++) {
    try {
      await cb.execute(async () => {
        throw new Error('Downstream API failure');
      });
    } catch {}
  }

  assert(cb.getState() === 'OPEN', 'CircuitBreaker transitions to OPEN after 3 failures');

  // Verify fast-fail while OPEN
  let rejectedFast = false;
  try {
    await cb.execute(async () => {
      return 'should not run';
    });
  } catch (err: any) {
    if (err.message && err.message.toLowerCase().includes('open')) {
      rejectedFast = true;
    }
  }
  assert(rejectedFast, 'CircuitBreaker fast-fails when OPEN without executing operation');

  // Wait for cooldown to transition to HALF_OPEN
  await new Promise((r) => setTimeout(r, 600));
  assert(cb.getState() === 'HALF_OPEN', 'CircuitBreaker transitions to HALF_OPEN after cooldown');

  // Successful probe resets circuit to CLOSED
  const probeResult = await cb.execute(async () => 'probe_success');
  assert(probeResult === 'probe_success', 'Probe call executes successfully');
  assert(cb.getState() === 'CLOSED', 'Successful probe resets CircuitBreaker to CLOSED');

  // 5. JobScheduler Lifecycle
  console.log('\n--- Test 5: JobScheduler Lifecycle ---');
  const scheduler = JobScheduler.getInstance();
  scheduler.start();
  const activeStatus = scheduler.getStatus();
  assert(activeStatus.isRunning === true, 'JobScheduler is running after start()');
  assert(activeStatus.isDraining === false, 'JobScheduler is not draining after start()');

  await scheduler.stop();
  const stoppedStatus = scheduler.getStatus();
  assert(stoppedStatus.isRunning === false, 'JobScheduler is stopped after stop()');
  assert(stoppedStatus.isDraining === true, 'JobScheduler marks draining flag on stop()');

  console.log(`\n========================================`);
  console.log(`Phase 5 Test Results: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runResilientExecutionTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
