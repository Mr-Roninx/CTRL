process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseAdapter } from '../../src/db/adapter.js';
import { MigrationRunner } from '../../src/db/migrations/runner.js';
import { evaluateOpportunity, resetAllKillSwitches } from '../../src/authority/gate.js';
import { RecoveryOpportunity, AllocationDecision, Score } from '../../src/types/index.js';

describe('V6 Phase 9: Action Authority & Deterministic Compliance Gates', () => {
  before(async () => {
    const db = DatabaseAdapter.getInstance();
    await MigrationRunner.migrateUp(db);
    resetAllKillSwitches();
  });

  it('vetoes economically attractive opportunity when hard decline code is present (Two-Stage Independence)', () => {
    // Stage 1: Market proposed ACT due to massive ₹50,000 amount
    const hardOpp: RecoveryOpportunity = {
      id: 'opp_auth_hard_01',
      source: 'real',
      amount_paise: 5000000, // ₹50,000.00
      currency: 'INR',
      reason_code: 'fraudulent_card_stolen',
      decline_type: 'hard',
      attempt_count: 1,
      customer_id: 'cust_fraud_01',
      customer_trust_score: 5,
      created_at: new Date().toISOString(),
      status: 'allocated',
    };

    const economicDecision: AllocationDecision = {
      opportunity_id: hardOpp.id,
      decision: 'ACT',
      rank_in_batch: 1,
      shadow_price_paise_at_decision: 10000,
      reason: 'Top-ranked expected revenue in batch',
    };

    const score: Score = {
      opportunity_id: hardOpp.id,
      natural_recovery_prob: 0.02,
      intervention_recovery_prob: 0.02,
      incremental_prob: 0.00,
      operational_cost_paise: 400,
      fatigue_cost_paise: 0,
      expected_incremental_value_paise: -400,
      confidence: 'high',
    };

    // Stage 2: Action Authority evaluates compliance
    const result = evaluateOpportunity(hardOpp, economicDecision, score);

    assert.equal(result.verdict, 'BLOCKED', 'Compliance MUST veto hard decline regardless of economic proposal');
    assert.match(result.summary_reason, /no auto-contact after a hard\/fraud-coded decline/);

    const hardCheck = result.checks.find((c) => c.check_name === 'hard_decline_check');
    assert.equal(hardCheck?.passed, false);
  });

  it('vetoes opportunity when maximum retry attempt limit (>= 3) is reached', () => {
    const exhaustedOpp: RecoveryOpportunity = {
      id: 'opp_auth_exhausted_02',
      source: 'real',
      amount_paise: 300000,
      currency: 'INR',
      reason_code: 'insufficient_funds',
      decline_type: 'soft',
      attempt_count: 3, // Exhausted
      customer_id: 'cust_exhausted_02',
      customer_trust_score: 80,
      created_at: new Date().toISOString(),
      status: 'allocated',
    };

    const decision: AllocationDecision = {
      opportunity_id: exhaustedOpp.id,
      decision: 'ACT',
      rank_in_batch: 2,
      shadow_price_paise_at_decision: 5000,
      reason: 'Positive IVEN',
    };

    const score: Score = {
      opportunity_id: exhaustedOpp.id,
      natural_recovery_prob: 0.35,
      intervention_recovery_prob: 0.55,
      incremental_prob: 0.20,
      operational_cost_paise: 400,
      fatigue_cost_paise: 750,
      expected_incremental_value_paise: 58850,
      confidence: 'medium',
    };

    const result = evaluateOpportunity(exhaustedOpp, decision, score);
    assert.equal(result.verdict, 'BLOCKED', 'Must block opportunity once retry cap is reached');
    assert.match(result.summary_reason, /retry cap reached/);
  });

  it('authorizes valid opportunity when all deterministic compliance rules pass', () => {
    const validOpp: RecoveryOpportunity = {
      id: 'opp_auth_valid_03',
      source: 'real',
      amount_paise: 400000,
      currency: 'INR',
      reason_code: 'card_expired',
      decline_type: 'soft',
      attempt_count: 1,
      customer_id: 'cust_valid_03',
      customer_trust_score: 90,
      created_at: new Date().toISOString(),
      status: 'allocated',
    };

    const decision: AllocationDecision = {
      opportunity_id: validOpp.id,
      decision: 'ACT',
      rank_in_batch: 1,
      shadow_price_paise_at_decision: 0,
      reason: 'Approved in batch',
    };

    const score: Score = {
      opportunity_id: validOpp.id,
      natural_recovery_prob: 0.05,
      intervention_recovery_prob: 0.60,
      incremental_prob: 0.55,
      operational_cost_paise: 400,
      fatigue_cost_paise: 0,
      expected_incremental_value_paise: 219600,
      confidence: 'high',
    };

    const result = evaluateOpportunity(validOpp, decision, score);
    assert.equal(result.verdict, 'AUTHORIZED');
    assert.ok(result.checks.every((c) => c.passed));
  });
});
