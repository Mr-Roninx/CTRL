import dotenv from 'dotenv';
import path from 'node:path';
import http from 'node:http';
import { app } from '../src/server.js';
import { ApiKeyService } from '../src/security/api_keys.js';
import { DatabaseAdapter } from '../src/db/adapter.js';
import { initDatabase, getOpportunityById } from '../src/db/database.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
initDatabase();

async function runReasonAwareRecoveryTests() {
  console.log('🧠 ==========================================================');
  console.log('🧠 CTRL: LLM Reason-Aware Recovery & Staged Hold Acceptance Test');
  console.log('🧠 ==========================================================\n');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  try {
    const testTenantId = `tnt_reason_${Date.now()}`;
    const db = DatabaseAdapter.getInstance();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, environment, status, created_at)
       VALUES (?, ?, ?, 'test', 'ACTIVE', ?);`,
      [testTenantId, 'Reason Recovery Merchant', `slug_${testTenantId}`, now]
    );

    console.log('Step 1: Generating merchant API key with events:write and events:read scopes...');
    const keyResult = await ApiKeyService.createApiKey({
      tenantId: testTenantId,
      name: 'Reason Recovery Test Key',
      environment: 'test',
      scopes: ['events:write', 'events:read'],
    });
    const apiKey = keyResult.rawKey;
    console.log(`🔑 Key created for tenant: ${testTenantId}`);

    // -------------------------------------------------------------
    // Scenario 1: Bank Network Latency (Soft Decline -> Authorized & Released)
    // -------------------------------------------------------------
    console.log('\n-------------------------------------------------------------');
    console.log('🧪 Scenario 1: Bank Network Latency / Gateway Timeout');
    console.log('-------------------------------------------------------------');
    const netEventId = `evt_net_${Date.now()}`;
    const netPayId = `pay_net_${Date.now()}`;

    const res1 = await fetch(`${baseUrl}/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Origin': 'https://checkout.mystore.com',
      },
      body: JSON.stringify({
        event_id: netEventId,
        source: 'CLIENT_SDK',
        provider: 'razorpay',
        environment: 'test',
        payment_id: netPayId,
        order_id: 'order_net_01',
        amount_paise: 249900, // ₹2,499.00
        currency: 'INR',
        status: 'failed',
        failure_code: 'GATEWAY_TIMEOUT',
        failure_description: 'NPCI switch timeout during UPI transaction (npci_u30)',
        customer_reference: 'cust_priya_sharma',
        customer_email: 'priya.sharma@example.com',
        customer_phone: '+919876543210',
        metadata: {
          customer_name: 'Priya Sharma',
          store: 'Aura Lifestyle',
          url: 'https://checkout.mystore.com/order/net01',
        },
      }),
    });

    const json1 = await res1.json();
    console.log('📥 Scenario 1 Ingestion Response:', JSON.stringify(json1, null, 2));

    if (res1.status !== 201) {
      throw new Error(`Expected HTTP 201, got ${res1.status}: ${JSON.stringify(json1)}`);
    }

    if (json1.held_stage !== 'RELEASED') {
      throw new Error(`Expected held_stage: 'RELEASED', got '${json1.held_stage}'`);
    }
    if (json1.authority_verdict !== 'AUTHORIZED') {
      throw new Error(`Expected authority_verdict: 'AUTHORIZED', got '${json1.authority_verdict}'`);
    }
    if (!json1.reason_analysis || json1.reason_analysis.category !== 'NETWORK_LATENCY') {
      throw new Error(`Expected reason category 'NETWORK_LATENCY', got '${json1.reason_analysis?.category}'`);
    }
    if (!json1.payment_link_url || !json1.payment_link_url.startsWith('http')) {
      throw new Error(`Expected valid payment link URL, got '${json1.payment_link_url}'`);
    }
    if (!json1.tailored_message || (!json1.tailored_message.toLowerCase().includes('timeout') && !json1.tailored_message.toLowerCase().includes('bank'))) {
      throw new Error(`Expected tailored message addressing bank timeout/network, got: ${json1.tailored_message}`);
    }

    console.log(`✅ Scenario 1 Passed:`);
    console.log(`   - Diagnosed Reason: [${json1.reason_analysis.category}] ${json1.reason_analysis.customer_friendly_explanation}`);
    console.log(`   - Authority Verdict: ${json1.authority_verdict}`);
    console.log(`   - Staged Hold: Released (Link: ${json1.payment_link_url})`);
    console.log(`   - Reason-Tailored Message: "${json1.tailored_message.slice(0, 85)}..."`);

    // -------------------------------------------------------------
    // Scenario 2: Insufficient Funds (Soft Decline -> Alternate Method Guidance)
    // -------------------------------------------------------------
    console.log('\n-------------------------------------------------------------');
    console.log('🧪 Scenario 2: Insufficient Funds / Balance Issue');
    console.log('-------------------------------------------------------------');
    const fundsEventId = `evt_funds_${Date.now()}`;
    const fundsPayId = `pay_funds_${Date.now()}`;

    const res2 = await fetch(`${baseUrl}/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Origin': 'https://checkout.mystore.com',
      },
      body: JSON.stringify({
        event_id: fundsEventId,
        source: 'CLIENT_SDK',
        provider: 'razorpay',
        environment: 'test',
        payment_id: fundsPayId,
        order_id: 'order_funds_02',
        amount_paise: 500000, // ₹5,000.00
        currency: 'INR',
        status: 'failed',
        failure_code: 'BAD_REQUEST_PAYMENT_FAILED',
        failure_description: 'Account balance insufficient for authorization',
        customer_reference: 'cust_rahul_verma',
        customer_email: 'rahul.verma@example.com',
        customer_phone: '+919811223344',
        metadata: {
          customer_name: 'Rahul Verma',
          store: 'TechMart India',
          url: 'https://checkout.mystore.com/order/funds02',
        },
      }),
    });

    const json2 = await res2.json();
    console.log('📥 Scenario 2 Ingestion Response:', JSON.stringify(json2, null, 2));

    if (res2.status !== 201) {
      throw new Error(`Expected HTTP 201, got ${res2.status}: ${JSON.stringify(json2)}`);
    }

    if (json2.held_stage !== 'RELEASED') {
      throw new Error(`Expected held_stage: 'RELEASED', got '${json2.held_stage}'`);
    }
    if (json2.authority_verdict !== 'AUTHORIZED') {
      throw new Error(`Expected authority_verdict: 'AUTHORIZED', got '${json2.authority_verdict}'`);
    }
    if (!json2.reason_analysis || json2.reason_analysis.category !== 'INSUFFICIENT_FUNDS') {
      throw new Error(`Expected reason category 'INSUFFICIENT_FUNDS', got '${json2.reason_analysis?.category}'`);
    }
    if (!json2.tailored_message || !json2.tailored_message.toLowerCase().includes('balance')) {
      throw new Error(`Expected tailored copy mentioning balance/card, got: ${json2.tailored_message}`);
    }

    console.log(`✅ Scenario 2 Passed:`);
    console.log(`   - Diagnosed Reason: [${json2.reason_analysis.category}] ${json2.reason_analysis.customer_friendly_explanation}`);
    console.log(`   - Authority Verdict: ${json2.authority_verdict}`);
    console.log(`   - Staged Hold: Released`);
    console.log(`   - Reason-Tailored Message: "${json2.tailored_message.slice(0, 85)}..."`);

    // -------------------------------------------------------------
    // Scenario 3: Stolen Card / Security Hard Decline (Authority Blocked)
    // -------------------------------------------------------------
    console.log('\n-------------------------------------------------------------');
    console.log('🧪 Scenario 3: Stolen Card / Hard Decline (Safety Shield Blocks Execution)');
    console.log('-------------------------------------------------------------');
    const stolenEventId = `evt_stolen_${Date.now()}`;
    const stolenPayId = `pay_stolen_${Date.now()}`;

    const res3 = await fetch(`${baseUrl}/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Origin': 'https://checkout.mystore.com',
      },
      body: JSON.stringify({
        event_id: stolenEventId,
        source: 'CLIENT_SDK',
        provider: 'razorpay',
        environment: 'test',
        payment_id: stolenPayId,
        order_id: 'order_stolen_03',
        amount_paise: 990000, // ₹9,900.00
        currency: 'INR',
        status: 'failed',
        failure_code: 'stolen_card',
        failure_description: 'Card flagged lost or stolen by issuing bank',
        customer_reference: 'cust_fraud_suspect',
        customer_email: 'unknown@example.com',
        customer_phone: '+919999999999',
        metadata: {
          customer_name: 'Anonymous',
          store: 'Luxury Watches',
        },
      }),
    });

    const json3 = await res3.json();
    console.log('📥 Scenario 3 Ingestion Response:', JSON.stringify(json3, null, 2));

    if (res3.status !== 201) {
      throw new Error(`Expected HTTP 201, got ${res3.status}: ${JSON.stringify(json3)}`);
    }

    if (json3.held_stage !== 'HELD') {
      throw new Error(`Expected held_stage: 'HELD', got '${json3.held_stage}'`);
    }
    if (json3.authority_verdict !== 'BLOCKED') {
      throw new Error(`Expected authority_verdict: 'BLOCKED', got '${json3.authority_verdict}'`);
    }
    if (!json3.reason_analysis || json3.reason_analysis.category !== 'SECURITY_STOP') {
      throw new Error(`Expected reason category 'SECURITY_STOP', got '${json3.reason_analysis?.category}'`);
    }
    if (json3.payment_link_url !== null) {
      throw new Error(`Expected payment_link_url: null for blocked hard decline, got '${json3.payment_link_url}'`);
    }

    console.log(`✅ Scenario 3 Passed:`);
    console.log(`   - Diagnosed Reason: [${json3.reason_analysis.category}] ${json3.reason_analysis.customer_friendly_explanation}`);
    console.log(`   - Action Authority: ${json3.authority_verdict} (${json3.authority_reason})`);
    console.log(`   - Staged Hold: Remains HELD (0 Links generated, 100% compliance preserved)`);

    // -------------------------------------------------------------
    // Scenario 4: Opportunity Lookup Endpoint Enriched Verification
    // -------------------------------------------------------------
    console.log('\n-------------------------------------------------------------');
    console.log('🧪 Scenario 4: Query Opportunity Detail via GET /v1/events/opportunity/:id');
    console.log('-------------------------------------------------------------');
    const getRes = await fetch(`${baseUrl}/v1/events/opportunity/${json1.opportunity_id}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });
    const getJson = await getRes.json();
    console.log('📥 Scenario 4 Opportunity Details:', JSON.stringify(getJson, null, 2));

    if (getRes.status !== 200 || !getJson.opportunity_id) {
      throw new Error(`Failed to fetch opportunity: ${JSON.stringify(getJson)}`);
    }
    if (!getJson.reason_analysis || !getJson.reason_analysis.semantic_notes?.includes('NETWORK_LATENCY')) {
      throw new Error(`Opportunity lookup missing correct reason_analysis: ${JSON.stringify(getJson.reason_analysis)}`);
    }
    if (!getJson.tailored_message) {
      throw new Error(`Opportunity lookup missing tailored_message`);
    }

    console.log(`✅ Scenario 4 Passed: GET /v1/events/opportunity/:id provides complete reason analysis & outreach copy.`);

    // -------------------------------------------------------------
    // Scenario 5: Durable DB Audit Trail Verification
    // -------------------------------------------------------------
    console.log('\n-------------------------------------------------------------');
    console.log('🧪 Scenario 5: Verifying Durable DB Audit Trail');
    console.log('-------------------------------------------------------------');
    const annotations = await db.query(
      `SELECT * FROM perception_annotations WHERE opportunity_id = ?`,
      [json1.opportunity_id]
    );
    if (!annotations || annotations.length === 0) {
      throw new Error(`No perception_annotations found in DB for ${json1.opportunity_id}`);
    }
    console.log(`✅ DB Verification Passed: Found ${annotations.length} perception annotation record(s).`);

    const drafts = await db.query(
      `SELECT * FROM outreach_drafts WHERE opportunity_id = ?`,
      [json1.opportunity_id]
    );
    if (!drafts || drafts.length === 0) {
      throw new Error(`No outreach_drafts found in DB for ${json1.opportunity_id}`);
    }
    console.log(`✅ DB Verification Passed: Found ${drafts.length} outreach draft record(s).`);

    console.log('\n==========================================================');
    console.log('🎉 ALL REASON-AWARE RECOVERY ACCEPTANCE TESTS PASSED (5/5)!');
    console.log('==========================================================\n');
  } finally {
    server.close();
    process.exit(0);
  }
}

runReasonAwareRecoveryTests().catch((err) => {
  console.error('❌ Acceptance test failed with error:', err);
  process.exit(1);
});
