import dotenv from 'dotenv';
import path from 'node:path';
import {
  classifyDeclineTaxonomy,
  normalizeOpportunity,
} from '../src/perception/normalizer.js';
import {
  initDatabase,
  getOpportunityById,
  getCustomerById,
  getAllOpportunities,
} from '../src/db/database.js';
import { SYNTHETIC_SCENARIOS, UNMAPPED_TEST_SCENARIO } from './seed_synthetic.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
initDatabase();

const PORT = process.env.PORT || 3001;
const BASE_URL = `http://localhost:${PORT}`;

async function runPerceptionTests() {
  console.log('🧪 Starting Perception Normalization Acceptance Tests...\n');

  // --- Test 1: Taxonomy Classifier Unit Tests ---
  console.log('--- Test 1: Taxonomy Classification Rules ---');
  
  // Hard declines
  const hardCases = [
    { code: 'stolen_card', reason: 'stolen card' },
    { code: 'lost_card', reason: 'lost card' },
    { code: 'pickup_card', reason: 'pickup card' },
    { code: 'restricted_card', reason: 'restricted card' },
    { code: 'BAD_REQUEST_PAYMENT_CARD_STOLEN_OR_LOST', reason: 'Card reported stolen' },
  ];

  for (const tc of hardCases) {
    const res = classifyDeclineTaxonomy(tc.code, tc.reason);
    if (res !== 'hard') {
      console.error(`❌ FAIL: Expected 'hard' for ${tc.code}, got '${res}'`);
      process.exit(1);
    }
  }
  console.log(`✅ PASS: All ${hardCases.length} hard decline test cases classified as 'hard'.`);

  // Soft declines
  const softCases = [
    { code: 'insufficient_funds', reason: 'Insufficient funds' },
    { code: 'expired_card', reason: 'Card expired' },
    { code: 'generic_decline', reason: 'Declined by bank' },
    { code: 'do_not_honor', reason: 'Do not honor' },
    { code: 'bank_gateway_timeout', reason: 'Gateway timed out' },
    { code: 'network_timeout', reason: 'Network communication failure' },
    { code: 'BAD_REQUEST_PAYMENT_INSUFFICIENT_FUNDS', reason: 'Account lacks balance' },
  ];

  for (const tc of softCases) {
    const res = classifyDeclineTaxonomy(tc.code, tc.reason);
    if (res !== 'soft') {
      console.error(`❌ FAIL: Expected 'soft' for ${tc.code}, got '${res}'`);
      process.exit(1);
    }
  }
  console.log(`✅ PASS: All ${softCases.length} soft decline test cases classified as 'soft'.`);

  // Unknown declines
  const unknownCases = [
    { code: 'unmapped_bank_code_xyz', reason: 'Unknown error from third-party switch' },
    { code: 'ERR_CUSTOM_VENDOR_99', reason: 'Mystery response' },
    { code: null, reason: null },
  ];

  for (const tc of unknownCases) {
    const res = classifyDeclineTaxonomy(tc.code, tc.reason);
    if (res !== 'unknown') {
      console.error(`❌ FAIL: Expected 'unknown' for ${tc.code}, got '${res}'`);
      process.exit(1);
    }
  }
  console.log(`✅ PASS: All ${unknownCases.length} unknown decline test cases classified as 'unknown' without throwing.`);

  // --- Test 2: Verify 15 Seeded Synthetic Opportunities ---
  console.log('\n--- Test 2: Verifying 15 Seeded Synthetic Opportunities ---');
  for (const opp of SYNTHETIC_SCENARIOS) {
    const dbOpp = getOpportunityById(opp.id);
    if (!dbOpp) {
      console.error(`❌ FAIL: Opportunity ${opp.id} not found in DB`);
      process.exit(1);
    }
    if (dbOpp.decline_type !== opp.decline_type) {
      console.error(`❌ FAIL: Opportunity ${opp.id} has decline_type=${dbOpp.decline_type}, expected ${opp.decline_type}`);
      process.exit(1);
    }
  }
  console.log('✅ PASS: All 15 seeded opportunities match expected decline_type taxonomy.');

  // --- Test 3: Verify Unmapped Reason Code lands as unknown ---
  console.log('\n--- Test 3: Unmapped Reason Code Ingestion ---');
  const unmappedDb = getOpportunityById(UNMAPPED_TEST_SCENARIO.id);
  if (!unmappedDb || unmappedDb.decline_type !== 'unknown') {
    console.error(`❌ FAIL: Unmapped opportunity expected decline_type='unknown', got ${unmappedDb?.decline_type}`);
    process.exit(1);
  }
  console.log(`✅ PASS: Unmapped reason '${UNMAPPED_TEST_SCENARIO.reason_code}' stored with decline_type='unknown'.`);

  // --- Test 4: Default Trust Score for Unseen Customer ---
  console.log('\n--- Test 4: Customer Trust Score Default (0.65) ---');
  const unseenCustomerId = `cust_new_unseen_${Date.now()}`;
  const normalized = normalizeOpportunity({
    id: `pay_unseen_${Date.now()}`,
    amount: 199900,
    customer_id: unseenCustomerId,
    error_code: 'insufficient_funds',
  });

  const customerRecord = getCustomerById(unseenCustomerId);
  if (!customerRecord || customerRecord.trust_score !== 0.65) {
    console.error(`❌ FAIL: Expected default trust score 0.65, got ${customerRecord?.trust_score}`);
    process.exit(1);
  }
  if (normalized.customer_trust_score !== 0.65) {
    console.error(`❌ FAIL: Normalized opportunity trust score expected 0.65, got ${normalized.customer_trust_score}`);
    process.exit(1);
  }
  console.log('✅ PASS: New unseen customer received default trust_score = 0.65 and was linked to opportunity.');

  // --- Test 5: API GET /opportunities/:id ---
  console.log('\n--- Test 5: API GET /opportunities/:id ---');
  try {
    const oppRes = await fetch(`${BASE_URL}/opportunities/synth_01_stolen_card`);
    const oppData = await oppRes.json();
    if (
      oppRes.status === 200 &&
      oppData.opportunity?.id === 'synth_01_stolen_card' &&
      oppData.opportunity?.decline_type === 'hard' &&
      oppData.customer?.id === 'cust_synth_stolen_01'
    ) {
      console.log('✅ PASS: GET /opportunities/:id returned normalized opportunity + customer details.');
    } else {
      console.error('❌ FAIL: Unexpected API response:', oppData);
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ API fetch error:', err);
    process.exit(1);
  }

  // --- Summary Table of Opportunities & Classifications ---
  console.log('\n📊 Summary of Opportunities by Perception Taxonomy:');
  console.log('-----------------------------------------------------------------------------------------');
  console.log('| Opportunity ID                 | Amount (₹) | Reason Code                   | Decline |');
  console.log('-----------------------------------------------------------------------------------------');
  const all = getAllOpportunities();
  for (const o of all) {
    const idPad = o.id.padEnd(30, ' ');
    const amtPad = (`₹` + (o.amount_paise / 100).toLocaleString()).padStart(10, ' ');
    const codePad = o.reason_code.padEnd(29, ' ');
    const typePad = o.decline_type.toUpperCase().padEnd(7, ' ');
    console.log(`| ${idPad} | ${amtPad} | ${codePad} | ${typePad} |`);
  }
  console.log('-----------------------------------------------------------------------------------------');

  console.log('\n🎉 ALL PERCEPTION ACCEPTANCE TESTS PASSED!');
}

runPerceptionTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
