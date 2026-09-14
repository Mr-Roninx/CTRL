import { app } from '../src/server.js';
import { DatabaseAdapter } from '../src/db/adapter.js';
import { Server } from 'node:http';

async function runTest() {
  console.log('🚀 Launching CTRL Control Plane in-memory server for verification...');
  
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(3099, () => {
      console.log('📡 Test Server listening on http://127.0.0.1:3099');
      resolve(s);
    });
  });

  const API_BASE = 'http://127.0.0.1:3099';

  try {
    // 1. Signup a new merchant
    const testEmail = `merchant_${Date.now()}@ctrltest.com`;
    const testPassword = 'Password123!';
    const businessName = 'Starlight Commerce';

    console.log(`\n1️⃣ Creating Merchant Account: ${testEmail}...`);
    const signupRes = await fetch(`${API_BASE}/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        business_name: businessName,
        password: testPassword,
      }),
    });

    if (!signupRes.ok) {
      throw new Error(`Signup failed: ${signupRes.status} ${await signupRes.text()}`);
    }

    const signupData = (await signupRes.json()) as any;
    const sessionToken = signupData.session.token;
    const tenantId = signupData.merchant.tenant_id;
    console.log(`✅ Merchant created! Tenant ID: ${tenantId}, Token: ${sessionToken.slice(0, 15)}...`);

    // 2. Fetch /v1/auth/me to verify tenant identity
    console.log('\n2️⃣ Verifying /v1/auth/me profile...');
    const meRes = await fetch(`${API_BASE}/v1/auth/me`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const meData = (await meRes.json()) as any;
    console.log(`✅ Auth profile verified: user=${meData.user.email}, tenant=${meData.tenant.id} (${meData.tenant.name})`);

    // 3. Create an API Key for the client website
    console.log('\n3️⃣ Creating API Key for Client Website...');
    const createKeyRes = await fetch(`${API_BASE}/v1/api-keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        name: 'Client E-Commerce Website Key',
        environment: 'test',
      }),
    });

    if (!createKeyRes.ok) {
      throw new Error(`Create API Key failed: ${createKeyRes.status} ${await createKeyRes.text()}`);
    }

    const keyData = (await createKeyRes.json()) as any;
    const rawApiKey = keyData.raw_key;
    const apiKeyId = keyData.key_id;
    const apiKeyDbId = keyData.id;
    console.log(`✅ API Key Generated! Key ID: ${apiKeyId}, Raw Key: ${rawApiKey.slice(0, 18)}...`);

    // 4. Verify API Key appears in list
    console.log('\n4️⃣ Listing API Keys for Merchant...');
    const listKeysRes = await fetch(`${API_BASE}/v1/api-keys`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const listKeysData = (await listKeysRes.json()) as any;
    console.log(`✅ API Keys listed: ${listKeysData.api_keys.length} key(s) found.`);
    if (listKeysData.api_keys.length === 0) {
      throw new Error('API Key list is empty!');
    }

    // 5. Ingest Failed Payment Event from Client Website via API Key
    console.log('\n5️⃣ Ingesting "Insufficient Balance" Payment Failure Event via API Key...');
    const paymentId = `pay_client_${Date.now()}`;
    const eventId = `evt_client_${Date.now()}`;

    const eventRes = await fetch(`${API_BASE}/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawApiKey}`,
      },
      body: JSON.stringify({
        event_id: eventId,
        source: 'ODOOX_EVENT',
        provider: 'razorpay',
        environment: 'test',
        payment_id: paymentId,
        order_id: `order_${Date.now()}`,
        amount_paise: 499900, // ₹4,999.00
        currency: 'INR',
        status: 'failed',
        failure_code: 'BAD_REQUEST_PAYMENT_FAILED',
        failure_description: 'Payment failed due to insufficient funds in customer bank account',
        failure_type: 'soft',
        attempt_number: 1,
        customer_reference: 'cust_vip_user_99',
        customer_email: 'customer99@gmail.com',
        customer_phone: '+919876543210',
        occurred_at: new Date().toISOString(),
        metadata: {
          checkout_page: '/cart/checkout',
          device: 'mobile',
        },
      }),
    });

    if (!eventRes.ok) {
      throw new Error(`Event ingestion failed: ${eventRes.status} ${await eventRes.text()}`);
    }

    const eventData = (await eventRes.json()) as any;
    console.log(`✅ Event ingested successfully! Opportunity ID: ${eventData.opportunity_id}, Status: ${eventData.status}, Decline Type: ${eventData.decline_type}`);

    // 6. Query Opportunities for the Merchant Dashboard
    console.log('\n6️⃣ Querying /opportunities for Merchant Dashboard...');
    const oppsRes = await fetch(`${API_BASE}/opportunities`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });

    if (!oppsRes.ok) {
      throw new Error(`Get opportunities failed: ${oppsRes.status} ${await oppsRes.text()}`);
    }

    const oppsData = (await oppsRes.json()) as any;
    console.log(`✅ Total opportunities visible to merchant: ${oppsData.count}`);
    const matchedOpp = oppsData.opportunities.find((o: any) => o.id === paymentId);

    if (!matchedOpp) {
      throw new Error(`❌ Ingested opportunity ${paymentId} was NOT found in merchant opportunities list!`);
    }

    console.log(`🎉 SUCCESS! Opportunity Found in Merchant Dashboard:`);
    console.log(`   - ID: ${matchedOpp.id}`);
    console.log(`   - Amount: ₹${matchedOpp.amount_paise / 100}`);
    console.log(`   - Decline Type: ${matchedOpp.decline_type}`);
    console.log(`   - Reason Code: ${matchedOpp.reason_code}`);
    console.log(`   - Status: ${matchedOpp.status}`);
    console.log(`   - Tenant ID: ${matchedOpp.tenant_id}`);

    // 7. Verify Dashboard Summary
    console.log('\n7️⃣ Querying /dashboard/summary for Merchant...');
    const dashRes = await fetch(`${API_BASE}/dashboard/summary`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const dashData = (await dashRes.json()) as any;
    console.log(`✅ Dashboard Summary: Total Opps=${dashData.total_opportunities}, At Risk=${dashData.total_at_risk_display}`);

    // 8. Test Revoking API Key
    console.log('\n8️⃣ Testing API Key Revocation...');
    const revokeRes = await fetch(`${API_BASE}/v1/api-keys/${apiKeyDbId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${sessionToken}` },
    });

    if (!revokeRes.ok) {
      throw new Error(`Revoke API Key failed: ${revokeRes.status} ${await revokeRes.text()}`);
    }
    console.log(`✅ API Key revoked successfully!`);

    console.log('\n🌟 ALL 8 VERIFICATION GATES PASSED CLEANLY! 🎯');
  } finally {
    server.close();
  }
}

runTest().catch((err) => {
  console.error('\n❌ VERIFICATION FAILED:', err.message);
  process.exit(1);
});
