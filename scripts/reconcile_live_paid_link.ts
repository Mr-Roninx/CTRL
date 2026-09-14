import { rzpClient } from '../src/execution/executor.js';
import {
  initDatabase,
  getOpportunityById,
  getAllExecutionRecords,
  updateOpportunityStatus,
} from '../src/db/database.js';
import { ProviderTruthEvaluator } from '../src/truth/provider_truth.js';
import { DoubleEntryLedger } from '../src/truth/double_entry_ledger.js';

async function reconcileLivePaidLink() {
  initDatabase();
  await DoubleEntryLedger.initTable();

  const paymentLinkId = 'plink_TWcnQZVwogNPop';
  console.log(`\n🔍 Fetching live Razorpay payment link state for: ${paymentLinkId}...`);
  const link: any = await rzpClient.paymentLink.fetch(paymentLinkId);

  console.log('Provider Payload Received:');
  console.log({
    link_id: link.id,
    status: link.status,
    amount: link.amount,
    amount_paid: link.amount_paid,
    payments: link.payments?.length || 0,
  });

  // Evaluate Provider Truth
  const evalResult = ProviderTruthEvaluator.evaluate({
    ...link,
    source_env: 'RAZORPAY_TEST',
  });

  console.log('\n📊 Provider Truth Evaluation:');
  console.log({
    provider_status: evalResult.provider_status,
    evidence_state: evalResult.evidence_state,
    is_recovered: evalResult.is_recovered,
    amount_paid_inr: `₹${(evalResult.amount_paid_paise / 100).toFixed(2)}`,
    evidence_class: evalResult.evidence_class,
  });

  // Find opportunity associated with this link
  const records = getAllExecutionRecords();
  const matchedRecord = records.find((r) => r.razorpay_payment_link_id === paymentLinkId);

  if (matchedRecord) {
    const oppId = matchedRecord.opportunity_id;
    console.log(`\n🎯 Matched Opportunity: ${oppId}`);

    if (evalResult.is_recovered) {
      updateOpportunityStatus(oppId, 'recovered');
      console.log(`  ✅ Opportunity ${oppId} status updated to 'recovered'`);

      const entry = await DoubleEntryLedger.recordEntry({
        opportunity_id: oppId,
        event_type: 'recovered',
        debit_account: 'bank_settlement',
        credit_account: 'recovered_revenue',
        amount_paise: evalResult.amount_paid_paise,
      });

      console.log(`  ✅ Double-entry journal logged (Hash: ${entry.entry_hash.slice(0, 16)}...)`);
    }
  }

  console.log('\n🏁 Dual-path Provider Reconciliation Complete!\n');
}

reconcileLivePaidLink().catch(console.error);
