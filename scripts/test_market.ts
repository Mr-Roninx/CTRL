import dotenv from 'dotenv';
import path from 'node:path';
import { runMarketAllocation } from '../src/market/allocator.js';
import { initDatabase, getAllAllocationDecisions, getOpportunityById } from '../src/db/database.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
initDatabase();

const PORT = process.env.PORT || 3001;
const BASE_URL = `http://localhost:${PORT}`;

async function runMarketAcceptanceTests() {
  console.log('🧪 Starting Recovery Market Allocation Acceptance Tests...\n');

  // --- Test 1: Market Allocation with Cap = 5 ---
  console.log('--- Test 1: Market Allocation with Cap = 5 ---');
  const runCap5 = runMarketAllocation({ capacity: 5 });

  console.log(`Capacity: ${runCap5.capacity}`);
  console.log(`Total Opportunities: ${runCap5.total_opportunities}`);
  console.log(`Eligible: ${runCap5.eligible_count} | Abstained: ${runCap5.abstained_count}`);
  console.log(`Accepted (ACT): ${runCap5.accepted_count} | Deferred (WAIT): ${runCap5.deferred_count}`);
  console.log(`Shadow Price (Cap 5): ${runCap5.shadow_price_display} (${runCap5.shadow_price_paise} paise)`);

  const actItemsCap5 = runCap5.items.filter((i) => i.decision === 'ACT');
  const waitItemsCap5 = runCap5.items.filter((i) => i.decision === 'WAIT');
  const abstainItemsCap5 = runCap5.items.filter((i) => i.decision === 'ABSTAIN');

  if (actItemsCap5.length !== 5) {
    console.error(`❌ FAIL: Expected exactly 5 ACT decisions, got ${actItemsCap5.length}`);
    process.exit(1);
  }

  // Check hard decline and low-confidence are abstained
  const hardOpp = abstainItemsCap5.find((i) => i.opportunity_id === 'synth_01_stolen_card');
  const lowConfOpp = abstainItemsCap5.find((i) => i.opportunity_id === 'synth_03_retry_cap_exceeded');

  if (!hardOpp || !lowConfOpp) {
    console.error('❌ FAIL: Hard decline or low-confidence attempt 3 was not excluded to ABSTAIN');
    process.exit(1);
  }

  console.log('✅ PASS: Exactly 5 items allocated ACT at cap=5. Hard decline and low-confidence attempt 3 safely abstained.');

  // Print top 5 at cap=5
  console.log('\nTop 5 Allocated Opportunities (Cap = 5):');
  for (const item of actItemsCap5) {
    console.log(`  Rank #${item.rank_in_batch}: ${item.opportunity_id.padEnd(30)} | Amount: ₹${(item.amount_paise / 100).toLocaleString().padStart(6)} | IVEN: ₹${(item.expected_incremental_value_paise / 100).toLocaleString(undefined, { minimumFractionDigits: 2 }).padStart(9)}`);
  }

  // --- Test 2: Dynamic Capacity Shift (Cap = 3) (Core Demo Moment) ---
  console.log('\n--- Test 2: Dynamic Capacity Shift (Re-running with Cap = 3) ---');
  const runCap3 = runMarketAllocation({ capacity: 3 });

  console.log(`New Capacity: ${runCap3.capacity}`);
  console.log(`Accepted (ACT): ${runCap3.accepted_count} | Deferred (WAIT): ${runCap3.deferred_count}`);
  console.log(`New Shadow Price (Cap 3): ${runCap3.shadow_price_display} (${runCap3.shadow_price_paise} paise)`);

  const actItemsCap3 = runCap3.items.filter((i) => i.decision === 'ACT');
  const waitItemsCap3 = runCap3.items.filter((i) => i.decision === 'WAIT');

  if (actItemsCap3.length !== 3) {
    console.error(`❌ FAIL: Expected exactly 3 ACT decisions, got ${actItemsCap3.length}`);
    process.exit(1);
  }

  // Verify that rank 4 and rank 5 shifted from ACT to WAIT
  const rank4Item = runCap3.items.find((i) => i.rank_in_batch === 4);
  const rank5Item = runCap3.items.find((i) => i.rank_in_batch === 5);

  if (!rank4Item || rank4Item.decision !== 'WAIT' || !rank5Item || rank5Item.decision !== 'WAIT') {
    console.error('❌ FAIL: Items at rank 4 and 5 did not shift to WAIT at cap=3');
    process.exit(1);
  }

  console.log(`Rank #4 shifted: ${rank4Item.opportunity_id} -> decision=${rank4Item.decision}`);
  console.log(`Reason: "${rank4Item.reason}"`);
  console.log(`Rank #5 shifted: ${rank5Item.opportunity_id} -> decision=${rank5Item.decision}`);
  console.log(`Reason: "${rank5Item.reason}"`);

  // Verify shadow price increased: ShadowPrice(Cap 3) > ShadowPrice(Cap 5)
  if (runCap3.shadow_price_paise <= runCap5.shadow_price_paise) {
    console.error(`❌ FAIL: Shadow price at cap=3 (${runCap3.shadow_price_paise}) should be strictly higher than at cap=5 (${runCap5.shadow_price_paise})`);
    process.exit(1);
  }

  console.log(`✅ PASS: Shadow price rose from ${runCap5.shadow_price_display} to ${runCap3.shadow_price_display}. Rank #4 and #5 shifted to WAIT citing the new marginal cutoff.`);

  // --- Test 3: API Endpoint GET /market/run ---
  console.log('\n--- Test 3: API Endpoint GET /market/run ---');
  try {
    const res = await fetch(`${BASE_URL}/market/run?capacity=5`);
    const data = await res.json();

    if (res.status === 200 && data.capacity === 5 && data.accepted_count === 5 && Array.isArray(data.items)) {
      console.log('✅ PASS: GET /market/run?capacity=5 returned structured market portfolio breakdown.');
    } else {
      console.error('❌ FAIL: API market run failed:', data);
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ API fetch error:', err);
    process.exit(1);
  }

  // --- Comparative Table View ---
  console.log('\n📊 Portfolio Capacity Shift Comparison (Cap 5 vs Cap 3):');
  console.log('-------------------------------------------------------------------------------------------------------------------');
  console.log('| Opportunity ID                 | Amount (₹) |   IVEN (₹) | Cap=5 Decision | Cap=3 Decision | Shift Status       |');
  console.log('-------------------------------------------------------------------------------------------------------------------');

  const cap5Map = new Map(runCap5.items.map((i) => [i.opportunity_id, i]));
  const cap3Map = new Map(runCap3.items.map((i) => [i.opportunity_id, i]));

  for (const item5 of runCap5.items) {
    const item3 = cap3Map.get(item5.opportunity_id);
    if (!item3) continue;

    const idPad = item5.opportunity_id.padEnd(30, ' ');
    const amtPad = (`₹` + (item5.amount_paise / 100).toLocaleString()).padStart(10, ' ');
    const ivenPad = (`₹` + (item5.expected_incremental_value_paise / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })).padStart(10, ' ');
    const dec5Pad = item5.decision.padEnd(14, ' ');
    const dec3Pad = item3.decision.padEnd(14, ' ');
    
    let shift = 'Unchanged';
    if (item5.decision === 'ACT' && item3.decision === 'WAIT') {
      shift = '🔴 SHIFTED -> WAIT';
    } else if (item5.decision === 'ACT' && item3.decision === 'ACT') {
      shift = '🟢 REMAINS ACT';
    } else if (item5.decision === 'ABSTAIN') {
      shift = '⚪ ABSTAINED';
    }

    console.log(`| ${idPad} | ${amtPad} | ${ivenPad} | ${dec5Pad} | ${dec3Pad} | ${shift.padEnd(18, ' ')} |`);
  }
  console.log('-------------------------------------------------------------------------------------------------------------------');

  console.log('\n🎉 ALL RECOVERY MARKET ACCEPTANCE TESTS PASSED!');
}

runMarketAcceptanceTests().catch((err) => {
  console.error('Market test error:', err);
  process.exit(1);
});
