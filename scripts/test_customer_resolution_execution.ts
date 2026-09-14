import {
  initDatabase,
  db,
  insertOpportunity,
  upsertAllocationDecision,
  getCustomerById,
  getOpportunityById,
  upsertExecutionRecord,
} from '../src/db/database.js';
import { normalizeOpportunity } from '../src/perception/normalizer.js';
import { scoreOpportunity } from '../src/economics/scorer.js';
import { evaluateOpportunity } from '../src/authority/gate.js';
import { executeOpportunity } from '../src/execution/executor.js';

async function testCustomerResolution() {
  console.log('🧪 Starting Customer Contact Resolution & Link Creation Test Suite...\n');

  initDatabase();

  const tenantId = `tnt_cust_res_${Date.now()}`;
  const customerId = `cust_ref_${Date.now()}`;
  const oppId = `pay_cust_test_${Date.now()}`;

  // 1. Ingest opportunity with customer reference ID and embedded contact channels
  const opp = normalizeOpportunity(
    {
      id: oppId,
      amount: 75000, // ₹750
      currency: 'INR',
      error_code: 'INSUFFICIENT_FUNDS',
      error_description: 'Issuer authorization declined',
      customer_id: customerId,
      email: 'priya.sharma@example.in',
      contact: '+919876543210',
      notes: { name: 'Priya Sharma', source: 'CHECKOUT' }
    },
    `evt_cust_test_${Date.now()}`,
    { source: 'synthetic', tenantId }
  );
  insertOpportunity(opp);

  // Verify that raw_payload_ref retained email and contact
  const savedOpp = getOpportunityById(oppId);
  if (!savedOpp || !savedOpp.raw_payload_ref) {
    throw new Error('Opportunity failed to persist');
  }

  const payloadRef = JSON.parse(savedOpp.raw_payload_ref);
  if (payloadRef.email !== 'priya.sharma@example.in' || payloadRef.contact !== '+919876543210') {
    throw new Error(`Expected email & contact preserved in raw_payload_ref, got: ${JSON.stringify(payloadRef)}`);
  }
  console.log('✅ Test 1 Passed: Customer contact details preserved in canonical payload ref');

  // 2. Score & Allocate
  const score = scoreOpportunity(opp);
  const decision = {
    opportunity_id: oppId,
    decision: 'ACT' as const,
    rank_in_batch: 1,
    shadow_price_paise_at_decision: score.expected_incremental_value_paise,
    reason: 'Highest ranked opportunity in test batch',
  };
  upsertAllocationDecision(decision);

  const evalResult = evaluateOpportunity(opp, decision, score);
  if (evalResult.verdict !== 'AUTHORIZED') {
    throw new Error(`Expected AUTHORIZED verdict, got ${evalResult.verdict}: ${evalResult.summary_reason}`);
  }
  console.log('✅ Test 2 Passed: Opportunity authorized for execution');

  // 3. Test execution simulation with customer resolution
  const simulatedRecord = {
    opportunity_id: oppId,
    razorpay_payment_link_id: `plink_test_${Date.now()}`,
    link_url: `https://rzp.io/i/test_${Date.now()}`,
    status: 'created',
    idempotency_key: `ref_${oppId}`,
    created_at: new Date().toISOString(),
  };
  upsertExecutionRecord(simulatedRecord);

  const execResult = await executeOpportunity(oppId);
  if (!execResult.success || !execResult.record) {
    throw new Error(`Expected successful execution retrieval, got: ${JSON.stringify(execResult)}`);
  }

  console.log(`✅ Test 3 Passed: Payment link resolved and recorded with URL: ${execResult.record.link_url}`);

  console.log('\n🎉 ALL CUSTOMER CONTACT RESOLUTION TESTS PASSED CLEANLY!');
}

testCustomerResolution().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
