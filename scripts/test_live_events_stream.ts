import { app } from '../src/server.js';
import { initDatabase, db } from '../src/db/database.js';
import { MigrationRunner } from '../src/db/migrations/runner.js';
import { ApiKeyService } from '../src/security/api_keys.js';
import http from 'node:http';

async function runLiveEventsTest() {
  console.log('🧪 Starting Live Event Ingestion Stream & Debugging Tests...\n');

  // 1. Initialize DB
  initDatabase();
  await MigrationRunner.migrateUp();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  try {
    const testTenantId = `tenant_stream_${Date.now()}`;
    const insertTenantStmt = db.prepare(`
      INSERT INTO tenants (id, name, slug, environment, status, created_at)
      VALUES (?, ?, ?, 'test', 'ACTIVE', ?)
    `);
    insertTenantStmt.run(
      testTenantId,
      'Live Stream Test Merchant',
      `stream-test-${Date.now()}`,
      new Date().toISOString()
    );

    const keyResult = await ApiKeyService.createApiKey({
      tenantId: testTenantId,
      name: 'Stream Test Key',
      environment: 'test',
      scopes: ['events:write', 'events:read'],
    });
    const apiKey = keyResult.rawKey;

    console.log(`✅ Test tenant created: ${testTenantId}`);

    // Test 1: Valid Failed Event Ingestion (Expect 201 + ACCEPTED log)
    const event1Id = `evt_valid_${Date.now()}`;
    const validRes = await fetch(`${baseUrl}/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Origin': 'https://checkout.mystore.com',
      },
      body: JSON.stringify({
        event_id: event1Id,
        source: 'CLIENT_SDK',
        provider: 'razorpay',
        environment: 'test',
        payment_id: `pay_${Date.now()}_1`,
        amount_paise: 35000,
        currency: 'INR',
        status: 'failed',
        failure_code: 'INSUFFICIENT_FUNDS',
        failure_description: 'Card balance insufficient',
        customer_reference: 'cust_stream_1@example.com',
        occurred_at: new Date().toISOString(),
      }),
    });

    const validJson = await validRes.json();
    if (validRes.status !== 201) {
      throw new Error(`Expected 201 for valid event, got ${validRes.status}: ${JSON.stringify(validJson)}`);
    }
    console.log('✅ Test 1 Passed: Valid failed payment event ingested (201 Created)');

    // Test 2: Duplicate Event Ingestion (Expect 200 + DEDUPLICATED log)
    const dupRes = await fetch(`${baseUrl}/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        event_id: event1Id, // Same event ID
        source: 'CLIENT_SDK',
        provider: 'razorpay',
        payment_id: `pay_${Date.now()}_dup`,
        amount_paise: 35000,
        currency: 'INR',
        status: 'failed',
        failure_code: 'INSUFFICIENT_FUNDS',
        customer_reference: 'cust_stream_1@example.com',
      }),
    });

    const dupJson = await dupRes.json();
    if (dupRes.status !== 200 || !dupJson.deduplicated) {
      throw new Error(`Expected 200 deduplicated, got ${dupRes.status}: ${JSON.stringify(dupJson)}`);
    }
    console.log('✅ Test 2 Passed: Duplicate event deduplicated (200 OK)');

    // Test 3: Malformed Event Ingestion (Expect 400 + REJECTED log with error details)
    const malformedRes = await fetch(`${baseUrl}/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        event_id: `evt_bad_${Date.now()}`,
        amount_paise: -500, // Invalid negative amount
        currency: 'INVALID_CURRENCY',
        status: 'invalid_status_value',
      }),
    });

    const malformedJson = await malformedRes.json();
    if (malformedRes.status !== 400) {
      throw new Error(`Expected 400 for malformed payload, got ${malformedRes.status}: ${JSON.stringify(malformedJson)}`);
    }
    console.log('✅ Test 3 Passed: Malformed event caught and rejected with Zod schema details (400 Bad Request)');

    // Test 4: Query Live Stream via API (Expect all logged records)
    const streamRes = await fetch(`${baseUrl}/v1/events/stream`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const streamJson = await streamRes.json();
    if (streamRes.status !== 200 || !streamJson.logs) {
      throw new Error(`Expected 200 from /v1/events/stream, got ${streamRes.status}: ${JSON.stringify(streamJson)}`);
    }

    const logs = streamJson.logs;
    console.log(`📊 Stream returned ${logs.length} logs for tenant ${testTenantId}`);

    const acceptedLog = logs.find((l: any) => l.status === 'ACCEPTED');
    const deduplicatedLog = logs.find((l: any) => l.status === 'DEDUPLICATED');
    const rejectedLog = logs.find((l: any) => l.status === 'REJECTED');

    if (!acceptedLog) throw new Error('Missing ACCEPTED log in event stream');
    if (!deduplicatedLog) throw new Error('Missing DEDUPLICATED log in event stream');
    if (!rejectedLog) throw new Error('Missing REJECTED log in event stream');

    console.log(`✅ Accepted log verified: opportunity_id=${acceptedLog.opportunity_id}, origin=${acceptedLog.origin}`);
    console.log(`✅ Deduplicated log verified: reason="${deduplicatedLog.rejection_reason}"`);
    console.log(`✅ Rejected log verified: rejection_reason="${rejectedLog.rejection_reason}"`);

    // Test 5: Filtered stream query
    const filteredRes = await fetch(`${baseUrl}/v1/events/stream?status=REJECTED`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const filteredJson = await filteredRes.json();
    if (filteredRes.status !== 200 || filteredJson.logs.some((l: any) => l.status !== 'REJECTED')) {
      throw new Error('Filtered stream query returned unexpected statuses');
    }
    console.log(`✅ Test 5 Passed: Status filter (status=REJECTED) returned ${filteredJson.logs.length} records`);

    console.log('\n🎉 ALL LIVE EVENT STREAM & REJECTION LOG TESTS PASSED SUCCESSFULLY!');
  } finally {
    server.close();
  }
}

runLiveEventsTest().catch((err) => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
