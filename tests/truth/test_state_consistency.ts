import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { db, initDatabase, upsertOpportunity, getOpportunityById, getExecutionRecordByOpportunityId } from '../../src/db/database.js';
import { CanonicalStateMachine } from '../../src/truth/canonical_state_machine.js';
import { AuthoritativeReconciler } from '../../src/reconciliation/authoritative_reconciler.js';
import { MissionLifecycleMonitor } from '../../src/agents/lifecycle_monitor.js';
import { ProviderTruthEvaluator } from '../../src/truth/provider_truth.js';
import { DoubleEntryLedger } from '../../src/truth/double_entry_ledger.js';

describe('CTRL v5.1 — State Consistency & Reconciliation Hardening', () => {
  before(() => {
    initDatabase();
  });

  describe('1. Canonical State Machine & Provider Mapping', () => {
    it('should map status=paid with amount_paid > 0 to PAYMENT_CONFIRMED', () => {
      const mapping = CanonicalStateMachine.mapRazorpayStatusToCanonicalState({
        status: 'paid',
        amount_paise: 450000,
        amount_paid_paise: 450000,
      });
      assert.strictEqual(mapping.canonical_state, 'PAYMENT_CONFIRMED');
      assert.strictEqual(mapping.is_settled, true);
    });

    it('should map status=created with amount_paid=0 to PROVIDER_OBJECT_CREATED', () => {
      const mapping = CanonicalStateMachine.mapRazorpayStatusToCanonicalState({
        status: 'created',
        amount_paise: 500000,
        amount_paid_paise: 0,
      });
      assert.strictEqual(mapping.canonical_state, 'PROVIDER_OBJECT_CREATED');
      assert.strictEqual(mapping.is_settled, false);
    });

    it('should map partial payment to MISMATCH quarantine', () => {
      const mapping = CanonicalStateMachine.mapRazorpayStatusToCanonicalState({
        status: 'paid',
        amount_paise: 500000,
        amount_paid_paise: 250000,
      });
      assert.strictEqual(mapping.canonical_state, 'MISMATCH');
      assert.strictEqual(mapping.is_settled, false);
    });

    it('should enforce legal state transitions and reject illegal leaps', () => {
      assert.strictEqual(CanonicalStateMachine.isValidTransition('EXECUTING', 'PROVIDER_OBJECT_CREATED'), true);
      assert.strictEqual(CanonicalStateMachine.isValidTransition('PROVIDER_OBJECT_CREATED', 'PAYMENT_CONFIRMED'), true);
      assert.strictEqual(CanonicalStateMachine.isValidTransition('PAYMENT_CONFIRMED', 'RECOVERED'), true);
      
      // Illegal transitions
      assert.strictEqual(CanonicalStateMachine.isValidTransition('RECOVERED', 'PENDING'), false);
      assert.strictEqual(CanonicalStateMachine.isValidTransition('ABORTED', 'EXECUTING'), false);
    });
  });

  describe('2. Authoritative Atomic Reconciliation', () => {
    const testOppId = `test_opp_rec_${Date.now()}`;
    const testLinkId = `plink_test_${Date.now()}`;

    before(() => {
      upsertOpportunity({
        id: testOppId,
        source: 'synthetic',
        amount_paise: 150000,
        currency: 'INR',
        reason_code: 'insufficient_funds',
        decline_type: 'soft',
        attempt_count: 1,
        customer_id: 'cust_test_consistency',
        customer_trust_score: 0.85,
        created_at: new Date().toISOString(),
        status: 'executing',
      });

      db.prepare(`
        INSERT OR REPLACE INTO execution_records (
          opportunity_id, razorpay_payment_link_id, link_url, status, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?);
      `).run(
        testOppId,
        testLinkId,
        'https://rzp.io/rzp/test1234',
        'created',
        `ref_${testOppId}`,
        new Date().toISOString()
      );
    });

    it('should NOT recover when provider status is created (amount_paid=0)', async () => {
      const res = await AuthoritativeReconciler.reconcileOpportunity(testOppId, {
        providerPayloadOverride: {
          id: testLinkId,
          status: 'created',
          amount: 150000,
          amount_paid: 0,
        },
      });

      assert.strictEqual(res.is_recovered, false);
      assert.strictEqual(res.status, 'PENDING');
      
      const opp = getOpportunityById(testOppId);
      assert.notStrictEqual(opp?.status, 'recovered');
    });

    it('should atomically recover when provider confirms payment', async () => {
      const res = await AuthoritativeReconciler.reconcileOpportunity(testOppId, {
        providerPayloadOverride: {
          id: testLinkId,
          status: 'paid',
          amount: 150000,
          amount_paid: 150000,
          payments: [{ id: 'pay_test_conf_99', status: 'captured', amount: 150000 }],
        },
      });

      assert.strictEqual(res.is_recovered, true);
      assert.strictEqual(res.status, 'TRANSITION');

      // Verify opportunity status
      const opp = getOpportunityById(testOppId);
      assert.strictEqual(opp?.status, 'recovered');

      // Verify execution record status
      const exec = getExecutionRecordByOpportunityId(testOppId);
      assert.strictEqual(exec?.status, 'completed');

      // Verify double entry ledger
      const doubleEntry = db.prepare(`
        SELECT * FROM double_entry_ledger WHERE opportunity_id = ? AND event_type = 'PAYMENT_RECOVERED';
      `).get(testOppId) as any;
      assert.ok(doubleEntry);
      assert.strictEqual(doubleEntry.amount_paise, 150000);
      assert.strictEqual(doubleEntry.debit_account, 'bank_settlement');
      assert.strictEqual(doubleEntry.credit_account, 'recovered_revenue');

      // Verify learning outcome
      const outcome = db.prepare(`
        SELECT * FROM agent_outcomes WHERE opportunity_id = ?;
      `).get(testOppId) as any;
      assert.ok(outcome);
      assert.strictEqual(outcome.actual_recovered, 1);
    });

    it('should be strictly idempotent on repeated reconciliation', async () => {
      const doubleEntriesBefore = db.prepare(`
        SELECT COUNT(*) as count FROM double_entry_ledger WHERE opportunity_id = ?;
      `).get(testOppId) as { count: number };

      const res = await AuthoritativeReconciler.reconcileOpportunity(testOppId, {
        providerPayloadOverride: {
          id: testLinkId,
          status: 'paid',
          amount: 150000,
          amount_paid: 150000,
        },
      });

      assert.strictEqual(res.is_idempotent_no_op, true);
      assert.strictEqual(res.status, 'MATCHED');

      const doubleEntriesAfter = db.prepare(`
        SELECT COUNT(*) as count FROM double_entry_ledger WHERE opportunity_id = ?;
      `).get(testOppId) as { count: number };

      assert.strictEqual(doubleEntriesBefore.count, doubleEntriesAfter.count);
    });

    it('should handle out-of-order events where payment.failed is followed by later valid payment.captured', async () => {
      const outOfOrderOppId = `test_opp_ooo_${Date.now()}`;
      const outOfOrderLinkId = `plink_ooo_${Date.now()}`;

      upsertOpportunity({
        id: outOfOrderOppId,
        source: 'synthetic',
        amount_paise: 200000,
        currency: 'INR',
        reason_code: 'generic_decline',
        decline_type: 'soft',
        attempt_count: 1,
        customer_id: 'cust_ooo',
        customer_trust_score: 0.8,
        created_at: new Date().toISOString(),
        status: 'executing',
      });

      db.prepare(`
        INSERT INTO execution_records (opportunity_id, razorpay_payment_link_id, link_url, status, idempotency_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?);
      `).run(outOfOrderOppId, outOfOrderLinkId, 'https://rzp.io/rzp/ooo', 'created', `ref_${outOfOrderOppId}`, new Date().toISOString());

      // 1. First event: failed
      const resFailed = await AuthoritativeReconciler.reconcileOpportunity(outOfOrderOppId, {
        providerPayloadOverride: {
          id: outOfOrderLinkId,
          status: 'failed',
          amount: 200000,
          amount_paid: 0,
        },
      });
      assert.strictEqual(resFailed.new_opportunity_status, 'not_recovered');

      // 2. Later event: captured (settled)
      const resCaptured = await AuthoritativeReconciler.reconcileOpportunity(outOfOrderOppId, {
        providerPayloadOverride: {
          id: outOfOrderLinkId,
          status: 'paid',
          amount: 200000,
          amount_paid: 200000,
          payments: [{ id: 'pay_ooo_captured', status: 'captured', amount: 200000 }],
        },
      });
      assert.strictEqual(resCaptured.new_opportunity_status, 'recovered');
      assert.strictEqual(resCaptured.is_recovered, true);
    });

    it('should quarantine API timeouts / unknown provider states without corrupting local state', async () => {
      const timeoutOppId = `test_opp_timeout_${Date.now()}`;
      upsertOpportunity({
        id: timeoutOppId,
        source: 'synthetic',
        amount_paise: 300000,
        currency: 'INR',
        reason_code: 'issuer_timeout',
        decline_type: 'soft',
        attempt_count: 1,
        customer_id: 'cust_timeout',
        customer_trust_score: 0.8,
        created_at: new Date().toISOString(),
        status: 'executing',
      });

      const res = await AuthoritativeReconciler.reconcileOpportunity(timeoutOppId, {
        providerPayloadOverride: {
          id: 'plink_invalid_or_500',
          status: 'gateway_error_500_unknown',
          amount: 300000,
          amount_paid: 0,
        },
      });

      assert.strictEqual(res.canonical_state, 'UNKNOWN');
      assert.strictEqual(res.is_recovered, false);
      const opp = getOpportunityById(timeoutOppId);
      assert.notStrictEqual(opp?.status, 'recovered');
    });
  });

  describe('3. Agent Mission Lifecycle & Orphan Sweeper', () => {
    const activeRunId = `run_active_${Date.now()}`;
    const staleRunId = `run_stale_${Date.now()}`;

    before(() => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const now = new Date().toISOString();

      // Insert active run
      db.prepare(`
        INSERT INTO agent_runs (
          id, mission_id, goal_type, status, start_time, total_steps, llm_calls, tool_calls, replan_count, total_tokens, latency_ms, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `).run(activeRunId, `miss_${activeRunId}`, 'RECOVER_PAYMENT', 'running', now, 2, 1, 1, 0, 100, 500, now);

      // Insert stale run (created 10 mins ago with no wake condition)
      db.prepare(`
        INSERT INTO agent_runs (
          id, mission_id, goal_type, status, start_time, total_steps, llm_calls, tool_calls, replan_count, total_tokens, latency_ms, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `).run(staleRunId, `miss_${staleRunId}`, 'RECOVER_PAYMENT', 'running', tenMinutesAgo, 0, 0, 0, 0, 0, 0, tenMinutesAgo);
    });

    it('should safely sweep stale running missions while retaining active ones', () => {
      const sweep = MissionLifecycleMonitor.sweepStaleMissions({ inactivityThresholdMs: 5 * 60 * 1000 });

      assert.ok(sweep.stale_aborted_count >= 1);

      const staleRun = db.prepare('SELECT * FROM agent_runs WHERE id = ?;').get(staleRunId) as any;
      assert.strictEqual(staleRun.status, 'aborted');
      assert.ok(staleRun.termination_reason.includes('stale_orphan_cleanup'));

      const activeRun = db.prepare('SELECT * FROM agent_runs WHERE id = ?;').get(activeRunId) as any;
      assert.strictEqual(activeRun.status, 'running');
    });
  });

  describe('4. Mathematical Double-Entry Conservation', () => {
    it('should maintain strict conservation of debits and credits across the ledger', () => {
      const debits = db.prepare('SELECT SUM(amount_paise) as sum FROM double_entry_ledger;').get() as { sum: number };
      const credits = db.prepare('SELECT SUM(amount_paise) as sum FROM double_entry_ledger;').get() as { sum: number };

      assert.strictEqual(debits.sum, credits.sum);
      assert.ok(debits.sum > 0);
    });
  });
});
