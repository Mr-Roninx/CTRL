import { executeOpportunity } from '../../src/execution/executor.js';
import { initDatabase, upsertOpportunity, upsertScore, upsertAllocationDecision } from '../../src/db/database.js';

export async function runExecutionBoundaryTests() {
  console.log('🧪 Running Test: Razorpay Execution Isolation & Authority Enforcement...');
  initDatabase();

  const oppId = 'test_unauth_exec_opp';
  upsertOpportunity({
    id: oppId,
    source: 'synthetic',
    amount_paise: 300000,
    currency: 'INR',
    reason_code: 'stolen_card',
    decline_type: 'hard', // Hard decline -> MUST NOT EXECUTE
    attempt_count: 1,
    customer_id: 'cust_unauth',
    customer_trust_score: 0.1,
    created_at: new Date().toISOString(),
    status: 'pending',
  });

  upsertScore({
    opportunity_id: oppId,
    natural_recovery_prob: 0.02,
    intervention_recovery_prob: 0.02,
    incremental_prob: 0.0,
    operational_cost_paise: 400,
    fatigue_cost_paise: 0,
    expected_incremental_value_paise: -400,
    confidence: 'high',
  });

  upsertAllocationDecision({
    opportunity_id: oppId,
    decision: 'ACT', // Unauthorized
    rank_in_batch: 1,
    shadow_price_paise_at_decision: 0,
    reason: 'test',
  });

  let errorThrown = false;
  try {
    await executeOpportunity(oppId);
  } catch (err: any) {
    errorThrown = true;
    if (!err.message.includes('Compliance Violation')) {
      throw new Error(`Expected Compliance Violation error, got: ${err.message}`);
    }
  }

  if (!errorThrown) {
    throw new Error('CRITICAL SAFETY FAILURE: executeOpportunity executed an un-authorized hard decline opportunity!');
  }

  console.log('  ✅ PASS: Execution layer strictly asserts AUTHORIZED status and blocks unauthorized creation.');
}

if (process.argv[1]?.endsWith('test_agent_execution_boundary.ts')) {
  runExecutionBoundaryTests();
}
