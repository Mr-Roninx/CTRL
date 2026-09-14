import dotenv from 'dotenv';
import path from 'node:path';
import {
  executeOpportunity,
  executeAuthorizedBatch,
} from '../src/execution/executor.js';
import {
  initDatabase,
  getExecutionRecordByOpportunityId,
  getAllExecutionRecords,
  getOpportunityById,
} from '../src/db/database.js';
import { runAuthorityPipeline, setKillSwitch } from '../src/authority/gate.js';
import { seedSyntheticData } from './seed_synthetic.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
initDatabase();

const PORT = process.env.PORT || 3001;
const BASE_URL = `http://localhost:${PORT}`;

async function runExecutionAcceptanceTests() {
  console.log('🧪 Starting Execution Engine Acceptance Tests...\n');

  // Seed fresh synthetic opportunities for idempotent test execution
  seedSyntheticData();

  // Ensure normal operation
  setKillSwitch(false);
  runAuthorityPipeline({ capacity: 5 });

  // --- Test 1: Real Razorpay Payment Link Creation for AUTHORIZED Opportunities ---
  console.log('--- Test 1: Real Razorpay Payment Link Creation (Authorized Items) ---');
  
  // Pick 2 top AUTHORIZED opportunities
  const targetId1 = 'synth_11_high_val_deposit'; // ₹75,000
  const targetId2 = 'synth_09_high_val_license'; // ₹95,000

  console.log(`Executing Opportunity 1: ${targetId1}...`);
  const exec1 = await executeOpportunity(targetId1);
  console.log('Result 1:', exec1);

  if (!exec1.success || !exec1.record?.razorpay_payment_link_id || !exec1.record?.link_url) {
    console.error('❌ FAIL: Execution of Opportunity 1 failed:', exec1);
    process.exit(1);
  }
  console.log(`✅ PASS: Real Razorpay Link 1 created: ${exec1.record.razorpay_payment_link_id} -> ${exec1.record.link_url}`);

  console.log(`\nExecuting Opportunity 2: ${targetId2}...`);
  const exec2 = await executeOpportunity(targetId2);
  console.log('Result 2:', exec2);

  if (!exec2.success || !exec2.record?.razorpay_payment_link_id || !exec2.record?.link_url) {
    console.error('❌ FAIL: Execution of Opportunity 2 failed:', exec2);
    process.exit(1);
  }
  console.log(`✅ PASS: Real Razorpay Link 2 created: ${exec2.record.razorpay_payment_link_id} -> ${exec2.record.link_url}`);

  // Verify status is updated to 'executing' in SQLite
  const opp1 = getOpportunityById(targetId1)!;
  const opp2 = getOpportunityById(targetId2)!;
  if (opp1.status !== 'executing' || opp2.status !== 'executing') {
    console.error(`❌ FAIL: Opportunity status expected 'executing', got opp1=${opp1.status}, opp2=${opp2.status}`);
    process.exit(1);
  }
  console.log(`✅ PASS: Opportunity statuses successfully updated to 'executing' in SQLite.`);

  // --- Test 2: Idempotent Execution Replay ---
  console.log('\n--- Test 2: Idempotent Execution Replay ---');
  console.log(`Re-executing Opportunity: ${targetId1}...`);
  const execReplay = await executeOpportunity(targetId1);
  console.log('Replay Result:', execReplay);

  if (
    execReplay.success &&
    execReplay.created_new === false &&
    execReplay.record?.razorpay_payment_link_id === exec1.record?.razorpay_payment_link_id
  ) {
    console.log('✅ PASS: Idempotent execution safely returned existing execution record without creating a duplicate Razorpay link.');
  } else {
    console.error('❌ FAIL: Idempotency assertion failed:', execReplay);
    process.exit(1);
  }

  // --- Test 3: Zero-Bypass Authority Safety (Refusal on Non-Authorized Items) ---
  console.log('\n--- Test 3: Zero-Bypass Compliance Safety Assertions ---');
  
  // 1. Attempt on BLOCKED (Hard decline)
  let blockedRejected = false;
  try {
    await executeOpportunity('synth_01_stolen_card');
  } catch (err: any) {
    blockedRejected = true;
    console.log(`✅ PASS: BLOCKED hard decline correctly rejected with authority error: "${err.message}"`);
  }
  if (!blockedRejected) {
    console.error('❌ FAIL: BLOCKED opportunity was not rejected!');
    process.exit(1);
  }

  // 2. Attempt on BLOCKED (Retry cap hit)
  let retryCapRejected = false;
  try {
    await executeOpportunity('synth_03_retry_cap_exceeded');
  } catch (err: any) {
    retryCapRejected = true;
    console.log(`✅ PASS: BLOCKED retry cap correctly rejected with authority error: "${err.message}"`);
  }
  if (!retryCapRejected) {
    console.error('❌ FAIL: Retry cap hit opportunity was not rejected!');
    process.exit(1);
  }

  // 3. Attempt on WAIT (Deferred capacity)
  let waitRejected = false;
  try {
    await executeOpportunity('synth_02_insufficient_funds_att1');
  } catch (err: any) {
    waitRejected = true;
    console.log(`✅ PASS: WAIT deferred opportunity correctly rejected with authority error: "${err.message}"`);
  }
  if (!waitRejected) {
    console.error('❌ FAIL: WAIT opportunity was not rejected!');
    process.exit(1);
  }

  // --- Test 4: API Execution Endpoints ---
  console.log('\n--- Test 4: API Endpoints (POST /execution/run & GET /execution/records) ---');
  try {
    // Test Batch Run
    const batchRes = await fetch(`${BASE_URL}/execution/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxLinks: 3 }),
    });
    const batchData = await batchRes.json();
    console.log('Batch Execution API Result:', JSON.stringify(batchData, null, 2));

    if (batchRes.status === 200 && batchData.max_links_cap === 3 && Array.isArray(batchData.results)) {
      console.log('✅ PASS: POST /execution/run successfully orchestrated authorized execution batch under cap limit.');
    } else {
      console.error('❌ FAIL: Batch execution API failed:', batchData);
      process.exit(1);
    }

    // Test GET /execution/records
    const listRes = await fetch(`${BASE_URL}/execution/records`);
    const listData = await listRes.json();
    console.log(`Execution records count in DB: ${listData.count}`);

    if (listRes.status === 200 && listData.count >= 2) {
      console.log('✅ PASS: GET /execution/records returned stored execution records.');
    } else {
      console.error('❌ FAIL: Failed to list execution records:', listData);
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ API test error:', err);
    process.exit(1);
  }

  // --- Summary Execution Table ---
  console.log('\n⚡ Live Razorpay Payment Links Generated:');
  console.log('-----------------------------------------------------------------------------------------------------------------------------');
  console.log('| Opportunity ID                 | Amount (₹) | Razorpay Link ID        | Status  | Live Checkout URL                       |');
  console.log('-----------------------------------------------------------------------------------------------------------------------------');

  const allRecords = getAllExecutionRecords();
  for (const rec of allRecords) {
    const opp = getOpportunityById(rec.opportunity_id);
    const idPad = rec.opportunity_id.padEnd(30, ' ');
    const amtPad = opp ? (`₹` + (opp.amount_paise / 100).toLocaleString()).padStart(10, ' ') : '         -';
    const plinkPad = rec.razorpay_payment_link_id.padEnd(23, ' ');
    const statPad = rec.status.padEnd(7, ' ');
    const urlPad = rec.link_url;

    console.log(`| ${idPad} | ${amtPad} | ${plinkPad} | ${statPad} | ${urlPad} |`);
  }
  console.log('-----------------------------------------------------------------------------------------------------------------------------');

  console.log('\n🎉 ALL EXECUTION ACCEPTANCE TESTS PASSED!');
}

runExecutionAcceptanceTests().catch((err) => {
  console.error('Execution test error:', err);
  process.exit(1);
});
