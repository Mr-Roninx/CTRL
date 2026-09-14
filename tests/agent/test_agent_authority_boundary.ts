import { evaluateOpportunity, setKillSwitch } from '../../src/authority/gate.js';
import { RecoveryOpportunity, Score, AllocationDecision } from '../../src/types/index.js';

export function runAuthorityBoundaryTests() {
  console.log('🧪 Running Test: Financial Action Authority Boundary (Zero LLM Bypass)...');
  setKillSwitch(false);

  const hardOpp: RecoveryOpportunity = {
    id: 'opp_hard_test',
    source: 'synthetic',
    amount_paise: 500000,
    currency: 'INR',
    reason_code: 'card_stolen',
    decline_type: 'hard',
    attempt_count: 1,
    customer_id: 'cust_1',
    customer_trust_score: 0.8,
    created_at: new Date().toISOString(),
    status: 'pending',
  };

  const decision: AllocationDecision = {
    opportunity_id: 'opp_hard_test',
    decision: 'ACT', // Market mistakenly allocated
    rank_in_batch: 1,
    shadow_price_paise_at_decision: 0,
    reason: 'test',
  };

  const score: Score = {
    opportunity_id: 'opp_hard_test',
    natural_recovery_prob: 0.02,
    intervention_recovery_prob: 0.02,
    incremental_prob: 0.0,
    operational_cost_paise: 400,
    fatigue_cost_paise: 0,
    expected_incremental_value_paise: -400,
    confidence: 'high',
  };

  const evalResult = evaluateOpportunity(hardOpp, decision, score);

  // Invariant: Action Authority independently VETOES the ACT decision
  if (evalResult.verdict !== 'BLOCKED') {
    throw new Error(`Expected Action Authority to block hard decline, got verdict: ${evalResult.verdict}`);
  }

  console.log('  ✅ PASS: Action Authority operates as independent compliance gate and overrides allocation when rules fail.');
}

if (process.argv[1]?.endsWith('test_agent_authority_boundary.ts')) {
  runAuthorityBoundaryTests();
}
