process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseAdapter } from '../../src/db/adapter.js';
import { MigrationRunner } from '../../src/db/migrations/runner.js';
import {
  ThompsonSamplingBandit,
  sampleBeta,
  sampleGamma,
  resolveAmountTier,
} from '../../src/economics/bandit_policy.js';
import { RecoveryOpportunity } from '../../src/types/index.js';
import { calculateScore } from '../../src/economics/scorer.js';
import { evaluateOpportunity } from '../../src/authority/gate.js';

describe('Reinforcement Learning: Thompson Sampling Contextual Bandit (Option A)', () => {
  before(async () => {
    const db = DatabaseAdapter.getInstance();
    await MigrationRunner.migrateUp(db);
  });

  it('samples valid Gamma and Beta variates strictly within bounds', () => {
    for (let i = 0; i < 100; i++) {
      const g = sampleGamma(2.5);
      assert.ok(g > 0, `Gamma sample must be positive, got ${g}`);

      const b = sampleBeta(3.0, 5.0);
      assert.ok(b >= 0.001 && b <= 0.999, `Beta sample must be in [0.001, 0.999], got ${b}`);
    }
  });

  it('resolves correct amount tiers for context keys', () => {
    assert.equal(resolveAmountTier(50000), 'MICRO');       // ₹500
    assert.equal(resolveAmountTier(250000), 'MID');        // ₹2,500
    assert.equal(resolveAmountTier(1500000), 'HIGH');      // ₹15,000
    assert.equal(resolveAmountTier(5000000), 'ENTERPRISE'); // ₹50,000
  });

  it('INVARIANT: Hard fraud decline unconditionally forces P(incremental) = 0.0 even under bandit sampling', () => {
    const bandit = ThompsonSamplingBandit.getInstance();

    const hardOpp: RecoveryOpportunity = {
      id: 'opp_hard_bandit_01',
      source: 'real',
      amount_paise: 5000000, // ₹50,000
      currency: 'INR',
      reason_code: 'fraudulent_card_lost',
      decline_type: 'hard',
      attempt_count: 1,
      customer_id: 'cust_fraud_01',
      customer_trust_score: 0.1,
      created_at: new Date().toISOString(),
      status: 'pending',
    };

    const sample = bandit.sampleProbabilities(hardOpp, 'tenant_bandit_test');
    assert.equal(sample.p_incremental, 0.0, 'Incremental probability MUST be 0.0 for hard declines');
    assert.equal(sample.p_intervention, 0.02);
    assert.equal(sample.p_natural, 0.02);
    assert.equal(sample.is_hard_veto, true);

    // Verify IVEN is strictly negative (cannot justify action)
    const score = calculateScore(hardOpp, { useBanditSampling: true, tenantId: 'tenant_bandit_test' });
    assert.ok(score.expected_incremental_value_paise <= 0, 'IVEN must be <= 0 for hard declines');
  });

  it('updates posterior Beta parameters upon receiving reconciliation feedback', () => {
    const bandit = ThompsonSamplingBandit.getInstance();
    const contextKey = 'insufficient_funds:MID';
    const tenantId = 'tenant_rl_test';

    // 1. Initial draw
    const opp: RecoveryOpportunity = {
      id: 'opp_soft_bandit_02',
      source: 'real',
      amount_paise: 250000,
      currency: 'INR',
      reason_code: 'insufficient_funds',
      decline_type: 'soft',
      attempt_count: 1,
      customer_id: 'cust_soft_02',
      customer_trust_score: 0.8,
      created_at: new Date().toISOString(),
      status: 'pending',
    };

    const initialSample = bandit.sampleProbabilities(opp, tenantId);
    assert.ok(initialSample.p_incremental >= 0, 'Incremental prob must be non-negative');

    // 2. Simulate 5 consecutive successful recoveries (reward = 1)
    for (let i = 0; i < 5; i++) {
      bandit.updateReward({
        tenantId,
        contextKey,
        isRecovered: true,
        isIntervention: true,
      });
    }

    const postSuccessSample = bandit.sampleProbabilities(opp, tenantId);
    assert.equal(postSuccessSample.alpha_interv, initialSample.alpha_interv + 5);

    // 3. Simulate 2 failed/expired recoveries (reward = 0)
    for (let i = 0; i < 2; i++) {
      bandit.updateReward({
        tenantId,
        contextKey,
        isRecovered: false,
        isIntervention: true,
      });
    }

    const postFailureSample = bandit.sampleProbabilities(opp, tenantId);
    assert.equal(postFailureSample.beta_interv, initialSample.beta_interv + 2);
  });

  it('Action Authority unconditionally vetoes high-IVEN bandit proposals if hard decline or retry cap', () => {
    const bandit = ThompsonSamplingBandit.getInstance();

    const exhaustedOpp: RecoveryOpportunity = {
      id: 'opp_exhausted_bandit_03',
      source: 'real',
      amount_paise: 10000000, // ₹100,000 high-value
      currency: 'INR',
      reason_code: 'insufficient_funds',
      decline_type: 'soft',
      attempt_count: 3, // At retry cap!
      customer_id: 'cust_exhausted_03',
      customer_trust_score: 0.9,
      created_at: new Date().toISOString(),
      status: 'allocated',
    };

    const score = calculateScore(exhaustedOpp, { useBanditSampling: true });
    
    // Market proposed ACT
    const decision = {
      opportunity_id: exhaustedOpp.id,
      decision: 'ACT' as const,
      rank_in_batch: 1,
      shadow_price_paise_at_decision: 5000,
      reason: 'Top IVEN in batch from Thompson Sampling exploration',
    };

    // Action Authority evaluation
    const authResult = evaluateOpportunity(exhaustedOpp, decision, score);
    assert.equal(authResult.verdict, 'BLOCKED', 'Action Authority MUST veto retry cap >= 3 regardless of bandit bid');
    assert.match(authResult.summary_reason, /retry cap reached/);
  });
});
