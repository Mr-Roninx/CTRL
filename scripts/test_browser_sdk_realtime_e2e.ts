import { app } from '../src/server.js';
import { ApiKeyService } from '../src/security/api_keys.js';
import { getWebAppConnections, getAllOpportunities } from '../src/db/database.js';
import http from 'node:http';

async function runBrowserSdkE2E() {
  console.log('🚀 Starting Full Browser SDK & Real-Time Connection E2E Simulation...\n');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  try {
    const testTenantId = `tnt_browser_${Date.now()}`;
    const db = (await import('../src/db/adapter.js')).DatabaseAdapter.getInstance();
    const now = new Date().toISOString();
    await db.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, environment, status, created_at)
       VALUES (?, ?, ?, 'test', 'ACTIVE', ?);`,
      [testTenantId, 'Test Merchant', `slug_${testTenantId}`, now]
    );


    // 1. Generate an API Key for this merchant tenant
    console.log('Step 1: Generating merchant API key with events:write scope...');
    const keyResult = await ApiKeyService.createApiKey({
      tenantId: testTenantId,
      name: 'Client Checkout SDK Key',
      environment: 'test',
      scopes: ['events:write', 'events:read', 'integrations:read'],
    });
    const apiKey = keyResult.rawKey;
    console.log(`🔑 Generated API key: ${apiKey.slice(0, 15)}... for tenant: ${testTenantId}`);



    // 2. Simulate ctrl.js loading on external store and sending handshake ping
    console.log('\nStep 2: Simulating ctrl.js client connection handshake ping...');
    const pingRes = await fetch(`${baseUrl}/v1/events/ping`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Origin': 'https://mystore.example.com',
      },
      body: JSON.stringify({
        app_origin: 'https://mystore.example.com',
        app_url: 'https://mystore.example.com/checkout?order_id=ord_999',
        app_name: 'Example Production Storefront',
        sdk_version: '6.1.0',
        user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0',
      }),
    });

    const pingJson = await pingRes.json();
    console.log('📡 Handshake Response:', pingJson);
    if (!pingRes.ok || !pingJson.connected) {
      throw new Error(`Ping failed: ${JSON.stringify(pingJson)}`);
    }
    console.log('✅ Handshake verified: Web application registered as ONLINE.');

    // 3. Verify Integrations Endpoint lists this web app as ONLINE
    console.log('\nStep 3: Checking /v1/integrations/web-apps endpoint...');
    const webAppsRes = await fetch(`${baseUrl}/v1/integrations/web-apps`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });
    const webAppsJson = await webAppsRes.json();
    console.log('🌐 Connected Web Apps list:', webAppsJson);
    if (!webAppsRes.ok || webAppsJson.active_count !== 1) {
      throw new Error(`Expected 1 active web app, got ${JSON.stringify(webAppsJson)}`);
    }
    console.log('✅ Connected Web Apps check passed: 1 active app confirmed.');

    // 4. Simulate payment failure event from Razorpay on the client checkout page
    console.log('\nStep 4: Simulating client checkout payment failure event...');
    const failRes = await fetch(`${baseUrl}/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Origin': 'https://mystore.example.com',
      },
      body: JSON.stringify({
        event_id: `evt_client_fail_${Date.now()}`,
        source: 'CLIENT_SDK',
        provider: 'razorpay',
        environment: 'test',
        payment_id: `pay_sdk_${Date.now()}`,
        order_id: 'order_12345678',
        amount_paise: 75000, // ₹750.00
        currency: 'INR',
        status: 'failed',
        failure_code: 'BAD_REQUEST_PAYMENT_FAILED',
        failure_description: 'Issuer bank declined payment: insufficient funds',
        customer_reference: 'cust_vip_user_42',
        customer_email: 'vip_user@example.com',
        customer_phone: '+919876543210',
        metadata: {
          url: 'https://mystore.example.com/checkout',
          title: 'Checkout - Example Store',
        },
      }),
    });

    const failJson = await failRes.json();
    console.log('📥 Failure Ingestion Response:', failJson);
    if (failRes.status !== 201 || !failJson.opportunity_id) {
      throw new Error(`Failure event ingestion failed: ${JSON.stringify(failJson)}`);
    }
    console.log(`✅ Opportunity successfully created in database: ${failJson.opportunity_id}`);

    // 5. Query tenant opportunities
    console.log('\nStep 5: Verifying opportunity in tenant scope...');
    const tenantOpps = getAllOpportunities(testTenantId);
    const createdOpp = tenantOpps.find((o) => o.id === failJson.opportunity_id);
    if (!createdOpp) {
      throw new Error(`Opportunity ${failJson.opportunity_id} not found in tenant opportunities list.`);
    }
    console.log(`✅ Tenant opportunity found: ₹${createdOpp.amount_paise / 100} (${createdOpp.decline_type} decline) with status: ${createdOpp.status}`);

    // 6. Test SDK Script Route
    console.log('\nStep 6: Verifying /sdk/ctrl.js script endpoint...');
    const sdkRes = await fetch(`${baseUrl}/sdk/ctrl.js`);
    const sdkText = await sdkRes.text();
    if (!sdkRes.ok || !sdkText.includes('Autonomous Payment Recovery')) {
      throw new Error('SDK script could not be fetched or is corrupted.');
    }
    console.log(`✅ /sdk/ctrl.js served successfully (${sdkText.length} bytes).`);

    console.log('\n🎉 ALL REAL-TIME BROWSER SDK & CONNECTION TESTS PASSED 100%!');
  } finally {
    server.close();
  }
}

runBrowserSdkE2E().catch((err) => {
  console.error('❌ E2E Simulation Failed:', err);
  process.exit(1);
});
