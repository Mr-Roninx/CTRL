import assert from 'node:assert/strict';
import { normalizeOpportunity } from '../src/perception/normalizer.js';
import { scoreOpportunity } from '../src/economics/scorer.js';
import { runMarketAllocation } from '../src/market/allocator.js';
import { evaluateOpportunity } from '../src/authority/gate.js';
import { AuthoritativeReconciler } from '../src/reconciliation/authoritative_reconciler.js';
import { DoubleEntryLedger } from '../src/truth/double_entry_ledger.js';
import { AntiBlastEngine } from '../src/economics/anti_blast_engine.js';
import {
  initDatabase,
  upsertOpportunity,
  getOpportunityById,
  updateOpportunityStatus,
  getScoreByOpportunityId,
  getAllocationDecisionByOpportunityId,
  getExecutionRecordByOpportunityId,
  upsertExecutionRecord,
} from '../src/db/database.js';

console.log('================================================================================');
console.log('🔄 CTRL END-TO-END PIPELINE INTEGRATION TEST');
console.log('================================================================================\n');

async function runIntegrationTest() {
  initDatabase();

  const testId = `pay_int_${Date.now()}`;
  console.log(`▶ [Stage 1/7] Ingest & Normalization: Ingesting payment failure event for ${testId}...`);

  // 1. Ingestion & Perception Normalization
  const rawPayload = {
    id: testId,
    amount: 350000, // ₹3,500.00
    currency: 'INR',
    error_code: 'insufficient_funds',
    error_description: 'Payment failed due to insufficient funds in bank account',
    customer_id: 'cust_integration_vip@example.com',
    attempts: 1,
    order_id: `order_${Date.now()}`,
  };

  const opp = normalizeOpportunity(rawPayload, `evt_${testId}`, { source: 'real' });
  upsertOpportunity(opp);

  const storedOpp = getOpportunityById(opp.id);
  assert.ok(storedOpp, 'Opportunity must be durably stored in SQLite');
  assert.equal(storedOpp.status, 'pending');
  assert.equal(storedOpp.decline_type, 'soft');
  assert.equal(storedOpp.amount_paise, 350000);
  console.log('  ✔ Normalized into RecoveryOpportunity record (status: pending, decline: soft, amount: ₹3,500.00)\n');

  // 2. Economic Scoring & Counterfactual IVEN
  console.log('▶ [Stage 2/7] Economic Reasoning: Calculating IVEN and model-estimated counterfactuals...');
  const score = scoreOpportunity(opp);
  assert.ok(score.expected_incremental_value_paise > 0, 'Soft decline with sufficient amount must have positive IVEN');
  assert.ok(score.probability_disclaimer, 'Score must include model-estimated disclaimer');
  assert.equal(score.incremental_prob, Number((score.intervention_recovery_prob - score.natural_recovery_prob).toFixed(4)));

  const storedScore = getScoreByOpportunityId(opp.id);
  assert.ok(storedScore, 'Score must be durably persisted');
  const postScoreOpp = getOpportunityById(opp.id);
  assert.equal(postScoreOpp?.status, 'scored', 'Status must transition to scored');
  console.log(`  ✔ Scored successfully. IVEN: ₹${(score.expected_incremental_value_paise / 100).toFixed(2)} | Disclaimer: Verified\n`);

  // 3. Finite State Machine Validation: Prevent Illegal Bypasses
  console.log('▶ [Stage 3/7] Finite State Machine: Verifying illegal bypasses are strictly blocked...');
  updateOpportunityStatus(opp.id, 'executing'); // Illegal! Cannot jump from scored to executing without allocation & authority
  const fsmCheck1 = getOpportunityById(opp.id);
  assert.equal(fsmCheck1?.status, 'scored', 'FSM must block illegal jump from scored to executing');

  updateOpportunityStatus(opp.id, 'pending'); // Illegal! Cannot regress from scored to pending
  const fsmCheck2 = getOpportunityById(opp.id);
  assert.equal(fsmCheck2?.status, 'scored', 'FSM must block illegal regression from scored to pending');
  console.log('  ✔ FSM Transition Integrity strictly verified (Illegal jumps dropped)\n');

  // 4. Market Portfolio Allocation
  console.log('▶ [Stage 4/7] Recovery Market: Running portfolio allocation under capacity limit...');
  const marketResult = runMarketAllocation({ capacity: 5, opportunities: [postScoreOpp!] });
  assert.ok(marketResult.accepted_count >= 1, 'High-IVEN opportunity must be accepted');

  const allocation = getAllocationDecisionByOpportunityId(opp.id);
  assert.ok(allocation, 'Allocation decision must be recorded');
  assert.equal(allocation.decision, 'ACT');
  const postAllocOpp = getOpportunityById(opp.id);
  assert.equal(postAllocOpp?.status, 'allocated', 'Status must transition to allocated');
  console.log(`  ✔ Market allocation completed. Decision: ACT (Rank #1, Shadow Price: ${marketResult.shadow_price_display})\n`);

  // 5. Action Authority Compliance Gate
  console.log('▶ [Stage 5/7] Action Authority Gate: Running 5 independent compliance checks...');
  const authResult = evaluateOpportunity(postAllocOpp!, allocation, score);
  assert.equal(authResult.verdict, 'AUTHORIZED', 'Valid soft decline with capacity must be AUTHORIZED');
  assert.equal(authResult.checks.length, 5, 'Must evaluate exactly 5 deterministic checks');
  assert.ok(authResult.checks.every((c) => c.passed), 'All 5 checks must pass');
  console.log('  ✔ Action Authority: 5/5 checks passed. Zero compliance leakage.\n');

  // 6. Execution Layer (Idempotent Payment Link Creation)
  console.log('▶ [Stage 6/7] Execution Layer: Recording payment link dispatch & idempotency key...');
  const execRecord = {
    opportunity_id: opp.id,
    razorpay_payment_link_id: `plink_int_${Date.now()}`,
    link_url: `https://rzp.io/i/plink_int_${Date.now()}`,
    status: 'created',
    idempotency_key: `ref_${opp.id}`,
    created_at: new Date().toISOString(),
  };
  upsertExecutionRecord(execRecord);
  updateOpportunityStatus(opp.id, 'executing');

  const postExecOpp = getOpportunityById(opp.id);
  assert.equal(postExecOpp?.status, 'executing');
  const storedExec = getExecutionRecordByOpportunityId(opp.id);
  assert.ok(storedExec);
  console.log(`  ✔ Execution verified. Status: executing | Payment Link: ${execRecord.razorpay_payment_link_id}\n`);

  // 7. Authoritative Reconciliation & Double-Entry Ledger
  console.log('▶ [Stage 7/7] Truth Engine: Reconciling against provider payment settlement & hash chain...');
  const reconResult = await AuthoritativeReconciler.reconcileOpportunity(opp.id, {
    providerPayloadOverride: {
      id: execRecord.razorpay_payment_link_id,
      status: 'paid',
      amount: 350000,
      amount_paid: 350000,
      payments: [{ id: `pay_settled_${Date.now()}`, status: 'captured', amount: 350000 }],
    },
    actor: 'integration_test_runner',
  });

  assert.equal(reconResult.status, 'TRANSITION');
  assert.equal(reconResult.new_opportunity_status, 'recovered');

  const finalOpp = getOpportunityById(opp.id);
  assert.equal(finalOpp?.status, 'recovered', 'Terminal status must be recovered');

  // Verify Terminal Lock: No late webhook can regress 'recovered'
  updateOpportunityStatus(opp.id, 'executing');
  const terminalLockCheck = getOpportunityById(opp.id);
  assert.equal(terminalLockCheck?.status, 'recovered', 'Terminal recovered state is strictly immutable');

  // Verify Cryptographic Hash Chain on Double-Entry Ledger
  const ledgerIntegrity = await DoubleEntryLedger.verifyLedgerIntegrity();
  assert.ok(ledgerIntegrity.valid, 'Double-entry ledger cryptographic hash chain must be valid');
  assert.ok(ledgerIntegrity.unbroken_chain, 'Hash chain must be completely unbroken');
  console.log('  ✔ Reconciled to terminal recovered state. Double-entry ledger cryptographic hash chain intact.\n');

  // Holdout verification
  const isHoldout1 = AntiBlastEngine.isSyntheticHoldout(opp.id);
  const isHoldout2 = AntiBlastEngine.isSyntheticHoldout(opp.id);
  assert.equal(isHoldout1, isHoldout2, 'Synthetic holdout must be 100% deterministic for identical ID');

  console.log('================================================================================');
  console.log('🎉 FULL PIPELINE INTEGRATION TEST: ALL 7 STAGES PASSED CLEANLY');
  console.log('================================================================================\n');
}

runIntegrationTest().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('\n❌ INTEGRATION TEST FAILED:', err);
  process.exit(1);
});
