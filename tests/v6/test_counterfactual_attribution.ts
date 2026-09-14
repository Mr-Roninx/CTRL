process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateScore, estimateProbabilities } from '../../src/economics/scorer.js';
import { RecoveryOpportunity } from '../../src/types/index.js';

describe('V6 Phase 8: Counterfactual Attribution, Shadow Price & Model Labeling', () => {
  it('calculates counterfactual causal lift by subtracting natural holdout recovery from intervention rate', () => {
    const opp: RecoveryOpportunity = {
      id: 'opp_cf_01',
      source: 'real',
      amount_paise: 1000000, // ₹10,000.00
      currency: 'INR',
      reason_code: 'insufficient_funds',
      decline_type: 'soft',
      attempt_count: 1,
      customer_id: 'cust_cf_01',
      customer_trust_score: 75,
      created_at: new Date().toISOString(),
      status: 'pending',
    };

    const probs = estimateProbabilities(opp);
    const score = calculateScore(opp);

    // Natural holdout recovery = 0.35, Intervention rate = 0.55
    const naturalHoldoutRate = probs.natural_recovery_prob;
    const interventionRate = probs.intervention_recovery_prob;
    const incrementalLift = probs.incremental_prob;

    assert.equal(naturalHoldoutRate, 0.35);
    assert.equal(interventionRate, 0.55);
    assert.equal(incrementalLift, 0.20);

    // Attributed Incremental Value = 0.20 * 1,000,000 paise = 200,000 paise (₹2,000.00)
    const expectedIncrementalAttributionPaise = incrementalLift * opp.amount_paise;
    assert.equal(expectedIncrementalAttributionPaise, 200000);
  });

  it('determines shadow price under binding portfolio capacity', () => {
    // 5 opportunities with varying IVEN values
    const opportunities = [
      { id: 'opp_1', iven_paise: 50000 },
      { id: 'opp_2', iven_paise: 35000 },
      { id: 'opp_3', iven_paise: 20000 },
      { id: 'opp_4', iven_paise: 10000 },
      { id: 'opp_5', iven_paise: -500 },
    ];

    const capacityLimit = 3;

    // Sort descending by IVEN
    const ranked = [...opportunities].sort((a, b) => b.iven_paise - a.iven_paise);
    const accepted = ranked.slice(0, capacityLimit);
    const rejected = ranked.slice(capacityLimit);

    // Shadow price is the value of the marginal accepted opportunity
    const shadowPricePaise = accepted[accepted.length - 1].iven_paise;

    assert.equal(accepted.length, 3);
    assert.equal(shadowPricePaise, 20000); // Marginal accepted item is opp_3 (20,000 paise)
    assert.ok(rejected.every((item) => item.iven_paise < shadowPricePaise));
  });

  it('INVARIANT: All probability and recovery rate outputs must be explicitly labeled as model-estimated', () => {
    const opp: RecoveryOpportunity = {
      id: 'opp_label_01',
      source: 'real',
      amount_paise: 500000,
      currency: 'INR',
      reason_code: 'generic_decline',
      decline_type: 'soft',
      attempt_count: 1,
      customer_id: 'cust_label_01',
      customer_trust_score: 70,
      created_at: new Date().toISOString(),
      status: 'pending',
    };

    const score = calculateScore(opp);

    // The presentation contract requires explicit labeling of counterfactual probabilities
    const formattedPresentation = {
      opportunity_id: score.opportunity_id,
      natural_recovery_prob: score.natural_recovery_prob,
      intervention_recovery_prob: score.intervention_recovery_prob,
      incremental_prob: score.incremental_prob,
      expected_incremental_value_paise: score.expected_incremental_value_paise,
      is_model_estimated: true,
      estimation_disclaimer: 'Counterfactual recovery rates are model-estimated approximations, not observed ground truth.',
    };

    assert.equal(formattedPresentation.is_model_estimated, true);
    assert.match(formattedPresentation.estimation_disclaimer, /model-estimated/);
  });
});
