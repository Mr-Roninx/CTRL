import { initDatabase } from '../../src/db/database.js';
import { InformationValueEstimator } from '../../src/agents/information_value.js';
import { RecoveryOpportunity, Score } from '../../src/types/index.js';

function makeOpp(overrides: Partial<RecoveryOpportunity> = {}): RecoveryOpportunity {
  return {
    id: 'test_iv_opp_01',
    source: 'synthetic',
    amount_paise: 250000,
    currency: 'INR',
    reason_code: 'insufficient_funds',
    decline_type: 'soft',
    attempt_count: 1,
    customer_id: 'cust_test_01',
    customer_trust_score: 0.8,
    created_at: new Date(Date.now() - 3600000).toISOString(),
    status: 'pending',
    ...overrides,
  };
}

function makeScore(overrides: Partial<Score> = {}): Score {
  return {
    opportunity_id: 'test_iv_opp_01',
    natural_recovery_prob: 0.35,
    intervention_recovery_prob: 0.55,
    incremental_prob: 0.20,
    operational_cost_paise: 500,
    fatigue_cost_paise: 200,
    expected_incremental_value_paise: 49300,
    confidence: 'medium',
    ...overrides,
  };
}

export function runInformationValueTests() {
  console.log('🧪 Running Test: Information Value Estimator...');

  // Test 1: Unstable gateway + positive EVOI → INVESTIGATE
  const result1 = InformationValueEstimator.estimate({
    opportunity: makeOpp(),
    score: makeScore(),
    gatewayHealth: 0.60,
    compositeConfidence: 0.50,
    hasPerception: true,
  });

  if (result1.recommended_action !== 'INVESTIGATE') {
    throw new Error(`Expected INVESTIGATE for unstable gateway, got ${result1.recommended_action}`);
  }
  if (result1.expected_value_of_information_paise <= 0) {
    throw new Error(`Expected positive EVOI, got ${result1.expected_value_of_information_paise}`);
  }
  console.log(`  ✅ Unstable gateway → INVESTIGATE, EVOI=₹${(result1.expected_value_of_information_paise/100).toFixed(2)}`);

  // Test 2: High confidence + healthy gateway + strong IVEN → ACT
  const result2 = InformationValueEstimator.estimate({
    opportunity: makeOpp(),
    score: makeScore(),
    gatewayHealth: 0.95,
    compositeConfidence: 0.85,
    hasPerception: true,
  });

  if (result2.recommended_action !== 'ACT') {
    throw new Error(`Expected ACT for high conf + healthy gw + strong IVEN, got ${result2.recommended_action}`);
  }
  console.log(`  ✅ High confidence + healthy gateway → ACT`);

  // Test 3: Borderline IVEN + degraded gateway → WAIT
  // Note: With IVEN ≤ 5000 paise AND gateway < 0.75, the estimator WAIT's
  // because IVEN is too low to justify action and the gateway is unhealthy.
  const result3 = InformationValueEstimator.estimate({
    opportunity: makeOpp(),
    score: makeScore({ expected_incremental_value_paise: 2000 }),
    gatewayHealth: 0.60,
    compositeConfidence: 0.90,
    hasPerception: true,
  });

  if (result3.recommended_action !== 'WAIT') {
    throw new Error(`Expected WAIT for borderline IVEN + degraded gw, got ${result3.recommended_action}`);
  }
  console.log(`  ✅ Borderline IVEN + degraded gateway → WAIT`);

  // Test 4: EVOI bounded (cannot exceed 20% of IVEN)
  const maxFractionResult = InformationValueEstimator.estimate({
    opportunity: makeOpp(),
    score: makeScore({ expected_incremental_value_paise: 100000 }),
    gatewayHealth: 0.60,
    compositeConfidence: 0.0,
    hasPerception: false,
  });

  const maxAllowed = 100000 * 0.20;
  if (maxFractionResult.expected_value_of_information_paise > maxAllowed) {
    throw new Error(`EVOI ${maxFractionResult.expected_value_of_information_paise} exceeds 20% cap of ${maxAllowed}`);
  }
  console.log(`  ✅ EVOI bounded: ${maxFractionResult.expected_value_of_information_paise} ≤ ${maxAllowed}`);

  // Test 5: Deterministic — same inputs, same output
  const result2b = InformationValueEstimator.estimate({
    opportunity: makeOpp(),
    score: makeScore(),
    gatewayHealth: 0.95,
    compositeConfidence: 0.85,
    hasPerception: true,
  });
  if (result2b.recommended_action !== result2.recommended_action ||
      result2b.expected_value_of_information_paise !== result2.expected_value_of_information_paise) {
    throw new Error('Non-deterministic information value estimation');
  }
  console.log(`  ✅ Deterministic: repeated estimation yields identical output`);

  console.log('  ✅ PASS: Information value estimator validated — bounded, deterministic, correct routing.\n');
}

if (process.argv[1]?.endsWith('test_information_value.ts')) {
  initDatabase();
  runInformationValueTests();
}
