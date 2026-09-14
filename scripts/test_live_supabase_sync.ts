import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  initDatabase,
  insertOpportunity,
  upsertScore,
  upsertAllocationDecision,
  insertAuthorityCheck,
  upsertExecutionRecord,
  insertLedgerEntry,
} from '../src/db/database.js';
import { normalizeOpportunity } from '../src/perception/normalizer.js';
import { scoreOpportunity } from '../src/economics/scorer.js';

dotenv.config();

async function testLiveSupabaseSync() {
  console.log('🧪 Testing Real-Time Supabase Cloud Sync...\n');

  initDatabase();

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

  const client = createClient(supabaseUrl, supabaseKey);

  const testOppId = `pay_sb_live_${Date.now()}`;
  const testTenantId = `tnt_sb_sync_${Date.now()}`;
  const testAmountPaise = 250000; // ₹2,500.00

  console.log(`1. Generating local Opportunity ${testOppId}...`);
  const opp = normalizeOpportunity(
    {
      id: testOppId,
      amount: testAmountPaise,
      currency: 'INR',
      error_code: 'INSUFFICIENT_FUNDS',
      customer_id: 'supabase_user@example.com',
    },
    `evt_sb_${Date.now()}`,
    { source: 'synthetic', tenantId: testTenantId }
  );
  insertOpportunity(opp);

  console.log(`2. Scoring and allocating...`);
  const score = scoreOpportunity(opp);
  upsertScore(score);

  upsertAllocationDecision({
    opportunity_id: testOppId,
    decision: 'ACT',
    rank_in_batch: 1,
    shadow_price_paise_at_decision: 15000,
    reason: 'Ranked #1 for Supabase test',
  });

  insertAuthorityCheck({
    opportunity_id: testOppId,
    check_name: 'hard_decline_veto',
    passed: true,
    reason: 'Soft decline passed',
  });

  upsertExecutionRecord({
    opportunity_id: testOppId,
    razorpay_payment_link_id: `plink_sb_${Date.now()}`,
    link_url: `https://rzp.io/i/test_sb_${Date.now()}`,
    status: 'created',
    idempotency_key: `idem_sb_${Date.now()}`,
    created_at: new Date().toISOString(),
  });

  insertLedgerEntry({
    id: `led_sb_${Date.now()}`,
    opportunity_id: testOppId,
    event_type: 'recovered',
    amount_paise: testAmountPaise,
    timestamp: new Date().toISOString(),
    raw_payload_ref: JSON.stringify({ provider: 'Supabase Cloud Storage' }),
  });

  console.log(`3. Waiting 1.5s for async write-through to Supabase Cloud...`);
  await new Promise((r) => setTimeout(r, 1500));

  console.log(`4. Verifying record directly on Supabase PostgreSQL table 'recovery_opportunities'...`);
  const { data: oppData, error: oppErr } = await client
    .from('recovery_opportunities')
    .select('*')
    .eq('id', testOppId)
    .single();

  if (oppErr || !oppData) {
    throw new Error(`Opportunity not found in Supabase: ${oppErr?.message || 'Empty'}`);
  }
  console.log(`✅ Supabase Opportunity Verified: ID=${oppData.id}, Amount=₹${oppData.amount_paise / 100}, Status=${oppData.status}`);

  console.log(`5. Verifying score on Supabase table 'scores'...`);
  const { data: scoreData, error: scoreErr } = await client
    .from('scores')
    .select('*')
    .eq('opportunity_id', testOppId)
    .single();

  if (scoreErr || !scoreData) {
    throw new Error(`Score not found in Supabase: ${scoreErr?.message || 'Empty'}`);
  }
  console.log(`✅ Supabase Score Verified: IVEN=₹${scoreData.expected_incremental_value_paise / 100}, Confidence=${scoreData.confidence}`);

  console.log(`6. Verifying immutable ledger on Supabase table 'ledger_entries'...`);
  const { data: ledgerData, error: ledgerErr } = await client
    .from('ledger_entries')
    .select('*')
    .eq('opportunity_id', testOppId);

  if (ledgerErr || !ledgerData || ledgerData.length === 0) {
    throw new Error(`Ledger entry not found in Supabase: ${ledgerErr?.message || 'Empty'}`);
  }
  console.log(`✅ Supabase Ledger Verified: Event=${ledgerData[0].event_type}, Amount=₹${ledgerData[0].amount_paise / 100}`);

  console.log('\n🎉 ALL REAL-TIME SUPABASE CLOUD SYNCHRONIZATION TESTS PASSED SUCCESSFULLY!');
}

testLiveSupabaseSync().catch((err) => {
  console.error('❌ Supabase Sync Test failed:', err);
  process.exit(1);
});
