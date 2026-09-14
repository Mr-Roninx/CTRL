import { app } from '../src/server.js';
import { initDatabase, db, getOpportunityById, getEventIngestionLogs } from '../src/db/database.js';
import { MigrationRunner } from '../src/db/migrations/runner.js';
import { ApiKeyService } from '../src/security/api_keys.js';
import http from 'node:http';

async function runWizardBackendTest() {
  console.log('🧪 Starting One-Click Integration Wizard Backend Test...\n');

  // 1. Initialize DB
  initDatabase();
  await MigrationRunner.migrateUp();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  try {
    const testTenantId = `tnt_wiz_${Date.now()}`;
    const insertTenantStmt = db.prepare(`
      INSERT INTO tenants (id, name, slug, environment, status, created_at)
      VALUES (?, ?, ?, 'test', 'ACTIVE', ?)
    `);
    insertTenantStmt.run(
      testTenantId,
      'Wizard Test Storefront',
      `wiz-test-${Date.now()}`,
      new Date().toISOString()
    );

    // 2. Generate initial setup API key
    const keyResult = await ApiKeyService.createApiKey({
      tenantId: testTenantId,
      name: 'Wizard Setup Key',
      environment: 'test',
      scopes: ['events:write', 'events:read', 'integrations:write', 'integrations:read'],
    });
    const apiKey = keyResult.rawKey;

    console.log(`✅ Tenant & API Key created: ${testTenantId}`);

    // Test 1: POST /v1/events/test (Synthetic verification test event)
    console.log('\nTest 1: Dispatching synthetic test event via POST /v1/events/test...');
    const testRes = await fetch(`${baseUrl}/v1/events/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        amount_paise: 75000, // ₹750
        failure_code: 'INSUFFICIENT_FUNDS',
        failure_description: 'Wizard Test Simulation',
        customer_email: 'wizard_customer@example.com',
      }),
    });

    const testJson = await testRes.json();
    if (testRes.status !== 201 || !testJson.opportunity_id) {
      throw new Error(`Expected 201 from /v1/events/test, got ${testRes.status}: ${JSON.stringify(testJson)}`);
    }

    console.log(`✅ Test 1 Passed: Synthetic opportunity created: ${testJson.opportunity_id} (₹750.00, status: ${testJson.status})`);

    // Verify DB opportunity & stream record
    const opp = getOpportunityById(testJson.opportunity_id);
    if (!opp) throw new Error('Opportunity was not persisted to SQLite database');
    console.log(`✅ Opportunity verified in DB: source=${opp.source}, decline_type=${opp.decline_type}`);

    const streamLogs = getEventIngestionLogs({ tenantId: testTenantId });
    if (streamLogs.length === 0 || streamLogs[0].status !== 'ACCEPTED') {
      throw new Error('Event was not recorded in event_ingestion_logs');
    }
    console.log(`✅ Ingestion log verified: status=${streamLogs[0].status}, source=${streamLogs[0].source}`);

    // Test 2: Credential Registration via /v1/integrations
    console.log('\nTest 2: Registering Razorpay credentials via POST /v1/integrations...');
    const credRes = await fetch(`${baseUrl}/v1/integrations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        provider: 'razorpay',
        environment: 'test',
        key_id: 'rzp_test_mock_12345',
        key_secret: 'mock_secret_abcdef',
        webhook_secret: 'whsec_mock_9999',
      }),
    });

    const credJson = await credRes.json();
    if (credRes.status !== 201 || !credJson.connection_id) {
      throw new Error(`Expected 201 from /v1/integrations, got ${credRes.status}: ${JSON.stringify(credJson)}`);
    }
    console.log(`✅ Test 2 Passed: Razorpay credentials registered with connection_id: ${credJson.connection_id}`);

    // Test 3: List connections via GET /v1/integrations/connections
    const connRes = await fetch(`${baseUrl}/v1/integrations/connections`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const connJson = await connRes.json();
    if (connRes.status !== 200 || !Array.isArray(connJson.connections)) {
      throw new Error(`Expected 200 from /v1/integrations/connections, got ${connRes.status}: ${JSON.stringify(connJson)}`);
    }
    console.log(`✅ Test 3 Passed: Verified ${connJson.connections.length} active connection records for tenant`);

    console.log('\n🎉 ALL ONE-CLICK INTEGRATION WIZARD TESTS PASSED SUCCESSFULLY!');
  } finally {
    server.close();
  }
}

runWizardBackendTest().catch((err) => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
