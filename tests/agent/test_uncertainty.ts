import { initDatabase } from '../../src/db/database.js';
import { UncertaintyModel } from '../../src/agents/uncertainty.js';
import { RecoveryOpportunity, Score } from '../../src/types/index.js';

function makeOpp(overrides: Partial<RecoveryOpportunity> = {}): RecoveryOpportunity {
  return {
    id: 'test_unc_opp_01',
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
    opportunity_id: 'test_unc_opp_01',
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

export function runUncertaintyTests() {
  console.log('🧪 Running Test: Uncertainty Model (3 Dimensions)...');

  // Test 1: Full data produces high composite confidence
  const result1 = UncertaintyModel.assess({
    opportunity: makeOpp(),
    score: makeScore(),
    hasPerception: true,
    hasCustomerHistory: true,
    hasGatewayState: true,
    historicalSampleSize: 50,
    historicalCalibrationError: 0.10,
  });

  if (result1.composite_confidence < 0.6) {
    throw new Error(`Expected high composite with full data, got ${result1.composite_confidence}`);
  }
  if (result1.missing_signals.length !== 0) {
    throw new Error(`Expected no missing signals with full data, got: ${result1.missing_signals}`);
  }
  console.log(`  ✅ Full data → composite=${result1.composite_confidence}, rec=${result1.recommendation}`);

  // Test 2: Missing data reduces DATA_CONFIDENCE
  const result2 = UncertaintyModel.assess({
    opportunity: makeOpp(),
    score: null,
    hasPerception: false,
    hasCustomerHistory: false,
    hasGatewayState: false,
    historicalSampleSize: 5,
    historicalCalibrationError: 0.50,
  });

  if (result2.data_confidence >= result1.data_confidence) {
    throw new Error(`Missing data should lower data_confidence. Got: ${result2.data_confidence} vs ${result1.data_confidence}`);
  }
  if (result2.missing_signals.length < 3) {
    throw new Error(`Expected >=3 missing signals, got ${result2.missing_signals.length}`);
  }
  console.log(`  ✅ Missing data → composite=${result2.composite_confidence}, missing=${result2.missing_signals.length}`);

  // Test 3: Low composite confidence → HUMAN_REVIEW or ABSTAIN
  if (result2.composite_confidence >= 0.40) {
    throw new Error(`Expected low composite (<0.40) with missing data, got ${result2.composite_confidence}`);
  }
  if (result2.recommendation !== 'HUMAN_REVIEW' && result2.recommendation !== 'ABSTAIN') {
    throw new Error(`Expected HUMAN_REVIEW or ABSTAIN for low confidence, got ${result2.recommendation}`);
  }
  console.log(`  ✅ Low confidence → recommendation=${result2.recommendation}`);

  // Test 4: Deterministic — same inputs, same output
  const result3 = UncertaintyModel.assess({
    opportunity: makeOpp(),
    score: makeScore(),
    hasPerception: true,
    hasCustomerHistory: true,
    hasGatewayState: true,
    historicalSampleSize: 50,
    historicalCalibrationError: 0.10,
  });
  if (result3.composite_confidence !== result1.composite_confidence) {
    throw new Error(`Non-deterministic: ${result3.composite_confidence} !== ${result1.composite_confidence}`);
  }
  console.log(`  ✅ Deterministic: repeated assessment yields identical composite_confidence`);

  // Test 5: All dimensions bounded [0, 1]
  if (result1.model_confidence < 0 || result1.model_confidence > 1 ||
      result1.data_confidence < 0 || result1.data_confidence > 1 ||
      result1.economic_confidence < 0 || result1.economic_confidence > 1) {
    throw new Error('Confidence dimensions out of [0, 1] range');
  }
  console.log(`  ✅ All dimensions bounded [0, 1]`);

  console.log('  ✅ PASS: Uncertainty model validated — 3 dimensions, bounded, deterministic.\n');
}

if (process.argv[1]?.endsWith('test_uncertainty.ts')) {
  initDatabase();
  runUncertaintyTests();
}
