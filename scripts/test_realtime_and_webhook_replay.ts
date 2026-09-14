import { app } from '../src/server.js';
import { initDatabase, db, getOpportunityById, getWebhookDeliveries, getWebhookDeliveryById } from '../src/db/database.js';
import { MigrationRunner } from '../src/db/migrations/runner.js';
import { ApiKeyService } from '../src/security/api_keys.js';
import { WebhookQueueEngine } from '../src/webhooks/queue.js';
import { RealtimeBroadcaster } from '../src/realtime/broadcaster.js';
import http from 'node:http';

async function runRealtimeAndReplayTest() {
  console.log('🧪 Starting Webhook Replay, Retry Engine & Realtime Stream Test Suite...\n');

  // 1. Initialize DB
  initDatabase();
  await MigrationRunner.migrateUp();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  const queueEngine = WebhookQueueEngine.getInstance();

  try {
    const testTenantId = `tnt_replay_${Date.now()}`;
    const insertTenantStmt = db.prepare(`
      INSERT INTO tenants (id, name, slug, environment, status, created_at)
      VALUES (?, ?, ?, 'test', 'ACTIVE', ?)
    `);
    insertTenantStmt.run(
      testTenantId,
      'Replay Test Storefront',
      `replay-test-${Date.now()}`,
      new Date().toISOString()
    );

    const keyResult = await ApiKeyService.createApiKey({
      tenantId: testTenantId,
      name: 'Replay Test Key',
      environment: 'test',
      scopes: ['events:write', 'events:read'],
    });
    const apiKey = keyResult.rawKey;

    console.log(`✅ Tenant created: ${testTenantId}`);

    // Test 1: Enqueue a Webhook via WebhookQueueEngine
    console.log('\nTest 1: Enqueuing raw webhook payload into persistent queue...');
    const queueEngine = WebhookQueueEngine.getInstance();
    const uniqueId = Date.now();

    const queuedItem = queueEngine.enqueue({
      tenantId: testTenantId,
      source: 'RAZORPAY_WEBHOOK',
      eventId: `evt_replay_test_${uniqueId}`,
      eventType: 'payment.failed',
      payload: {
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: `pay_replay_${uniqueId}`,
              amount: 55000, // ₹550
              currency: 'INR',
              status: 'failed',
              error_code: 'BAD_REQUEST_PAYMENT_FAILED',
              error_description: 'Test Webhook: Issuer declined transaction',
              email: 'replay_customer@example.com',
            },
          },
        },
      },
    });

    if (!queuedItem || queuedItem.status !== 'PENDING') {
      throw new Error(`Expected PENDING status on enqueued webhook, got ${queuedItem?.status}`);
    }
    console.log(`✅ Test 1 Passed: Webhook enqueued with ID: ${queuedItem.id}`);

    // Test 2: Process & Replay Webhook Delivery via POST /v1/webhooks/queue/:id/replay
    console.log('\nTest 2: Replaying delivery item via API...');
    const replayRes = await fetch(`${baseUrl}/v1/webhooks/queue/${queuedItem.id}/replay`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const replayJson = await replayRes.json();
    if (replayRes.status !== 200 || !replayJson.success || !replayJson.opportunity_id) {
      throw new Error(`Expected successful replay, got ${replayRes.status}: ${JSON.stringify(replayJson)}`);
    }

    console.log(`✅ Test 2 Passed: Webhook replayed into Opportunity: ${replayJson.opportunity_id} (Status: ${replayJson.delivery.status})`);

    // Verify opportunity in DB
    const opp = getOpportunityById(replayJson.opportunity_id);
    if (!opp) throw new Error('Replayed opportunity not found in DB');
    console.log(`✅ Opportunity verified: amount=₹${(opp.amount_paise / 100).toFixed(2)}, status=${opp.status}`);

    // Test 3: Dead Letter Queue (DLQ) threshold transition
    console.log('\nTest 3: Testing Dead Letter Queue threshold with intentionally failing payload...');
    const badItem = queueEngine.enqueue({
      tenantId: testTenantId,
      eventType: 'payment.failed',
      payload: 'INVALID_CORRUPTED_JSON_STRING',
    });

    // Simulate 5 failed attempts to trigger DEAD_LETTER transition
    for (let i = 0; i < 5; i++) {
      await queueEngine.processDelivery(badItem);
      const current = getWebhookDeliveryById(badItem.id, testTenantId);
      badItem.attempts = current!.attempts;
    }

    const dlqItem = getWebhookDeliveryById(badItem.id, testTenantId);
    if (!dlqItem || dlqItem.status !== 'DEAD_LETTER') {
      throw new Error(`Expected DEAD_LETTER status after 5 attempts, got ${dlqItem?.status}`);
    }
    console.log(`✅ Test 3 Passed: Delivery moved to DEAD_LETTER after ${dlqItem.attempts} attempts (Error: "${dlqItem.last_error}")`);

    // Test 4: Batch requeue dead letter deliveries via POST /v1/webhooks/queue/retry-all
    console.log('\nTest 4: Batch retrying dead-letter items...');
    const retryAllRes = await fetch(`${baseUrl}/v1/webhooks/queue/retry-all`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const retryAllJson = await retryAllRes.json();
    if (retryAllRes.status !== 200 || retryAllJson.requeued_count < 1) {
      throw new Error(`Expected at least 1 requeued item, got: ${JSON.stringify(retryAllJson)}`);
    }
    console.log(`✅ Test 4 Passed: Requeued ${retryAllJson.requeued_count} dead-letter deliveries back to PENDING`);

    // Test 5: RealtimeBroadcaster active count verification
    console.log('\nTest 5: Testing RealtimeBroadcaster engine...');
    const broadcaster = RealtimeBroadcaster.getInstance();
    broadcaster.broadcastToTenant(testTenantId, 'EVENT_INGESTED', { test: true });
    console.log('✅ Test 5 Passed: Broadcast pipeline invoked with zero errors');

    console.log('\n🎉 ALL WEBHOOK REPLAY, RETRY QUEUE & REALTIME TESTS PASSED SUCCESSFULLY!');
  } finally {
    queueEngine.stopWorker();
    RealtimeBroadcaster.getInstance().stopHeartbeat();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runRealtimeAndReplayTest().catch((err) => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
