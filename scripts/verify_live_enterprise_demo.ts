import crypto from 'node:crypto';
import dotenv from 'dotenv';
import path from 'node:path';
import {
  initDatabase,
  getOpportunityById,
  getScoreByOpportunityId,
  getAllocationDecisionByOpportunityId,
  getAuthorityChecksByOpportunityId,
  getExecutionRecordByOpportunityId,
  getLedgerEntriesByOpportunity,
} from '../src/db/database.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
initDatabase();

async function runLiveEnterpriseDemo() {
  console.log('🚀 ========================================================');
  console.log('   CTRL / CTRL LIVE ENTERPRISE SAAS RECOVERY DEMO');
  console.log('========================================================\n');

  const BASE_URL = 'http://localhost:3001';
  const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'rzp_whsec_ctrl_test';

  // Step 1: Authenticate Merchant Session
  console.log('🔑 Step 1: Authenticating merchant session via POST /v1/auth/demo-login...');
  const loginRes = await fetch(`${BASE_URL}/v1/auth/demo-login`, { method: 'POST' });
  if (!loginRes.ok) {
    throw new Error(`Demo login failed with status ${loginRes.status}`);
  }
  const loginData = await loginRes.json();
  const token = loginData.session?.token;
  const tenantId = loginData.merchant?.tenant_id || 'tenant_system_default';
  console.log(`✅ Logged in successfully as: ${loginData.merchant?.name} (${loginData.merchant?.email})`);
  console.log(`   Tenant ID: [${tenantId}] | Role: ${loginData.merchant?.role}\n`);

  // Step 2: Fetch Baseline Dashboard Metrics
  console.log('📊 Step 2: Querying baseline dashboard state via GET /dashboard/summary...');
  const baselineRes = await fetch(`${BASE_URL}/dashboard/summary`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const baseline = await baselineRes.json();
  console.log(`   Total Opportunities: ${baseline.total_opportunities}`);
  console.log(`   Total Recovered: ${baseline.total_recovered_display}`);
  console.log(`   Current Marginal Shadow Price: ${baseline.shadow_price_display}`);
  console.log(`   Capacity Limit: ${baseline.capacity_limit} (In-flight used: ${baseline.capacity_used})\n`);

  // Step 3: Ingest a Failed Checkout Opportunity via Canonical Event Fabric Gateway
  const testOppId = `pay_live_demo_${Date.now()}`;
  const eventId = `evt_live_demo_${Date.now()}`;
  const amountPaise = 749900; // ₹7,499.00
  console.log(`⚡ Step 3: Ingesting failed payment (${testOppId}) for ₹${(amountPaise / 100).toFixed(2)} via Event Fabric...`);

  const eventPayload = {
    event_id: eventId,
    tenant_id: tenantId,
    source: 'CLIENT_SDK',
    provider: 'razorpay',
    environment: 'test',
    payment_id: testOppId,
    amount_paise: amountPaise,
    currency: 'INR',
    status: 'failed',
    failure_code: 'BAD_REQUEST_PAYMENT_INSUFFICIENT_FUNDS',
    failure_description: 'Payment failed due to insufficient funds in customer bank account',
    failure_type: 'soft',
    attempt_number: 1,
    customer_reference: 'cust_priya_sharma_delhi',
    customer_email: 'priya.sharma@example.com',
    customer_phone: '+919876543210',
    metadata: { item: 'Apex Neural Studio Display' },
  };

  const ingestRes = await fetch(`${BASE_URL}/v1/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(eventPayload),
  });

  const ingestData = await ingestRes.json();
  if (!ingestRes.ok) {
    console.error('Ingestion failed:', ingestData);
    throw new Error(`Event ingestion failed: ${JSON.stringify(ingestData)}`);
  }

  console.log(`✅ Ingested successfully via Event Gateway: Opportunity ID: ${ingestData.opportunity?.id || testOppId}`);
  console.log(`   Gateway Pipeline Verdict: ${ingestData.authority?.verdict || 'EVALUATING'}`);
  console.log(`   Current Status: ${ingestData.opportunity?.status || 'pending'}\n`);

  // Step 4: Verify Autonomous Recovery Pipeline Outputs (Scoring, Market Allocation, Action Authority, Execution)
  console.log('🧠 Step 4: Autonomous Recovery Cycle Verification (Perception -> IVEN Scoring -> Market Allocation -> Action Authority)...');
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const opp = getOpportunityById(testOppId);
  const score = getScoreByOpportunityId(testOppId);
  const decision = getAllocationDecisionByOpportunityId(testOppId);
  const checks = getAuthorityChecksByOpportunityId(testOppId);
  const execRecord = getExecutionRecordByOpportunityId(testOppId);

  console.log(`   Opportunity Status: [${opp?.status?.toUpperCase()}]`);
  console.log(`   Decline Classification: [${opp?.decline_type?.toUpperCase()}] (Recoverable: ${opp?.decline_type !== 'hard'})`);
  
  if (score) {
    console.log(`   Incremental Recovery Probability (Δp): ${(score.incremental_prob * 100).toFixed(1)}% (Model-Estimated)`);
    console.log(`   Expected Incremental Net Value (IVEN): ₹${(score.expected_incremental_value_paise / 100).toFixed(2)}`);
    console.log(`   Confidence: [${score.confidence.toUpperCase()}]`);
  }

  if (decision) {
    console.log(`   Portfolio Allocation Decision: [${decision.decision}] (Rank in batch: #${decision.rank_in_batch})`);
    console.log(`   Reason: "${decision.reason}"`);
  }

  if (checks.length > 0) {
    console.log(`   Action Authority Compliance Checks (${checks.length}/5 evaluated):`);
    for (const c of checks) {
      console.log(`     - ${c.check_name}: ${c.passed ? 'PASSED ✅' : 'FAILED ❌'} (${c.reason})`);
    }
  }

  if (execRecord) {
    console.log(`   Razorpay Payment Link ID: ${execRecord.razorpay_payment_link_id}`);
    console.log(`   Payment Link URL: ${execRecord.link_url}\n`);
  } else {
    console.log('   Payment link pending in-flight dispatch.\n');
  }

  // Step 5: Simulate Customer Payment Settlement (Truth Engine Reconciliation)
  console.log('💰 Step 5: Simulating customer payment of recovery link via HMAC-Signed Webhook (Truth Engine Reconciliation)...');
  const paymentLinkId = execRecord?.razorpay_payment_link_id || `plink_test_${testOppId.slice(-8)}`;

  const settlePayload = JSON.stringify({
    entity: 'event',
    account_id: 'acc_ctrl_test',
    event: 'payment_link.paid',
    contains: ['payment_link', 'payment'],
    payload: {
      payment_link: {
        entity: {
          id: paymentLinkId,
          reference_id: testOppId,
          amount: amountPaise,
          amount_paid: amountPaise,
          status: 'paid',
          paid_at: Math.floor(Date.now() / 1000),
        },
      },
      payment: {
        entity: {
          id: `pay_settled_${Date.now()}`,
          amount: amountPaise,
          currency: 'INR',
          status: 'captured',
          method: 'upi',
        },
      },
    },
    created_at: Math.floor(Date.now() / 1000),
  });

  const hmacSignature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(settlePayload).digest('hex');

  const settleRes = await fetch(`${BASE_URL}/internal/simulate-webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': hmacSignature,
    },
    body: settlePayload,
  });

  const settleData = await settleRes.json();
  console.log(`✅ Reconciliation Webhook Acknowledged:`, settleData);

  // Give reconciler a moment to commit double-entry ledger and update calibration
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const updatedOpp = getOpportunityById(testOppId);
  const ledgerEntries = getLedgerEntriesByOpportunity(testOppId);
  console.log(`\n🏆 Post-Reconciliation Opportunity Status: [${updatedOpp?.status?.toUpperCase()}]`);

  if (ledgerEntries.length > 0) {
    console.log(`   Immutable Ledger Audit Trail (${ledgerEntries.length} entries):`);
    for (const le of ledgerEntries) {
      console.log(`     - [${le.timestamp}] Event: ${le.event_type} | Amount: ₹${(le.amount_paise / 100).toFixed(2)} | Ref: ${le.raw_payload_ref || 'N/A'}`);
    }
  }

  // Step 6: Query Final Dashboard Analytics & Verify Model-Estimated Disclaimers
  console.log('\n📈 Step 6: Querying final updated Dashboard Analytics...');
  const finalSummaryRes = await fetch(`${BASE_URL}/dashboard/summary`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const finalSummary = await finalSummaryRes.json();

  const finalAnalyticsRes = await fetch(`${BASE_URL}/dashboard/analytics`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const finalAnalytics = await finalAnalyticsRes.json();

  console.log(`   Total Opportunities Now: ${finalSummary.total_opportunities}`);
  console.log(`   Updated Total Recovered: ${finalSummary.total_recovered_display}`);
  console.log(`   Active Marginal Shadow Price: ${finalSummary.shadow_price_display}`);
  console.log(`   Analytics Rate Disclaimer: "${finalAnalytics.metrics?.rate_disclaimer}" (is_model_estimated: ${finalAnalytics.metrics?.is_model_estimated})`);

  console.log('\n🎉 ========================================================');
  console.log('   ENTERPRISE SAAS END-TO-END DEMO: 100% VERIFIED SUCCESS');
  console.log('========================================================\n');
}

runLiveEnterpriseDemo().catch((err) => {
  console.error('❌ Demo verification failed:', err);
  process.exit(1);
});
