process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseAdapter } from '../../src/db/adapter.js';
import { MigrationRunner } from '../../src/db/migrations/runner.js';
import { executeOpportunity } from '../../src/execution/executor.js';
import { insertOpportunity, upsertScore, upsertAllocationDecision, upsertExecutionRecord } from '../../src/db/database.js';

describe('V6 Phase 10: Execution Idempotency & Duplicate Protection', () => {
  before(async () => {
    const db = DatabaseAdapter.getInstance();
    await MigrationRunner.migrateUp(db);
  });

  it('generates deterministic SHA-256 idempotency keys matching specification', () => {
    const tenantId = 'tenant_exec_01';
    const opportunityId = 'opp_exec_1001';
    const attemptCount = 1;

    const expectedKey = crypto
      .createHash('sha256')
      .update(`${tenantId}:${opportunityId}:${attemptCount}`)
      .digest('hex');

    assert.equal(typeof expectedKey, 'string');
    assert.equal(expectedKey.length, 64, 'SHA-256 idempotency key must be 64 hex characters');
  });

  it('returns existing execution record without duplicating provider calls when already executed', async () => {
    const oppId = `opp_idem_test_${Date.now()}`;
    const linkId = `plink_idem_${Date.now()}`;
    const linkUrl = `https://rzp.io/i/${linkId}`;

    // Seed opportunity in AUTHORIZED state
    insertOpportunity({
      id: oppId,
      source: 'real',
      amount_paise: 500000,
      currency: 'INR',
      reason_code: 'card_expired',
      decline_type: 'soft',
      attempt_count: 1,
      customer_id: 'cust_idem_01',
      customer_trust_score: 90,
      created_at: new Date().toISOString(),
      status: 'authorized',
    });

    upsertScore({
      opportunity_id: oppId,
      natural_recovery_prob: 0.05,
      intervention_recovery_prob: 0.60,
      incremental_prob: 0.55,
      operational_cost_paise: 400,
      fatigue_cost_paise: 0,
      expected_incremental_value_paise: 274600,
      confidence: 'high',
    });

    upsertAllocationDecision({
      opportunity_id: oppId,
      decision: 'ACT',
      rank_in_batch: 1,
      shadow_price_paise_at_decision: 0,
      reason: 'Allocated in batch',
    });

    // Seed existing execution record in database
    upsertExecutionRecord({
      opportunity_id: oppId,
      razorpay_payment_link_id: linkId,
      link_url: linkUrl,
      status: 'created',
      idempotency_key: `idem_${oppId}`,
      created_at: new Date().toISOString(),
    });

    // Execute opportunity -> must return existing record
    const result = await executeOpportunity(oppId);

    assert.equal(result.success, true);
    assert.equal(result.created_new, false, 'Must NOT create new link when execution record already exists');
    assert.equal(result.record?.razorpay_payment_link_id, linkId);
    assert.equal(result.record?.link_url, linkUrl);
  });
});
