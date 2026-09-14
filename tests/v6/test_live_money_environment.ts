import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseAdapter } from '../../src/db/adapter.js';
import {
  db,
  insertOpportunity,
  getAllOpportunities,
  getOpportunityById,
} from '../../src/db/database.js';
import { RecoveryOpportunity } from '../../src/types/index.js';
import { runMarketAllocation } from '../../src/market/allocator.js';
import { runAuthorityPipeline } from '../../src/authority/gate.js';
import { RazorpayClientPool } from '../../src/providers/razorpay/client_pool.js';
import { SecretsManager } from '../../src/security/secrets.js';

test('V6 Production: Real Money & Test Environment Strict Isolation', async (t) => {
  const adapter = DatabaseAdapter.getInstance();
  const testTenant = `tenant_env_iso_${Date.now()}`;
  const now = new Date().toISOString();

  // Seed test tenant
  await adapter.execute(
    `INSERT INTO tenants (id, name, slug, environment, status, capacity_limit, created_at)
     VALUES (?, 'Environment Isolation Tenant', ?, 'test', 'ACTIVE', 5, ?);`,
    [testTenant, `iso_${Date.now()}`, now]
  );

  await t.test('1. Opportunities are strictly partitioned by environment', () => {
    const oppLive: RecoveryOpportunity = {
      id: `opp_live_${Date.now()}`,
      source: 'real',
      amount_paise: 50000,
      currency: 'INR',
      reason_code: 'INSUFFICIENT_FUNDS',
      decline_type: 'soft',
      attempt_count: 1,
      customer_id: 'cust_iso_1',
      customer_trust_score: 0.9,
      created_at: now,
      status: 'pending',
      tenant_id: testTenant,
      environment: 'live',
    };

    const oppTest: RecoveryOpportunity = {
      id: `opp_test_${Date.now()}`,
      source: 'synthetic',
      amount_paise: 25000,
      currency: 'INR',
      reason_code: 'PAYMENT_CANCELLED',
      decline_type: 'soft',
      attempt_count: 1,
      customer_id: 'cust_iso_2',
      customer_trust_score: 0.85,
      created_at: now,
      status: 'pending',
      tenant_id: testTenant,
      environment: 'test',
    };

    insertOpportunity(oppLive);
    insertOpportunity(oppTest);

    const liveOnly = getAllOpportunities(testTenant, 'live');
    const testOnly = getAllOpportunities(testTenant, 'test');

    assert.ok(liveOnly.some((o) => o.id === oppLive.id), 'Live opportunities must contain oppLive');
    assert.ok(!liveOnly.some((o) => o.id === oppTest.id), 'Live opportunities must NOT contain oppTest');

    assert.ok(testOnly.some((o) => o.id === oppTest.id), 'Test opportunities must contain oppTest');
    assert.ok(!testOnly.some((o) => o.id === oppLive.id), 'Test opportunities must NOT contain oppLive');
  });

  await t.test('2. Market Allocation and Authority Gate strictly respect environment scope', () => {
    const allocLive = runMarketAllocation({ tenantId: testTenant, environment: 'live', capacity: 5 });
    assert.ok(
      allocLive.items.every((d) => {
        const opp = getOpportunityById(d.opportunity_id);
        return opp?.environment === 'live';
      }),
      'Market allocation in live mode must only allocate live opportunities'
    );

    const authLive = runAuthorityPipeline({ tenantId: testTenant, environment: 'live', capacity: 5 });
    assert.ok(
      authLive.results.every((r) => {
        const opp = getOpportunityById(r.opportunity_id);
        return opp?.environment === 'live';
      }),
      'Authority pipeline in live mode must only evaluate live opportunities'
    );
  });

  await t.test('3. Client pool fails closed when live credentials are missing and never leaks test keys', async () => {
    const isolatedLiveTenant = `tenant_no_live_creds_${Date.now()}`;
    await adapter.execute(
      `INSERT INTO tenants (id, name, slug, environment, status, capacity_limit, created_at)
       VALUES (?, 'No Live Creds Tenant', ?, 'live', 'ACTIVE', 5, ?);`,
      [isolatedLiveTenant, `no_live_${Date.now()}`, now]
    );

    // Should fail closed because tenant has no live credentials in tenant_credentials
    let threw = false;
    try {
      await RazorpayClientPool.getClient(isolatedLiveTenant, 'live');
    } catch (err: any) {
      threw = true;
      assert.match(err.message, /No Razorpay credentials found/i);
    }
    assert.ok(threw, 'Should throw error when live credentials do not exist for tenant');
  });

  await t.test('4. Client pool loads real live credentials when configured in tenant_credentials', async () => {
    const liveTenantWithKeys = `tenant_live_configured_${Date.now()}`;
    const liveCredRef = `ref_rzp_${liveTenantWithKeys}_live`;

    await SecretsManager.storeTenantCredential({
      tenantId: liveTenantWithKeys,
      provider: 'razorpay',
      environment: 'live',
      credentialReference: liveCredRef,
      rawSecret: JSON.stringify({
        key_id: 'rzp_live_test_mock_key_999',
        key_secret: 'mock_live_secret_888',
        webhook_secret: 'mock_whsec_777',
      }),
    });

    const client = await RazorpayClientPool.getClient(liveTenantWithKeys, 'live');
    assert.ok(client, 'Client should be successfully instantiated');
    assert.equal((client as any).key_id, 'rzp_live_test_mock_key_999', 'Client must use live key ID');
  });
});
