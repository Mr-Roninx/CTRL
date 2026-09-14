process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseAdapter } from '../../src/db/adapter.js';
import { MigrationRunner } from '../../src/db/migrations/runner.js';
import { AuthoritativeReconciler } from '../../src/reconciliation/authoritative_reconciler.js';
import { insertOpportunity, getOpportunityById, upsertExecutionRecord } from '../../src/db/database.js';

describe('V6 Phase 7: Real-Time Reconciliation Accuracy & Out-of-Order Handling', () => {
  before(async () => {
    const db = DatabaseAdapter.getInstance();
    await MigrationRunner.migrateUp(db);
  });

  it('atomically reconciles confirmed paid provider event to RECOVERED and prevents duplicate ledger entries', async () => {
    const oppId = `opp_reconcile_test_${Date.now()}`;
    const linkId = `plink_test_${Date.now()}`;
    const amountPaise = 450000;

    // Insert active executing opportunity
    insertOpportunity({
      id: oppId,
      source: 'real',
      amount_paise: amountPaise,
      currency: 'INR',
      reason_code: 'BAD_REQUEST_PAYMENT_TIMED_OUT',
      decline_type: 'soft',
      attempt_count: 1,
      customer_id: 'cust_reconcile_01',
      customer_trust_score: 85,
      created_at: new Date().toISOString(),
      status: 'executing',
    });

    upsertExecutionRecord({
      opportunity_id: oppId,
      razorpay_payment_link_id: linkId,
      link_url: `https://rzp.io/i/${linkId}`,
      status: 'created',
      idempotency_key: `idem_${oppId}`,
      created_at: new Date().toISOString(),
    });

    // 1. Reconcile with provider payload showing status='paid'
    const result1 = await AuthoritativeReconciler.reconcileOpportunity(oppId, {
      providerPayloadOverride: {
        id: linkId,
        status: 'paid',
        amount: amountPaise,
        amount_paid: amountPaise,
        payments: [{ id: 'pay_rzp_conf_001', status: 'captured', amount: amountPaise }],
      },
    });

    assert.equal(result1.is_recovered, true);
    assert.equal(result1.new_opportunity_status, 'recovered');
    assert.equal(result1.canonical_state, 'PAYMENT_CONFIRMED');

    const oppAfter = getOpportunityById(oppId);
    assert.equal(oppAfter?.status, 'recovered');

    // 2. Repeated reconciliation must be idempotent (no duplicate transitions)
    const result2 = await AuthoritativeReconciler.reconcileOpportunity(oppId, {
      providerPayloadOverride: {
        id: linkId,
        status: 'paid',
        amount: amountPaise,
        amount_paid: amountPaise,
        payments: [{ id: 'pay_rzp_conf_001', status: 'captured', amount: amountPaise }],
      },
    });

    assert.equal(result2.is_idempotent_no_op, true);
    assert.equal(result2.new_opportunity_status, 'recovered');
  });

  it('handles out-of-order events: late payment.failed does NOT overwrite confirmed RECOVERED status', async () => {
    const oppId = `opp_ooo_test_${Date.now()}`;
    const linkId = `plink_ooo_${Date.now()}`;
    const amountPaise = 600000;

    // Insert opportunity already marked RECOVERED
    insertOpportunity({
      id: oppId,
      source: 'real',
      amount_paise: amountPaise,
      currency: 'INR',
      reason_code: 'ISSUER_TIMEOUT',
      decline_type: 'soft',
      attempt_count: 1,
      customer_id: 'cust_ooo_02',
      customer_trust_score: 90,
      created_at: new Date().toISOString(),
      status: 'recovered',
    });

    upsertExecutionRecord({
      opportunity_id: oppId,
      razorpay_payment_link_id: linkId,
      link_url: `https://rzp.io/i/${linkId}`,
      status: 'paid',
      idempotency_key: `idem_${oppId}`,
      created_at: new Date().toISOString(),
    });

    // Reconcile with late-arriving out-of-order failed webhook event
    const oooResult = await AuthoritativeReconciler.reconcileOpportunity(oppId, {
      providerPayloadOverride: {
        id: linkId,
        status: 'failed',
        amount: amountPaise,
        amount_paid: 0,
      },
    });

    // Invariant: recovered state is immutable against out-of-order failure payloads
    const currentOpp = getOpportunityById(oppId);
    assert.equal(currentOpp?.status, 'recovered', 'Late failure event must not overwrite settled recovery');
  });

  it('quarantines partial payments as MISMATCH and refuses to mark RECOVERED', async () => {
    const oppId = `opp_partial_test_${Date.now()}`;
    const linkId = `plink_partial_${Date.now()}`;
    const totalAmount = 500000; // ₹5,000.00
    const partialPaid = 200000; // ₹2,000.00

    insertOpportunity({
      id: oppId,
      source: 'real',
      amount_paise: totalAmount,
      currency: 'INR',
      reason_code: 'INSUFFICIENT_FUNDS',
      decline_type: 'soft',
      attempt_count: 1,
      customer_id: 'cust_partial_03',
      customer_trust_score: 75,
      created_at: new Date().toISOString(),
      status: 'executing',
    });

    upsertExecutionRecord({
      opportunity_id: oppId,
      razorpay_payment_link_id: linkId,
      link_url: `https://rzp.io/i/${linkId}`,
      status: 'partially_paid',
      idempotency_key: `idem_${oppId}`,
      created_at: new Date().toISOString(),
    });

    const result = await AuthoritativeReconciler.reconcileOpportunity(oppId, {
      providerPayloadOverride: {
        id: linkId,
        status: 'partially_paid',
        amount: totalAmount,
        amount_paid: partialPaid,
        payments: [{ id: 'pay_partial_1', status: 'captured', amount: partialPaid }],
      },
    });

    assert.equal(result.is_recovered, false, 'Partial payment must NOT be marked recovered');
    assert.equal(result.canonical_state, 'MISMATCH', 'Must be quarantined in MISMATCH state');
    assert.match(result.rationale, /Partial payment detected/);
  });
});
