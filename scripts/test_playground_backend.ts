import { app } from '../src/server.js';
import { initDatabase, db, insertOpportunity } from '../src/db/database.js';
import { ApiKeyService } from '../src/security/api_keys.js';
import http from 'node:http';

async function testPlaygroundBackendSuite() {
  console.log('🧪 Starting Razorpay Recovery Playground & Visualizer Backend Test Suite...\n');

  initDatabase();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  try {
    const testTenantId = `tnt_pg_test_${Date.now()}`;

    // 1. Create Tenant and API Key
    const insertTenant = db.prepare(`
      INSERT INTO tenants (id, name, slug, environment, status, created_at)
      VALUES (?, ?, ?, 'test', 'ACTIVE', ?)
    `);
    insertTenant.run(testTenantId, 'Playground Store', `pg-store-${Date.now()}`, new Date().toISOString());

    const keyResult = await ApiKeyService.createApiKey({
      tenantId: testTenantId,
      name: 'Playground Test Key',
      environment: 'test',
      scopes: ['events:read', 'events:write'],
    });
    const apiKey = keyResult.rawKey;

    // 2. Test GET /v1/playground/config
    console.log('Test 1: Querying Playground Configuration...');
    const configRes = await fetch(`${baseUrl}/v1/playground/config`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    const configJson = await configRes.json();

    if (configRes.status !== 200 || !configJson.success) {
      throw new Error(`Failed to fetch playground config: ${JSON.stringify(configJson)}`);
    }
    console.log(`✅ Test 1 Passed: Config loaded (environment: ${configJson.environment}, is_live: ${configJson.is_live})`);

    // 3. Test POST /v1/playground/simulate-scenario (Soft Decline -> Recovery Link Generation)
    console.log('\nTest 2: Simulating Soft Decline Scenario (Insufficient Funds)...');
    const softRes = await fetch(`${baseUrl}/v1/playground/simulate-scenario`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        scenario: 'soft_insufficient_funds',
        amount_paise: 75000, // ₹750.00
        customer_name: 'Priya Sharma',
        customer_email: 'priya.sharma@example.com',
        customer_contact: '+919876543210',
      }),
    });
    const softJson = await softRes.json();

    if (softRes.status !== 200 || !softJson.success || softJson.stages.length !== 7) {
      throw new Error(`Soft decline simulation failed: ${JSON.stringify(softJson)}`);
    }

    if (softJson.final_verdict !== 'AUTHORIZED') {
      throw new Error(`Expected AUTHORIZED final verdict, got: ${softJson.final_verdict}`);
    }

    const stage3 = softJson.stages.find((s: any) => s.stage_number === 3);
    const stage5 = softJson.stages.find((s: any) => s.stage_number === 5);

    console.log(`✅ Test 2 Passed: 7 stages generated (IVEN: ${stage3?.data?.iven_display}, Verdict: ${stage5?.data?.verdict})`);

    // 4. Test POST /v1/playground/simulate-scenario (Hard Decline -> Stolen Card Veto)
    console.log('\nTest 3: Simulating Hard Decline Scenario (Card Stolen Veto)...');
    const hardRes = await fetch(`${baseUrl}/v1/playground/simulate-scenario`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        scenario: 'hard_stolen_card',
        amount_paise: 120000,
      }),
    });
    const hardJson = await hardRes.json();

    if (hardRes.status !== 200 || hardJson.final_verdict !== 'BLOCKED') {
      throw new Error(`Expected BLOCKED verdict for hard decline, got: ${JSON.stringify(hardJson)}`);
    }

    const hardStage5 = hardJson.stages.find((s: any) => s.stage_number === 5);
    const hardStage6 = hardJson.stages.find((s: any) => s.stage_number === 6);

    if (hardStage5?.status !== 'BLOCKED' || hardStage6?.status !== 'SKIPPED') {
      throw new Error(`Expected Stage 5 BLOCKED and Stage 6 SKIPPED, got: Stage 5 ${hardStage5?.status}, Stage 6 ${hardStage6?.status}`);
    }
    console.log(`✅ Test 3 Passed: Action Authority strictly vetoed stolen card execution`);

    // 5. Test POST /v1/playground/reconcile-link
    console.log('\nTest 4: Simulating Payment Settlement Reconciliation...');
    const recRes = await fetch(`${baseUrl}/v1/playground/reconcile-link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        opportunity_id: softJson.opportunity_id,
      }),
    });
    const recJson = await recRes.json();

    if (recRes.status !== 200 || !recJson.success || recJson.status !== 'recovered') {
      throw new Error(`Reconciliation simulation failed: ${JSON.stringify(recJson)}`);
    }
    console.log(`✅ Test 4 Passed: Opportunity ${recJson.opportunity_id} settled and appended to ledger (${recJson.amount_recovered_display})`);

    console.log('\n🎉 ALL RECOVERY PLAYGROUND & VISUALIZER BACKEND TESTS PASSED CLEANLY!');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

testPlaygroundBackendSuite().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
