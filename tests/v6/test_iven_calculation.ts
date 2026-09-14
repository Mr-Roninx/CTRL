process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateScore, estimateProbabilities, calculateCosts } from '../../src/economics/scorer.js';
import { RecoveryOpportunity } from '../../src/types/index.js';

describe('V6 Phase 8: IVEN Calculation & Economic Decision Resolution', () => {
  it('calculates IVEN in paise using incremental probability and cost deductions', () => {
    const opp: RecoveryOpportunity = {
      id: 'opp_econ_01',
      source: 'real',
      amount_paise: 500000, // ₹5,000.00
      currency: 'INR',
      reason_code: 'bad_request_payment_card_expired',
      decline_type: 'soft',
      attempt_count: 1,
      customer_id: 'cust_econ_01',
      customer_trust_score: 80,
      created_at: new Date().toISOString(),
      status: 'pending',
    };

    const probs = estimateProbabilities(opp);
    const costs = calculateCosts(opp.attempt_count);
    const score = calculateScore(opp);

    // Expired card: natural=0.05, intervention=0.60, incremental=0.55
    assert.equal(probs.natural_recovery_prob, 0.05);
    assert.equal(probs.intervention_recovery_prob, 0.60);
    assert.equal(probs.incremental_prob, 0.55);

    // Attempt 1: operational=400 paise, fatigue=0 paise
    assert.equal(costs.operational_cost_paise, 400);
    assert.equal(costs.fatigue_cost_paise, 0);

    // Expected Gross = 0.55 * 500,000 = 275,000 paise
    // IVEN = 275,000 - 400 - 0 = 274,600 paise
    assert.equal(score.expected_incremental_value_paise, 274600);
    assert.ok(score.expected_incremental_value_paise > 0, 'High-IVEN opportunity must have positive incremental value');
  });

  it('enforces ABSTAIN decision on hard declines where incremental probability is zero', () => {
    const hardOpp: RecoveryOpportunity = {
      id: 'opp_hard_02',
      source: 'real',
      amount_paise: 1000000, // ₹10,000.00
      currency: 'INR',
      reason_code: 'card_reported_lost_or_stolen',
      decline_type: 'hard',
      attempt_count: 1,
      customer_id: 'cust_hard_02',
      customer_trust_score: 10,
      created_at: new Date().toISOString(),
      status: 'pending',
    };

    const probs = estimateProbabilities(hardOpp);
    const score = calculateScore(hardOpp);

    // Hard decline: natural=0.02, intervention=0.02, incremental=0.00
    assert.equal(probs.incremental_prob, 0.00);
    // IVEN = (0.00 * 1,000,000) - 400 = -400 paise
    assert.equal(score.expected_incremental_value_paise, -400);
    assert.ok(score.expected_incremental_value_paise < 0, 'Hard decline must have negative IVEN');
  });

  it('applies customer fatigue penalties with increasing attempt counts', () => {
    const costAttempt1 = calculateCosts(1);
    const costAttempt2 = calculateCosts(2);
    const costAttempt3 = calculateCosts(3);
    const costAttempt4 = calculateCosts(4);

    assert.equal(costAttempt1.fatigue_cost_paise, 0);
    assert.equal(costAttempt2.fatigue_cost_paise, 250);
    assert.equal(costAttempt3.fatigue_cost_paise, 750);
    assert.equal(costAttempt4.fatigue_cost_paise, 1500);
  });
});
