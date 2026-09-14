process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseAdapter } from '../../src/db/adapter.js';
import { MigrationRunner } from '../../src/db/migrations/runner.js';
import { PerceptionAgent } from '../../src/agents/specialists/perception_agent.js';
import { StrategyAgent } from '../../src/agents/specialists/strategy_agent.js';
import { OutreachAgent } from '../../src/agents/specialists/outreach_agent.js';
import { ComplianceCopilot } from '../../src/agents/specialists/compliance_copilot.js';
import { MerchantCopilot } from '../../src/agents/specialists/merchant_copilot.js';
import {
  insertOpportunity,
  upsertScore,
  upsertAllocationDecision,
  insertAuthorityCheck,
} from '../../src/db/database.js';
import { RecoveryOpportunity } from '../../src/types/index.js';

describe('V6 Phase 11: Specialist Agent Capabilities & Zero Financial Authority', () => {
  before(async () => {
    const db = DatabaseAdapter.getInstance();
    await MigrationRunner.migrateUp(db);
  });

  const sampleOpp: RecoveryOpportunity = {
    id: `opp_spec_test_${Date.now()}`,
    source: 'real',
    amount_paise: 450000,
    currency: 'INR',
    reason_code: 'bad_request_payment_card_expired',
    decline_type: 'soft',
    attempt_count: 1,
    customer_id: 'cust_spec_01@example.com',
    customer_trust_score: 85,
    created_at: new Date().toISOString(),
    status: 'pending',
  };

  it('1. PerceptionAgent: accurately analyzes failure semantics and customer profile', async () => {
    insertOpportunity(sampleOpp);

    const perception = await PerceptionAgent.analyzeOpportunity({
      runId: 'run_spec_01',
      opportunity: sampleOpp,
    });

    assert.equal(perception.opportunity_id, sampleOpp.id);
    assert.ok(perception.failure_intent.length > 0);
    assert.ok(perception.customer_urgency_score > 0);
    assert.ok(perception.confidence >= 0.80);
  });

  it('2. StrategyAgent: evaluates strategy calibration safely based on empirical evidence', async () => {
    const strategy = await StrategyAgent.evaluateStrategyCalibration({
      runId: 'run_spec_02',
      opportunityId: sampleOpp.id,
    });

    assert.ok(strategy.statistics !== undefined);
    assert.ok(strategy.message.length > 0);
  });

  it('3. OutreachAgent: drafts customer communications in PENDING_REVIEW status', async () => {
    const draft = await OutreachAgent.draftCustomerCommunication({
      runId: 'run_spec_03',
      opportunity: sampleOpp,
      channel: 'EMAIL',
    });

    assert.equal(draft.opportunity_id, sampleOpp.id);
    assert.equal(draft.channel, 'EMAIL');
    assert.equal(draft.status, 'PENDING_REVIEW');
    assert.ok(draft.body.includes('4500.00'));
    assert.ok(draft.compliance_footer.includes('CTRL'));
  });

  it('4. ComplianceCopilot: provides structured explanations of Action Authority compliance rules', async () => {
    upsertScore({
      opportunity_id: sampleOpp.id,
      natural_recovery_prob: 0.05,
      intervention_recovery_prob: 0.60,
      incremental_prob: 0.55,
      operational_cost_paise: 400,
      fatigue_cost_paise: 0,
      expected_incremental_value_paise: 247100,
      confidence: 'high',
    });

    upsertAllocationDecision({
      opportunity_id: sampleOpp.id,
      decision: 'ACT',
      rank_in_batch: 1,
      shadow_price_paise_at_decision: 0,
      reason: 'Approved in batch',
    });

    insertAuthorityCheck({
      opportunity_id: sampleOpp.id,
      check_name: 'hard_decline_check',
      passed: true,
      reason: 'Soft decline',
    });

    const explanation = await ComplianceCopilot.explainOpportunity({
      runId: 'run_spec_04',
      opportunityId: sampleOpp.id,
    });

    assert.equal(explanation.audit_verified, true);
    assert.ok(explanation.claims.length >= 4);
    assert.ok(explanation.structured_summary.economic_rationale.length > 0);
    assert.ok(explanation.structured_summary.authority_compliance_rationale.length > 0);
  });

  it('5. MerchantCopilot: answers merchant operational queries regarding capacity and shadow price', async () => {
    const answer = await MerchantCopilot.answerMerchantQuery({
      runId: 'run_spec_05',
      query: 'What is the current recovery market capacity and shadow price?',
    });

    assert.ok(answer.answer.includes('capacity'));
    assert.ok(answer.supporting_data !== undefined);
  });

  it('INVARIANT: All 5 specialists strictly lack financial execution authority', () => {
    assert.equal((PerceptionAgent as any).createPaymentLink, undefined);
    assert.equal((StrategyAgent as any).executePayment, undefined);
    assert.equal((OutreachAgent as any).sendDirectPayment, undefined);
    assert.equal((ComplianceCopilot as any).markRecovered, undefined);
    assert.equal((MerchantCopilot as any).executeTransfer, undefined);
  });
});
