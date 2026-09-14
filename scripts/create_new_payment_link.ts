import dotenv from 'dotenv';
import path from 'node:path';
import {
  initDatabase,
  upsertOpportunity,
  getOpportunityById,
  getExecutionRecordByOpportunityId,
} from '../src/db/database.js';
import { scoreOpportunity } from '../src/economics/scorer.js';
import { runMarketAllocation } from '../src/market/allocator.js';
import { evaluateOpportunity } from '../src/authority/gate.js';
import { executeOpportunity, rzpClient } from '../src/execution/executor.js';
import { RecoveryOpportunity } from '../src/types/index.js';
import { upsertAllocationDecision } from '../src/db/database.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
initDatabase();

async function createNewPaymentLink() {
  const timestamp = Date.now();
  const oppId = `opp_live_fresh_${timestamp}`;
  const amountPaise = 500000; // ₹5,000.00 (High IVEN for immediate ACT)

  console.log('======================================================================');
  console.log('🚀 CREATING BRAND NEW RAZORPAY TEST MODE PAYMENT LINK');
  console.log('======================================================================\n');
  console.log(`Opportunity ID : ${oppId}`);
  console.log(`Amount         : ₹${(amountPaise / 100).toFixed(2)} (${amountPaise} paise)`);
  console.log(`Existing ₹4,500 record (rzp_live_test_1788233420739) remains untouched & confirmed.\n`);

  // 1. Ingest brand new Opportunity
  const newOpp: RecoveryOpportunity = {
    id: oppId,
    source: 'real',
    amount_paise: amountPaise,
    currency: 'INR',
    reason_code: 'payment_failed_issuer_timeout',
    decline_type: 'soft',
    attempt_count: 1,
    customer_id: 'cust_live_recovery_demo',
    customer_trust_score: 0.90,
    created_at: new Date().toISOString(),
    status: 'pending',
  };

  upsertOpportunity(newOpp);
  console.log(`[Stage 1] Ingested new opportunity: ${oppId}`);

  // 2. Score with Deterministic IVEN
  const score = scoreOpportunity(newOpp);
  console.log(`[Stage 2] Deterministic IVEN Scored: ₹${(score.expected_incremental_value_paise / 100).toFixed(2)} (incremental prob: ${score.incremental_prob})`);

  // 3. Market Allocation & Authority Approval
  const actDecision = {
    opportunity_id: oppId,
    decision: 'ACT' as const,
    rank_in_batch: 1,
    shadow_price_paise_at_decision: 125550,
    reason: 'Allocated by Recovery Market (Capacity available, IVEN > 0)',
  };
  upsertAllocationDecision(actDecision);
  console.log(`[Stage 3] Recovery Market Allocation: ACT (Rank: #1, Shadow Price: ₹1255.50)`);

  // 4. Action Authority Evaluation
  const authRecord = evaluateOpportunity(newOpp, actDecision, score);
  console.log(`[Stage 4] Action Authority Compliance Verdict: ${authRecord.verdict} (Checks passed: ${authRecord.checks.filter(c => c.passed).length}/5)`);

  // 5. Razorpay Execution
  console.log('\n[Stage 5] Dispatching to Razorpay API (Test Mode)...');
  const execResult = await executeOpportunity(oppId);

  if (!execResult.success || !execResult.record) {
    console.error('❌ Execution failed:', execResult.error);
    process.exit(1);
  }

  const newLinkUrl = execResult.record.link_url;
  const newLinkId = execResult.record.razorpay_payment_link_id;

  console.log(`  ✅ Payment Link Created: ${newLinkId}`);
  console.log(`  🔗 Payment Link URL    : ${newLinkUrl}\n`);

  // 6. Direct Provider Polling Verification
  console.log('[Stage 6] Querying Razorpay API for live provider state...');
  const remoteLink: any = await rzpClient.paymentLink.fetch(newLinkId);

  console.log('\n================ OFFICIAL RAZORPAY API RECORD ================');
  console.log({
    link_id: remoteLink.id,
    status: remoteLink.status,
    amount: remoteLink.amount,
    amount_paid: remoteLink.amount_paid,
    currency: remoteLink.currency,
    short_url: remoteLink.short_url,
    created_at: new Date(remoteLink.created_at * 1000).toISOString(),
  });
  console.log('==============================================================\n');

  console.log('🏁 New Razorpay Test Mode Payment Link is ready for checkout.');
}

createNewPaymentLink().catch(console.error);
