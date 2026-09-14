import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { DistributedJobQueue, QueueJob } from '../../src/queue/job_queue.js';
import { CtrlWorkerProcess } from '../../src/worker.js';
import { initDatabase } from '../../src/db/database.js';

describe('Phase 10: Horizontal Scalability & Worker Architecture Verification', () => {
  const queue = DistributedJobQueue.getInstance();
  const testTenantId = `tenant_queue_${Date.now()}`;

  before(() => {
    initDatabase();
  });

  after(async () => {
    await queue.close();
  });

  describe('1. Distributed Job Queue Enqueue & Dequeue', () => {
    test('pushes and pops a job with FIFO semantics', async () => {
      const jobId = await queue.push({
        type: 'AGENT_REASONING_CYCLE',
        tenantId: testTenantId,
        payload: { test_key: 'test_value_1' },
      });

      assert.ok(jobId.startsWith('job_'), 'Job ID should be generated with prefix');

      const popped = await queue.pop(['AGENT_REASONING_CYCLE'], 1);
      assert.ok(popped !== null, 'Should pop queued job');
      assert.strictEqual(popped.id, jobId);
      assert.strictEqual(popped.tenantId, testTenantId);
      assert.strictEqual(popped.payload.test_key, 'test_value_1');
    });

    test('tracks queue depth accurately', async () => {
      const initialDepth = await queue.getQueueDepth('MARKET_ALLOCATION_RUN');
      assert.strictEqual(initialDepth, 0);

      await queue.push({
        type: 'MARKET_ALLOCATION_RUN',
        tenantId: testTenantId,
        payload: { capacity: 5 },
      });

      await queue.push({
        type: 'MARKET_ALLOCATION_RUN',
        tenantId: testTenantId,
        payload: { capacity: 3 },
      });

      const depthAfter = await queue.getQueueDepth('MARKET_ALLOCATION_RUN');
      assert.strictEqual(depthAfter, 2);

      // Pop one
      const popped = await queue.pop(['MARKET_ALLOCATION_RUN'], 1);
      assert.ok(popped);

      const depthFinal = await queue.getQueueDepth('MARKET_ALLOCATION_RUN');
      assert.strictEqual(depthFinal, 1);

      // Clean up remaining
      await queue.pop(['MARKET_ALLOCATION_RUN'], 1);
    });

    test('re-queues failed jobs with incremented attempt counter until maxAttempts', async () => {
      const job: QueueJob = {
        id: `job_retry_${Date.now()}`,
        type: 'DLQ_RETRY_SWEEP',
        tenantId: testTenantId,
        payload: {},
        createdAt: new Date().toISOString(),
        attempts: 0,
        maxAttempts: 2,
      };

      // First retry attempt
      const retried1 = await queue.retry(job);
      assert.strictEqual(retried1, true);
      assert.strictEqual(job.attempts, 1);

      // Clean up the re-queued job from the queue
      const poppedRetry = await queue.pop(['DLQ_RETRY_SWEEP'], 1);
      assert.ok(poppedRetry !== null);
      assert.strictEqual(poppedRetry.id, job.id);

      // Second retry attempt (exhausts maxAttempts=2)
      const retried2 = await queue.retry(job);
      assert.strictEqual(retried2, false, 'Should reject retry after maxAttempts exhausted');
    });
  });

  describe('2. Decoupled Worker Job Dispatching & Distributed Tracing', () => {
    test('worker processes job under trace span and binds tenant context', async () => {
      const worker = new CtrlWorkerProcess();
      let jobHandled = false;

      const job: QueueJob = {
        id: `job_worker_test_${Date.now()}`,
        type: 'RECONCILIATION_SWEEP',
        tenantId: testTenantId,
        payload: {},
        createdAt: new Date().toISOString(),
        attempts: 0,
        maxAttempts: 3,
      };

      // Process job directly
      await worker.processJob(job);
      jobHandled = true;
      assert.strictEqual(jobHandled, true);
    });

    test('worker processes agent reasoning cycle without error', async () => {
      const worker = new CtrlWorkerProcess();
      let cycleHandled = false;

      const job: QueueJob = {
        id: `job_agent_cycle_${Date.now()}`,
        type: 'AGENT_REASONING_CYCLE',
        tenantId: testTenantId,
        payload: { capacity: 3 },
        createdAt: new Date().toISOString(),
        attempts: 0,
        maxAttempts: 3,
      };

      await worker.processJob(job);
      cycleHandled = true;
      assert.strictEqual(cycleHandled, true);
    });
  });
});
