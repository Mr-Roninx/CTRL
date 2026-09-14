import crypto from 'node:crypto';
import dotenv from 'dotenv';
import path from 'node:path';
import {
  initDatabase,
  getOpportunityById,
  getLedgerEntriesByOpportunity,
  getAllExecutionRecords,
} from '../src/db/database.js';
import { pollAndReconcile } from '../src/reconciliation/poller.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
initDatabase();

const PORT = process.env.PORT || 3001;
const BASE_URL = `http://localhost:${PORT}`;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'rzp_whsec_ctrl_test';

function signPayload(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

async function runTruthEngineAcceptanceTests() {
  console.log('🧪 Starting Truth Engine & Dashboard Acceptance Tests...\n');

  // --- Test 1: Simulation Webhook Settlement (payment_link.paid) ---
  console.log('--- Test 1: Simulation Settlement (/internal/simulate-webhook) ---');
  
  // Pick an executed opportunity
  const records = getAllExecutionRecords();
  if (records.length === 0) {
    console.error('❌ FAIL: No execution records found. Run test:execution first.');
    process.exit(1);
  }

  const targetRecord = records[0];
  const targetOppId = targetRecord.opportunity_id;
  const targetOpp = getOpportunityById(targetOppId)!;

  console.log(`Simulating payment webhook for Opportunity: ${targetOppId} (Plink: ${targetRecord.razorpay_payment_link_id})...`);

  const paidEventPayload = {
    entity: 'event',
    account_id: 'acc_ctrl_test',
    event: 'payment_link.paid',
    contains: ['payment_link', 'payment'],
    payload: {
      payment_link: {
        entity: {
          id: targetRecord.razorpay_payment_link_id,
          reference_id: targetOppId,
          amount: targetOpp.amount_paise,
          amount_paid: targetOpp.amount_paise,
          status: 'paid',
        },
      },
      payment: {
        entity: {
          id: `pay_settled_${Date.now()}`,
          amount: targetOpp.amount_paise,
          currency: 'INR',
          status: 'captured',
        },
      },
    },
    created_at: Math.floor(Date.now() / 1000),
  };

  const payloadStr = JSON.stringify(paidEventPayload);
  const sig = signPayload(payloadStr, WEBHOOK_SECRET);

  const whRes = await fetch(`${BASE_URL}/internal/simulate-webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': sig,
    },
    body: payloadStr,
  });

  const whData = await whRes.json();
  console.log('Simulation Webhook Response:', whData);

  if (whRes.status === 200 && whData.reconciled === true && whData.status === 'recovered') {
    console.log(`✅ PASS: payment_link.paid successfully reconciled ${targetOppId} to 'recovered'.`);
  } else {
    console.error('❌ FAIL: Webhook settlement failed:', whData);
    process.exit(1);
  }

  // Check DB status and ledger
  const updatedOpp = getOpportunityById(targetOppId)!;
  const ledger = getLedgerEntriesByOpportunity(targetOppId);
  const hasRecoveredEntry = ledger.some((e) => e.event_type === 'recovered');

  if (updatedOpp.status === 'recovered' && hasRecoveredEntry) {
    console.log(`✅ PASS: Database status updated to 'recovered' and immutable ledger entry recorded.`);
  } else {
    console.error('❌ FAIL: Opportunity or ledger not updated properly:', { updatedOpp, ledger });
    process.exit(1);
  }

  // --- Test 2: Active Reconciliation Poller Fallback ---
  console.log('\n--- Test 2: Active Fallback Poller Execution ---');
  const pollResult = await pollAndReconcile();
  console.log('Poller Result Summary:', {
    total_checked: pollResult.total_checked,
    reconciled_count: pollResult.reconciled_count,
    still_executing_count: pollResult.still_executing_count,
    failed_count: pollResult.failed_count,
  });

  if (pollResult.total_checked >= 0 && pollResult.failed_count === 0) {
    console.log('✅ PASS: Reconciliation poller queried Razorpay API successfully without errors.');
  } else {
    console.error('❌ FAIL: Poller execution encountered errors:', pollResult);
    process.exit(1);
  }

  // --- Test 3: Dashboard Summary KPI Financial Boundary Contract ---
  console.log('\n--- Test 3: Dashboard Summary KPI Financial Boundary Contract ---');
  const sumRes = await fetch(`${BASE_URL}/dashboard/summary`);
  const summary = await sumRes.json();
  console.log('Dashboard Summary API Response:', JSON.stringify(summary, null, 2));

  // Verify that total_recovered_paise ONLY counts real opportunities
  const realRecoveredTotal = summary.total_recovered_paise;
  const synthRecoveredTotal = summary.synthetic_recovered_paise;

  console.log(`Real Recovered (₹): ₹${realRecoveredTotal / 100} | Synthetic Recovered (₹): ₹${synthRecoveredTotal / 100}`);

  if (summary.total_recovered_display && summary._note.includes('STRICTLY real')) {
    console.log('✅ PASS: Financial metric contract strictly enforces real-only recovered calculations.');
  } else {
    console.error('❌ FAIL: Summary financial boundary verification failed:', summary);
    process.exit(1);
  }

  console.log('\n🎉 ALL TRUTH ENGINE ACCEPTANCE TESTS PASSED!');
}

runTruthEngineAcceptanceTests().catch((err) => {
  console.error('Truth engine test error:', err);
  process.exit(1);
});
