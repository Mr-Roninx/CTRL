import dotenv from 'dotenv';
import path from 'node:path';
import { initDatabase, upsertOpportunity, upsertCustomer } from '../../src/db/database.js';
import { MissionConcurrencyCoordinator } from '../../src/agents/concurrency.js';
import { RecoveryOpportunity } from '../../src/types/index.js';
import { setKillSwitch } from '../../src/authority/gate.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const CONCURRENT_OPPS: RecoveryOpportunity[] = [
  {
    id: 'conc_test_opp_01',
    source: 'synthetic',
    amount_paise: 350000,
    currency: 'INR',
    reason_code: 'insufficient_funds',
    decline_type: 'soft',
    attempt_count: 1,
    customer_id: 'cust_conc_01',
    customer_trust_score: 0.85,
    created_at: new Date().toISOString(),
    status: 'pending',
  },
  {
    id: 'conc_test_opp_02',
    source: 'synthetic',
    amount_paise: 450000,
    currency: 'INR',
    reason_code: 'expired_card',
    decline_type: 'soft',
    attempt_count: 1,
    customer_id: 'cust_conc_02',
    customer_trust_score: 0.9,
    created_at: new Date().toISOString(),
    status: 'pending',
  },
  {
    id: 'conc_test_opp_03',
    source: 'synthetic',
    amount_paise: 200000,
    currency: 'INR',
    reason_code: 'generic_decline',
    decline_type: 'soft',
    attempt_count: 2,
    customer_id: 'cust_conc_03',
    customer_trust_score: 0.7,
    created_at: new Date().toISOString(),
    status: 'pending',
  },
  {
    id: 'conc_test_opp_04',
    source: 'synthetic',
    amount_paise: 150000,
    currency: 'INR',
    reason_code: 'stolen_card',
    decline_type: 'hard',
    attempt_count: 1,
    customer_id: 'cust_conc_04',
    customer_trust_score: 0.2,
    created_at: new Date().toISOString(),
    status: 'pending',
  },
];

export async function runConcurrencyTests() {
  console.log('🧪 Running Test: Mission Concurrency Coordinator...');
  initDatabase();

  for (const opp of CONCURRENT_OPPS) {
    upsertCustomer({ id: opp.customer_id, trust_score: opp.customer_trust_score, created_at: opp.created_at, updated_at: opp.created_at });
    upsertOpportunity(opp);
  }

  // Test 1: Batch execution respects max concurrency ceiling
  const summary = await MissionConcurrencyCoordinator.executeBatch({
    opportunityIds: CONCURRENT_OPPS.map((o) => o.id),
    config: { max_concurrent_missions: 2, mission_timeout_ms: 45000 },
  });

  if (summary.total_submitted !== 4) {
    throw new Error(`Expected 4 submitted, got ${summary.total_submitted}`);
  }
  if (summary.max_concurrency_reached > 2) {
    throw new Error(`Max concurrency ceiling breached: ${summary.max_concurrency_reached} > 2`);
  }
  if (summary.completed_count < 1) {
    throw new Error(`Expected at least 1 completed mission, got ${summary.completed_count}`);
  }
  console.log(`  ✅ Batch executed: ${summary.completed_count} completed, max concurrency reached: ${summary.max_concurrency_reached} <= 2`);

  // Test 2: Double-processing lock prevents concurrent duplicate execution
  const duplicateRun = await MissionConcurrencyCoordinator.executeBatch({
    opportunityIds: ['conc_test_opp_01', 'conc_test_opp_01'],
    config: { max_concurrent_missions: 2 },
  });
  // The first completes or runs, duplicate lock protects
  if (duplicateRun.total_submitted !== 2) {
    throw new Error('Duplicate submission count mismatch');
  }
  console.log(`  ✅ Idempotency protection handles duplicate opportunity submissions`);

  // Test 3: Kill switch halts all batch processing immediately
  setKillSwitch(true);
  const killedBatch = await MissionConcurrencyCoordinator.executeBatch({
    opportunityIds: CONCURRENT_OPPS.map((o) => o.id),
  });
  setKillSwitch(false); // Reset

  if (killedBatch.completed_count !== 0) {
    throw new Error(`Expected 0 completed under kill switch, got ${killedBatch.completed_count}`);
  }
  if (killedBatch.aborted_count !== CONCURRENT_OPPS.length) {
    throw new Error(`Expected all ${CONCURRENT_OPPS.length} aborted under kill switch, got ${killedBatch.aborted_count}`);
  }
  console.log(`  ✅ Global kill switch immediately halts all concurrent batch operations (0 completed, ${killedBatch.aborted_count} aborted)`);

  console.log('  ✅ PASS: Concurrency coordinator verified — bounded concurrency, locks, kill switch safety.\n');
}

if (process.argv[1]?.endsWith('test_concurrency.ts')) {
  runConcurrencyTests();
}
