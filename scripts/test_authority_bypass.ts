import { RecoveryOpportunity, Score, AllocationDecision } from '../src/types/index.js';
import { insertOpportunity, initDatabase } from '../src/db/database.js';
import { evaluateOpportunity } from '../src/authority/gate.js';

initDatabase();

async function testAuthorityBypass() {
  console.log('🧪 Testing Action Authority Market-Bypass Scenario (Fix 3 Verification)...');

  // Construct a synthetic opportunity with unknown reason (confidence = low)
  const bypassOpp: RecoveryOpportunity = {
    id: `pay_bypass_test_${Date.now()}`,
    source: 'synthetic',
    amount_paise: 500000,
    currency: 'INR',
    reason_code: 'unmapped_issuer_code_999',
    decline_type: 'unknown',
    attempt_count: 1,
    customer_id: 'cust_bypass_01',
    customer_trust_score: 0.65,
    created_at: new Date().toISOString(),
    status: 'pending',
  };

  insertOpportunity(bypassOpp);

  // Low confidence score
  const score: Score = {
    opportunity_id: bypassOpp.id,
    natural_recovery_prob: 0.10,
    intervention_recovery_prob: 0.10,
    incremental_prob: 0.00,
    operational_cost_paise: 400,
    fatigue_cost_paise: 0,
    expected_incremental_value_paise: -400,
    confidence: 'low',
  };

  // Suppose an attacker or buggy process attempts to bypass the Market allocator by manually creating a fake "ACT" decision
  const forgedBypassDecision: AllocationDecision = {
    opportunity_id: bypassOpp.id,
    decision: 'ACT',
    rank_in_batch: 1,
    shadow_price_paise_at_decision: 50000,
    reason: 'Forged bypass allocation attempting to execute without Market validation',
  };

  console.log('\n--- Scenario: Forged "ACT" Decision with Low Confidence reaching Authority Gate ---');
  const evalResult = evaluateOpportunity(bypassOpp, forgedBypassDecision, score);

  console.log('Authority Evaluation Result:', {
    opportunity_id: evalResult.opportunity_id,
    verdict: evalResult.verdict,
    all_passed: evalResult.all_passed,
    summary_reason: evalResult.summary_reason,
    checks: evalResult.checks,
  });

  const confidenceCheck = evalResult.checks.find((c) => c.check_name === 'confidence_recheck');

  if (confidenceCheck && !confidenceCheck.passed && evalResult.verdict === 'ABSTAIN') {
    console.log('\n✅ PASS: confidence_recheck successfully caught and vetoed the forged market-bypass attempt!');
    console.log(`   Check Name: ${confidenceCheck.check_name}`);
    console.log(`   Passed: ${confidenceCheck.passed}`);
    console.log(`   Reason: "${confidenceCheck.reason}"`);
    console.log(`   Final Verdict: ${evalResult.verdict}`);
  } else {
    console.error('❌ FAIL: confidence_recheck failed to block the bypass attempt:', evalResult);
    process.exit(1);
  }
}

testAuthorityBypass().catch(console.error);
