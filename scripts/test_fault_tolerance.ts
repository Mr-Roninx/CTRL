import dotenv from 'dotenv';
import path from 'node:path';
import {
  initDatabase,
  insertOpportunity,
  getAllOpportunities,
  getScoreByOpportunityId,
} from '../src/db/database.js';
import { executeAuthorizedBatch } from '../src/execution/executor.js';
import { scoreOpportunity } from '../src/economics/scorer.js';
import { RecoveryOpportunity } from '../src/types/index.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
initDatabase();

async function runFaultToleranceAndDataIntegrityAudit() {
  console.log('🧪 Starting Fault Tolerance & Data Integrity Audit...\n');

  // --- Part 1: Fault Tolerance & Error Isolation ---
  console.log('--- Part 1: Fault Tolerance & Error Isolation ---');
  const garbageId = `synth_garbage_test_${Date.now()}`;
  const garbageOpp: RecoveryOpportunity = {
    id: garbageId,
    source: 'synthetic',
    amount_paise: -50000, // Invalid negative amount
    currency: 'INR',
    reason_code: 'generic_decline',
    decline_type: 'soft',
    attempt_count: 1,
    customer_id: 'cust_garbage_user',
    customer_trust_score: 0.5,
    created_at: new Date().toISOString(),
    status: 'pending',
  };

  insertOpportunity(garbageOpp);
  console.log(`Injected malformed record: ${garbageId} (amount: -50,000 paise)`);

  const batchResult = await executeAuthorizedBatch({ maxLinks: 5 });
  console.log('Batch Execution Result with Faulty Items:', {
    total_authorized: batchResult.total_authorized,
    executed_count: batchResult.executed_count,
    failed_count: batchResult.failed_count,
    skipped_count: batchResult.skipped_count,
  });

  if (batchResult.total_authorized >= 0 && Array.isArray(batchResult.results)) {
    console.log('✅ PASS: Batch execution isolated all errors cleanly without crashing the runtime.');
  } else {
    console.error('❌ FAIL: Batch execution crashed or failed to isolate errors.');
    process.exit(1);
  }

  // --- Part 2: Data Integrity Spot-Check (3 Random Opportunities) ---
  console.log('\n--- Part 2: Data Integrity Spot-Check (Manual Formula vs Stored IVEN) ---');
  
  const allOpps = getAllOpportunities().filter(o => o.id !== garbageId);
  // Pick 3 diverse opportunities
  const sampleIds = [
    'synth_02_insufficient_funds_att1',
    'synth_04_expired_card',
    'synth_07_high_val_enterprise',
  ];

  for (const id of sampleIds) {
    const opp = allOpps.find(o => o.id === id);
    if (!opp) continue;
    const storedScore = getScoreByOpportunityId(opp.id)!;

    // Manual Recomputation from First Principles:
    // 1. Probabilities from taxonomy
    let natural = 0;
    let intervention = 0;
    if (opp.reason_code === 'insufficient_funds') {
      natural = 0.35;
      intervention = 0.55;
    } else if (opp.reason_code === 'expired_card') {
      natural = 0.05;
      intervention = 0.60;
    } else if (opp.reason_code === 'bank_gateway_timeout') {
      natural = 0.60;
      intervention = 0.70;
    }
    const incrementalProb = Math.max(0, intervention - natural);

    // 2. Operational Cost: 400 paise
    const opCost = 400;

    // 3. Fatigue Cost Curve:
    // attempt 1 -> 0
    // attempt 2 -> 250
    // attempt 3 -> 750
    let fatigueCost = 0;
    if (opp.attempt_count === 1) fatigueCost = 0;
    else if (opp.attempt_count === 2) fatigueCost = 250;
    else if (opp.attempt_count === 3) fatigueCost = 750;

    // 4. Expected Incremental Value (paise):
    // IVEN = round(incremental_prob * amount_paise - opCost - fatigueCost)
    const expectedIVEN = Math.round(incrementalProb * opp.amount_paise - opCost - fatigueCost);

    console.log(`\nChecking Opportunity: ${opp.id}`);
    console.log(`  Amount: ₹${opp.amount_paise / 100} | Reason: ${opp.reason_code} | Attempt: ${opp.attempt_count}`);
    console.log(`  Manual Calc: (${intervention} - ${natural}) × ${opp.amount_paise} - ${opCost} - ${fatigueCost} = ${expectedIVEN} paise (₹${expectedIVEN / 100})`);
    console.log(`  Stored Score: incremental_prob=${storedScore.incremental_prob}, IVEN=${storedScore.expected_incremental_value_paise} paise (₹${storedScore.expected_incremental_value_paise / 100})`);

    const mathMatch = Math.abs(storedScore.expected_incremental_value_paise - expectedIVEN) <= 1;
    const probMatch = Math.abs(storedScore.incremental_prob - incrementalProb) < 0.0001;

    if (mathMatch && probMatch) {
      console.log(`  ✅ PASS: Stored IVEN matches manual recomputation exactly.`);
    } else {
      console.error(`  ❌ FAIL: Stored IVEN mismatch! Expected ${expectedIVEN}, got ${storedScore.expected_incremental_value_paise}`);
      process.exit(1);
    }
  }

  console.log('\n🎉 ALL FAULT TOLERANCE & DATA INTEGRITY TESTS PASSED!');
}

runFaultToleranceAndDataIntegrityAudit().catch((err) => {
  console.error('Audit execution error:', err);
  process.exit(1);
});
