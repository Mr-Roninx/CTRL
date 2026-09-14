import { resolveTenantId, assertTenantAccess, tenantGuard } from '../../src/security/tenant_guard.js';
import { DatabaseAdapter } from '../../src/db/adapter.js';
import {
  initDatabase,
  insertOpportunity,
  getOpportunityById,
  getAllOpportunities,
  getOrCreateCustomer,
  getCustomerById,
  countPriorAttempts,
} from '../../src/db/database.js';
import { runMarketAllocation } from '../../src/market/allocator.js';

async function runTenantIsolationTests() {
  console.log('🧪 Running Phase 6 Multi-Tenant Row-Level Isolation Test Suite...\n');
  initDatabase();
  const db = DatabaseAdapter.getInstance();

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      failed++;
    }
  }

  // Ensure test tenants exist in DB
  const tenantAlpha = 'tnt_alpha_' + Date.now();
  const tenantBeta = 'tnt_beta_' + Date.now();

  await db.execute(
    `INSERT OR IGNORE INTO tenants (id, name, status, capacity_limit, environment, created_at)
     VALUES (?, ?, 'ACTIVE', 5, 'test', ?), (?, ?, 'ACTIVE', 5, 'test', ?);`,
    [tenantAlpha, 'Alpha Merchant Inc', new Date().toISOString(), tenantBeta, 'Beta Retailers Ltd', new Date().toISOString()]
  );

  // 1. Tenant Identity Resolution Test
  console.log('--- Test 1: Unified Tenant Identity Resolution ---');
  const reqContext = { tenantContext: { tenantId: 'tnt_ctx_1' } } as any;
  assert(resolveTenantId(reqContext) === 'tnt_ctx_1', 'Resolves tenantId from tenantContext');

  const reqUser = { user: { tenant_id: 'tnt_user_1' } } as any;
  assert(resolveTenantId(reqUser) === 'tnt_user_1', 'Resolves tenantId from user.tenant_id');

  const reqApiKey = { apiKey: { tenantId: 'tnt_key_1' } } as any;
  assert(resolveTenantId(reqApiKey) === 'tnt_key_1', 'Resolves tenantId from apiKey.tenantId');

  const reqHeader = { headers: { 'x-tenant-id': 'tnt_hdr_1' } } as any;
  assert(resolveTenantId(reqHeader) === 'tnt_hdr_1', 'Resolves tenantId from x-tenant-id header');

  const reqEmpty = { headers: {} } as any;
  assert(resolveTenantId(reqEmpty, true) === 'tenant_system_default', 'Falls back to tenant_system_default when allowed');

  // 2. Cross-Tenant Access Boundary Verification
  console.log('\n--- Test 2: Cross-Tenant Access Assertions ---');
  let crossAccessBlocked = false;
  try {
    assertTenantAccess(tenantAlpha, tenantBeta, 'PaymentOpportunity');
  } catch (err: any) {
    if (err.message.includes('Tenant Isolation Violation')) {
      crossAccessBlocked = true;
    }
  }
  assert(crossAccessBlocked, 'Cross-tenant access between Alpha and Beta is strictly blocked');

  let selfAccessAllowed = false;
  try {
    assertTenantAccess(tenantAlpha, tenantAlpha, 'PaymentOpportunity');
    selfAccessAllowed = true;
  } catch {}
  assert(selfAccessAllowed, 'Tenant accessing their own resources is permitted');

  let adminBypassAllowed = false;
  try {
    assertTenantAccess('tenant_system_default', tenantAlpha, 'PaymentOpportunity');
    adminBypassAllowed = true;
  } catch {}
  assert(adminBypassAllowed, 'System admin tenant bypass is permitted for multi-tenant orchestration');

  // 3. Database Row-Level Isolation (Zero Leakage)
  console.log('\n--- Test 3: Database Row-Level Isolation (Zero Leakage) ---');
  const oppAlphaId = `opp_iso_alpha_${Date.now()}`;
  const oppBetaId = `opp_iso_beta_${Date.now()}`;
  const custAlphaId = `cust_alpha_${Date.now()}`;
  const custBetaId = `cust_beta_${Date.now()}`;

  // Seed customers
  getOrCreateCustomer(custAlphaId, 0.85, tenantAlpha);
  getOrCreateCustomer(custBetaId, 0.70, tenantBeta);

  // Seed opportunities
  insertOpportunity({
    id: oppAlphaId,
    tenant_id: tenantAlpha,
    source: 'synthetic',
    amount_paise: 250000,
    currency: 'INR',
    reason_code: 'BANK_TIMEOUT',
    decline_type: 'soft',
    attempt_count: 1,
    customer_id: custAlphaId,
    customer_trust_score: 0.85,
    created_at: new Date().toISOString(),
    status: 'pending',
  });

  insertOpportunity({
    id: oppBetaId,
    tenant_id: tenantBeta,
    source: 'synthetic',
    amount_paise: 890000,
    currency: 'INR',
    reason_code: 'INSUFFICIENT_FUNDS',
    decline_type: 'soft',
    attempt_count: 1,
    customer_id: custBetaId,
    customer_trust_score: 0.70,
    created_at: new Date().toISOString(),
    status: 'pending',
  });

  // Verify Alpha can read Alpha
  const readAlphaByAlpha = getOpportunityById(oppAlphaId, tenantAlpha);
  assert(readAlphaByAlpha?.id === oppAlphaId, 'Tenant Alpha can read their own opportunity');

  // Verify Beta CANNOT read Alpha (Zero Leakage)
  const readAlphaByBeta = getOpportunityById(oppAlphaId, tenantBeta);
  assert(readAlphaByBeta === undefined, 'Tenant Beta CANNOT read Alpha opportunity (returns undefined)');

  // Verify Alpha CANNOT read Beta (Zero Leakage)
  const readBetaByAlpha = getOpportunityById(oppBetaId, tenantAlpha);
  assert(readBetaByAlpha === undefined, 'Tenant Alpha CANNOT read Beta opportunity (returns undefined)');

  // Verify List Query Isolation
  const alphaOppsList = getAllOpportunities(tenantAlpha);
  assert(
    alphaOppsList.some((o) => o.id === oppAlphaId) && !alphaOppsList.some((o) => o.id === oppBetaId),
    'getAllOpportunities(tenantAlpha) returns only Alpha opportunities with zero Beta leakage'
  );

  const betaOppsList = getAllOpportunities(tenantBeta);
  assert(
    betaOppsList.some((o) => o.id === oppBetaId) && !betaOppsList.some((o) => o.id === oppAlphaId),
    'getAllOpportunities(tenantBeta) returns only Beta opportunities with zero Alpha leakage'
  );

  // Verify Customer Isolation
  const readCustAlphaByBeta = getCustomerById(custAlphaId, tenantBeta);
  assert(readCustAlphaByBeta === undefined, 'Tenant Beta CANNOT access Tenant Alpha customer');

  const priorAttemptsAlphaByBeta = countPriorAttempts(custAlphaId, undefined, tenantBeta);
  assert(priorAttemptsAlphaByBeta === 0, 'Prior attempts count for Alpha customer scoped to Beta returns 0');

  // 4. Market Allocation Tenant Boundary Isolation
  console.log('\n--- Test 4: Market Allocation Tenant Isolation ---');
  const marketResultAlpha = runMarketAllocation({ capacity: 5, tenantId: tenantAlpha });
  const hasBetaInAlphaRun = marketResultAlpha.items.some((item) => item.opportunity_id === oppBetaId);
  const hasAlphaInAlphaRun = marketResultAlpha.items.some((item) => item.opportunity_id === oppAlphaId);
  assert(!hasBetaInAlphaRun, 'Alpha market allocation run contains zero Beta opportunities');
  assert(hasAlphaInAlphaRun, 'Alpha market allocation run correctly includes Alpha opportunity');

  // 5. Tenant Guard Middleware Verification
  console.log('\n--- Test 5: Tenant Guard Middleware RLS Binding ---');
  const middleware = tenantGuard({ allowSystemDefault: false });
  let nextCalled = false;
  const mockReq = {
    headers: { 'x-tenant-id': tenantAlpha },
  } as any;
  const mockRes = {
    status: () => mockRes,
    json: () => mockRes,
  } as any;

  await middleware(mockReq, mockRes, () => {
    nextCalled = true;
  });

  assert(nextCalled, 'tenantGuard middleware calls next() on valid tenant header');
  assert(mockReq.tenantContext?.tenantId === tenantAlpha, 'tenantGuard attaches verified tenantId to tenantContext');

  console.log(`\n========================================`);
  console.log(`Phase 6 Test Results: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTenantIsolationTests().catch((err) => {
  console.error('Tenant isolation test failed:', err);
  process.exit(1);
});
