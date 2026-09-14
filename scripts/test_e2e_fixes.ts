import assert from 'node:assert';
import { app } from '../src/server.js';
import http from 'node:http';

async function main() {
  console.log('🧪 Starting CTRL End-to-End Verification Test...');
  
  let baseUrl = 'http://127.0.0.1:3001';
  let server: http.Server | null = null;

  try {
    const check = await fetch('http://127.0.0.1:3001/health').catch(() => null);
    if (!check) {
      server = http.createServer(app);
      await new Promise<void>((resolve) => server!.listen(3099, resolve));
      baseUrl = 'http://127.0.0.1:3099';
    }
  } catch {
    server = http.createServer(app);
    await new Promise<void>((resolve) => server!.listen(3099, resolve));
    baseUrl = 'http://127.0.0.1:3099';
  }

  try {
    // 1. Health check
    const healthRes = await fetch(`${baseUrl}/health`);
    const healthData = await healthRes.json();
    assert.strictEqual(healthRes.status, 200);
    assert.strictEqual(healthData.status, 'healthy');
    console.log('✅ 1. Health check PASSED');

    // 2. Signup merchant
    const uniqueEmail = `test_merchant_${Date.now()}@example.com`;
    const signupRes = await fetch(`${baseUrl}/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: uniqueEmail,
        business_name: 'Acme Test Corp',
        password: 'Password123!',
      }),
    });
    const signupData = await signupRes.json();
    assert.strictEqual(signupRes.status, 201);
    assert.ok(signupData.session?.token, 'Token must exist in signup response');
    const token = signupData.session.token;
    const tenantId = signupData.merchant.tenant_id;
    console.log('✅ 2. Merchant signup PASSED (Tenant:', tenantId, ')');

    // 3. Login merchant
    const loginRes = await fetch(`${baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: uniqueEmail,
        password: 'Password123!',
      }),
    });
    const loginData = await loginRes.json();
    assert.strictEqual(loginRes.status, 200);
    assert.ok(loginData.session?.token, 'Token must exist in login response');
    console.log('✅ 3. Merchant login PASSED');

    // 4. GET /v1/auth/me
    const meRes = await fetch(`${baseUrl}/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meData = await meRes.json();
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meData.authenticated, true);
    assert.strictEqual(meData.user.email, uniqueEmail);
    assert.strictEqual(meData.tenant.id, tenantId);
    console.log('✅ 4. Auth /me verification PASSED');

    // 5. Connect Razorpay account
    const connectRes = await fetch(`${baseUrl}/v1/integrations/razorpay/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        key_id: 'rzp_test_TVWDFQCezsOvv2',
        key_secret: 'urSW7Gal7I31iTwEXs0GF1Vs',
        webhook_secret: 'whsec_test_secret_123',
        environment: 'test',
      }),
    });
    const connectData = await connectRes.json();
    assert.strictEqual(connectRes.status, 201);
    assert.strictEqual(connectData.success, true);
    console.log('✅ 5. Razorpay Connect PASSED');

    // 6. List Integrations
    const listConnRes = await fetch(`${baseUrl}/v1/integrations/connections`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listConnData = await listConnRes.json();
    assert.strictEqual(listConnRes.status, 200);
    assert.ok(Array.isArray(listConnData.connections), 'Connections must be array');
    assert.ok(listConnData.connections.length > 0, 'Must have at least 1 connection');
    console.log('✅ 6. Integrations Listing & Capabilities PASSED');

    // 7. Create API Key
    const apiKeyRes = await fetch(`${baseUrl}/v1/api-keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: 'Backend Webhook Key',
        environment: 'test',
      }),
    });
    const apiKeyData = await apiKeyRes.json();
    assert.strictEqual(apiKeyRes.status, 201);
    assert.ok(apiKeyData.raw_key, 'raw_key must be returned');
    console.log('✅ 7. API Key creation PASSED');

    // 8. List API Keys
    const listKeysRes = await fetch(`${baseUrl}/v1/api-keys`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listKeysData = await listKeysRes.json();
    assert.strictEqual(listKeysRes.status, 200);
    assert.ok(Array.isArray(listKeysData.api_keys), 'api_keys must be array');
    assert.ok(Array.isArray(listKeysData.keys), 'keys alias must be array');
    assert.strictEqual(listKeysData.keys.length, 1);
    console.log('✅ 8. API Key listing PASSED');

    // 9. Fetch Team Members
    const teamRes = await fetch(`${baseUrl}/v1/auth/team`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const teamData = await teamRes.json();
    assert.strictEqual(teamRes.status, 200);
    assert.ok(Array.isArray(teamData.members), 'members must be array');
    assert.ok(teamData.members.length >= 1, 'Owner membership must be present');
    console.log('✅ 9. Team Members query PASSED');

    // 10. Dashboard summary
    const dashRes = await fetch(`${baseUrl}/dashboard/summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const dashData = await dashRes.json();
    assert.strictEqual(dashRes.status, 200);
    assert.ok(dashData.total_at_risk_display, 'total_at_risk_display must exist');
    console.log('✅ 10. Dashboard summary PASSED');

    console.log('\n🎉 ALL 10/10 END-TO-END VERIFICATION CHECKS PASSED PERFECTLY!\n');
  } finally {
    if (server) {
      server.close();
    }
  }
}

main().catch((err) => {
  console.error('❌ E2E Test Failed:', err);
  process.exit(1);
});
