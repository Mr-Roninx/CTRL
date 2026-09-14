import { initDatabase, db, insertOpportunity, getAllOpportunities, getOpportunityById } from '../src/db/database.js';
import { runAuthorityPipeline } from '../src/authority/gate.js';
import { normalizeOpportunity } from '../src/perception/normalizer.js';
import { scoreOpportunity } from '../src/economics/scorer.js';

async function testTenantIsolationInBatchPipelines() {
  console.log('🧪 Starting Tenant Isolation Batch Pipeline Test Suite...\n');

  initDatabase();

  const tenantA = `tnt_iso_a_${Date.now()}`;
  const tenantB = `tnt_iso_b_${Date.now()}`;

  // Insert test tenants
  const insertTenant = db.prepare(`
    INSERT INTO tenants (id, name, slug, environment, status, created_at)
    VALUES (?, ?, ?, 'test', 'ACTIVE', ?)
  `);
  insertTenant.run(tenantA, 'Store A', `store-a-${Date.now()}`, new Date().toISOString());
  insertTenant.run(tenantB, 'Store B', `store-b-${Date.now()}`, new Date().toISOString());

  // 1. Create opportunities for Tenant A (3 soft declines with positive IVEN)
  for (let i = 1; i <= 3; i++) {
    const opp = normalizeOpportunity(
      {
        id: `pay_a_${Date.now()}_${i}`,
        amount: 50000 * i, // ₹500, ₹1000, ₹1500
        currency: 'INR',
        error_code: 'INSUFFICIENT_FUNDS',
        error_description: 'Tenant A payment failed',
        customer_id: `cust_a_${i}@example.com`,
      },
      `evt_a_${Date.now()}_${i}`,
      { source: 'synthetic', tenantId: tenantA }
    );
    insertOpportunity(opp);
    scoreOpportunity(opp);
  }

  // 2. Create opportunities for Tenant B (2 soft declines)
  for (let i = 1; i <= 2; i++) {
    const opp = normalizeOpportunity(
      {
        id: `pay_b_${Date.now()}_${i}`,
        amount: 80000 * i,
        currency: 'INR',
        error_code: 'INSUFFICIENT_FUNDS',
        error_description: 'Tenant B payment failed',
        customer_id: `cust_b_${i}@example.com`,
      },
      `evt_b_${Date.now()}_${i}`,
      { source: 'synthetic', tenantId: tenantB }
    );
    insertOpportunity(opp);
    scoreOpportunity(opp);
  }

  const oppsA = getAllOpportunities(tenantA);
  const oppsB = getAllOpportunities(tenantB);

  console.log(`✅ Tenant A seeded with ${oppsA.length} opportunities`);
  console.log(`✅ Tenant B seeded with ${oppsB.length} opportunities`);

  if (oppsA.length !== 3 || oppsB.length !== 2) {
    throw new Error('Opportunities seeding count mismatch');
  }

  // 3. Run Authority Pipeline ONLY for Tenant A
  console.log('\nRunning Authority Pipeline scoped to Tenant A...');
  const authorityResultA = runAuthorityPipeline({ capacity: 5, tenantId: tenantA });

  console.log(`Evaluated: ${authorityResultA.total_evaluated}, Authorized: ${authorityResultA.authorized_count}`);

  if (authorityResultA.total_evaluated !== 3) {
    throw new Error(`Expected exactly 3 evaluated opportunities for Tenant A, got ${authorityResultA.total_evaluated}`);
  }

  // Verify that Tenant B's opportunities are still pending
  for (const opp of oppsB) {
    const refreshed = getOpportunityById(opp.id);
    if (refreshed?.status !== 'pending' && refreshed?.status !== 'scored') {
      throw new Error(`Tenant B opportunity ${opp.id} was unintentionally modified to status ${refreshed?.status}`);
    }
  }

  console.log('✅ Verified: Tenant B opportunities remained untouched during Tenant A authority evaluation');

  // 4. Run Authority Pipeline ONLY for Tenant B
  console.log('\nRunning Authority Pipeline scoped to Tenant B...');
  const authorityResultB = runAuthorityPipeline({ capacity: 5, tenantId: tenantB });

  if (authorityResultB.total_evaluated !== 2) {
    throw new Error(`Expected exactly 2 evaluated opportunities for Tenant B, got ${authorityResultB.total_evaluated}`);
  }

  console.log('✅ Verified: Tenant B authority pipeline successfully evaluated only its 2 opportunities');

  console.log('\n🎉 ALL TENANT ISOLATION BATCH PIPELINE TESTS PASSED CLEANLY!');
}

testTenantIsolationInBatchPipelines().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
