process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseAdapter } from '../../src/db/adapter.js';
import { MigrationRunner } from '../../src/db/migrations/runner.js';
import {
  evaluateOpportunity,
  setKillSwitch,
  setTenantKillSwitch,
  setProviderKillSwitch,
  resetAllKillSwitches,
  isKillSwitchActive,
} from '../../src/authority/gate.js';
import { RecoveryOpportunity, AllocationDecision, Score } from '../../src/types/index.js';

describe('V6 Phase 9: Kill Switch Safety & Multi-Level Controls', () => {
  before(async () => {
    const db = DatabaseAdapter.getInstance();
    await MigrationRunner.migrateUp(db);
  });

  beforeEach(() => {
    resetAllKillSwitches();
  });

  const testOpp: RecoveryOpportunity = {
    id: 'opp_kill_test_01',
    source: 'real',
    amount_paise: 500000,
    currency: 'INR',
    reason_code: 'card_expired',
    decline_type: 'soft',
    attempt_count: 1,
    customer_id: 'cust_kill_01',
    customer_trust_score: 95,
    created_at: new Date().toISOString(),
    status: 'allocated',
  };

  const testDecision: AllocationDecision = {
    opportunity_id: testOpp.id,
    decision: 'ACT',
    rank_in_batch: 1,
    shadow_price_paise_at_decision: 0,
    reason: 'Approved',
  };

  const testScore: Score = {
    opportunity_id: testOpp.id,
    natural_recovery_prob: 0.05,
    intervention_recovery_prob: 0.60,
    incremental_prob: 0.55,
    operational_cost_paise: 400,
    fatigue_cost_paise: 0,
    expected_incremental_value_paise: 274600,
    confidence: 'high',
  };

  it('global kill switch instantly blocks execution of all allocated opportunities', () => {
    // Normal operation -> AUTHORIZED
    const normalResult = evaluateOpportunity(testOpp, testDecision, testScore);
    assert.equal(normalResult.verdict, 'AUTHORIZED');

    // Engage global kill switch
    setKillSwitch(true);
    assert.equal(isKillSwitchActive(), true);

    // Re-evaluate -> BLOCKED
    const killResult = evaluateOpportunity(testOpp, testDecision, testScore);
    assert.equal(killResult.verdict, 'BLOCKED');
    assert.match(killResult.summary_reason, /kill switch engaged/);

    // Disengage kill switch -> immediately restored
    setKillSwitch(false);
    assert.equal(isKillSwitchActive(), false);
    const restoredResult = evaluateOpportunity(testOpp, testDecision, testScore);
    assert.equal(restoredResult.verdict, 'AUTHORIZED');
  });

  it('supports granular per-tenant and per-provider kill switches', () => {
    const tenantA = 'tenant_alpha';
    const tenantB = 'tenant_beta';

    // Tenant Alpha kill switch engaged
    setTenantKillSwitch(tenantA, true);
    assert.equal(isKillSwitchActive(tenantA), true);
    assert.equal(isKillSwitchActive(tenantB), false);

    // Provider kill switch engaged for stripe only
    setProviderKillSwitch('stripe', true);
    assert.equal(isKillSwitchActive(tenantB, 'stripe'), true);
    assert.equal(isKillSwitchActive(tenantB, 'razorpay'), false);
  });
});
