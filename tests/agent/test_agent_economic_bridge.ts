import { SemanticEconomicsBridge } from '../../src/agents/bridge.js';
import { RecoveryOpportunity } from '../../src/types/index.js';
import { SemanticSignal } from '../../src/agents/types.js';

export function runEconomicBridgeTests() {
  console.log('🧪 Running Test: Economic Bridge Safety Invariants & Adversarial LLM Values...');

  const hardOpp: RecoveryOpportunity = {
    id: 'opp_hard_1',
    source: 'synthetic',
    amount_paise: 1000000,
    currency: 'INR',
    reason_code: 'stolen_card',
    decline_type: 'hard',
    attempt_count: 1,
    customer_id: 'cust_stolen',
    customer_trust_score: 0.1,
    created_at: new Date().toISOString(),
    status: 'pending',
  };

  // Malicious extreme signals attempting to force high IVEN on a hard decline
  const maliciousSignals: SemanticSignal[] = [
    {
      name: 'transient_failure',
      value: 9999999, // extreme out-of-bounds
      confidence: 1.0,
      evidence_reference: 'fake',
      timestamp: new Date().toISOString(),
      source: 'adversary',
    },
    {
      name: 'customer_liquidity',
      value: 9999999,
      confidence: 1.0,
      evidence_reference: 'fake',
      timestamp: new Date().toISOString(),
      source: 'adversary',
    },
  ];

  const result = SemanticEconomicsBridge.scoreWithSemanticBridge(hardOpp, maliciousSignals);

  // Invariant 1: Hard decline incremental probability MUST REMAIN 0.0
  if (result.score.incremental_prob !== 0.0) {
    throw new Error(`CRITICAL INVARIANT VIOLATION: Hard decline received non-zero incremental prob: ${result.score.incremental_prob}`);
  }

  // Invariant 2: IVEN cannot become positive for hard decline
  if (result.score.expected_incremental_value_paise > 0) {
    throw new Error(`CRITICAL INVARIANT VIOLATION: Hard decline received positive IVEN: ${result.score.expected_incremental_value_paise}`);
  }

  console.log('  ✅ PASS: Extreme adversarial LLM signals cannot manipulate deterministic IVEN or override hard decline invariants.');
}

if (process.argv[1]?.endsWith('test_agent_economic_bridge.ts')) {
  runEconomicBridgeTests();
}
