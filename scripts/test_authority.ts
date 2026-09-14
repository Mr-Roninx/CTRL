import dotenv from 'dotenv';
import path from 'node:path';
import {
  runAuthorityPipeline,
  setKillSwitch,
  isKillSwitchActive,
} from '../src/authority/gate.js';
import {
  initDatabase,
  getOpportunityById,
  getAuthorityChecksByOpportunityId,
} from '../src/db/database.js';
import { seedSyntheticData } from './seed_synthetic.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
initDatabase();

const PORT = process.env.PORT || 3001;
const BASE_URL = `http://localhost:${PORT}`;

async function runAuthorityAcceptanceTests() {
  console.log('🧪 Starting Action Authority Compliance Acceptance Tests...\n');

  // Seed fresh synthetic opportunities for idempotent testing
  seedSyntheticData();

  // Ensure kill switch is clean before starting
  setKillSwitch(false);

  // --- Test 1: Full Authority Pipeline Execution (Cap = 5) ---
  console.log('--- Test 1: Pipeline Execution with Normal Operation (Kill Switch OFF) ---');
  const normalRun = runAuthorityPipeline({ capacity: 5 });

  console.log(`Total Evaluated: ${normalRun.total_evaluated}`);
  console.log(`AUTHORIZED: ${normalRun.authorized_count} | BLOCKED: ${normalRun.blocked_count} | ABSTAIN: ${normalRun.abstained_count} | WAIT: ${normalRun.deferred_count}`);

  if (normalRun.authorized_count !== 5) {
    console.error(`❌ FAIL: Expected 5 AUTHORIZED opportunities at capacity 5, got ${normalRun.authorized_count}`);
    process.exit(1);
  }

  // Verify Hard Decline is BLOCKED
  const hardResult = normalRun.results.find((r) => r.opportunity_id === 'synth_01_stolen_card');
  if (!hardResult || hardResult.verdict !== 'BLOCKED' || !hardResult.summary_reason.includes('hard/fraud-coded decline')) {
    console.error('❌ FAIL: Hard decline opportunity was not BLOCKED with correct reason:', hardResult);
    process.exit(1);
  }
  console.log(`✅ PASS: Hard decline (${hardResult.opportunity_id}) is BLOCKED: "${hardResult.summary_reason}"`);

  // Verify Retry Cap hit (attempt 3) is BLOCKED
  const retryCapResult = normalRun.results.find((r) => r.opportunity_id === 'synth_03_retry_cap_exceeded');
  if (!retryCapResult || retryCapResult.verdict !== 'BLOCKED' || !retryCapResult.summary_reason.includes('retry cap reached')) {
    console.error('❌ FAIL: Retry cap hit opportunity was not BLOCKED with correct reason:', retryCapResult);
    process.exit(1);
  }
  console.log(`✅ PASS: Retry cap hit (${retryCapResult.opportunity_id}) is BLOCKED: "${retryCapResult.summary_reason}"`);

  // Verify SQLite checks persistence
  const hardChecks = getAuthorityChecksByOpportunityId('synth_01_stolen_card');
  if (hardChecks.length !== 5) {
    console.error(`❌ FAIL: Expected 5 independent checks stored for synth_01_stolen_card, got ${hardChecks.length}`);
    process.exit(1);
  }
  console.log(`✅ PASS: 5 independent compliance checks durably logged in SQLite for synth_01_stolen_card.`);

  // --- Test 2: Kill Switch Engagement (100% Block) ---
  console.log('\n--- Test 2: Engaging Global Kill Switch ---');
  setKillSwitch(true);

  const killSwitchRun = runAuthorityPipeline({ capacity: 5 });
  console.log(`Kill Switch Status: ${killSwitchRun.kill_switch_active ? 'ENGAGED' : 'DISENGAGED'}`);
  console.log(`AUTHORIZED: ${killSwitchRun.authorized_count} | BLOCKED: ${killSwitchRun.blocked_count}`);

  if (killSwitchRun.authorized_count !== 0) {
    console.error(`❌ FAIL: Expected 0 AUTHORIZED opportunities when kill switch is ON, got ${killSwitchRun.authorized_count}`);
    process.exit(1);
  }

  // Verify previously authorized items are now all BLOCKED
  const previouslyAuthorized = normalRun.results
    .filter((r) => r.verdict === 'AUTHORIZED')
    .map((r) => r.opportunity_id);

  for (const id of previouslyAuthorized) {
    const item = killSwitchRun.results.find((r) => r.opportunity_id === id);
    if (!item || item.verdict !== 'BLOCKED') {
      console.error(`❌ FAIL: Item ${id} was not BLOCKED under kill switch:`, item);
      process.exit(1);
    }
  }
  console.log(`✅ PASS: 100% of previously AUTHORIZED opportunities (${previouslyAuthorized.length}/${previouslyAuthorized.length}) immediately overridden to BLOCKED.`);

  // Disengage kill switch and verify recovery
  console.log('\nDisengaging Kill Switch...');
  setKillSwitch(false);
  const recoveredRun = runAuthorityPipeline({ capacity: 5 });
  if (recoveredRun.authorized_count !== 5) {
    console.error('❌ FAIL: Failed to restore AUTHORIZED opportunities after disengaging kill switch');
    process.exit(1);
  }
  console.log(`✅ PASS: Normal authorization restored (AUTHORIZED count: ${recoveredRun.authorized_count}).`);

  // --- Test 3: API Checklist Endpoint (GET /opportunities/:id/authority) ---
  console.log('\n--- Test 3: API Checklist Endpoint GET /opportunities/:id/authority ---');
  try {
    // 1. Check an AUTHORIZED opportunity
    const authRes = await fetch(`${BASE_URL}/opportunities/synth_09_high_val_license/authority`);
    const authData = await authRes.json();
    console.log('Authorized Item Checklist API Response:', JSON.stringify(authData, null, 2));

    if (authRes.status === 200 && authData.verdict === 'AUTHORIZED' && authData.all_passed === true && authData.checklist.length === 5) {
      console.log('✅ PASS: GET /opportunities/synth_09_high_val_license/authority returned complete passing checklist.');
    } else {
      console.error('❌ FAIL: Unexpected checklist response for authorized item:', authData);
      process.exit(1);
    }

    // 2. Check a BLOCKED opportunity (Hard decline)
    const blockedRes = await fetch(`${BASE_URL}/opportunities/synth_01_stolen_card/authority`);
    const blockedData = await blockedRes.json();
    console.log('\nBlocked Item Checklist API Response:', JSON.stringify(blockedData, null, 2));

    if (blockedRes.status === 200 && blockedData.verdict === 'BLOCKED' && blockedData.all_passed === false) {
      console.log('✅ PASS: GET /opportunities/synth_01_stolen_card/authority returned failing checklist.');
    } else {
      console.error('❌ FAIL: Unexpected checklist response for blocked item:', blockedData);
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ API test error:', err);
    process.exit(1);
  }

  // --- Summary Checklist Rendering for Feature 7 UI Preview ---
  console.log('\n🛡️ Action Authority Compliance Checklist Matrix:');
  console.log('-----------------------------------------------------------------------------------------------------------------------------');
  console.log('| Opportunity ID                 | Hard Decline | Retry Cap | Kill Switch | Confidence | Capacity | Final Verdict |');
  console.log('-----------------------------------------------------------------------------------------------------------------------------');

  for (const item of recoveredRun.results) {
    const idPad = item.opportunity_id.padEnd(30, ' ');
    const hard = item.checks.find((c) => c.check_name === 'hard_decline_check')?.passed ? '  ✓ Pass   ' : '  ✗ FAIL   ';
    const retry = item.checks.find((c) => c.check_name === 'retry_cap_check')?.passed ? '  ✓ Pass   ' : '  ✗ FAIL   ';
    const kill = item.checks.find((c) => c.check_name === 'kill_switch_check')?.passed ? '  ✓ Pass    ' : '  ✗ FAIL    ';
    const conf = item.checks.find((c) => c.check_name === 'confidence_recheck')?.passed ? '  ✓ Pass   ' : '  ✗ FAIL   ';
    const cap = item.checks.find((c) => c.check_name === 'capacity_recheck')?.passed ? '  ✓ Pass   ' : '  ✗ FAIL   ';
    const verd = item.verdict.padEnd(13, ' ');

    console.log(`| ${idPad} | ${hard} | ${retry} | ${kill} | ${conf} | ${cap} | ${verd} |`);
  }
  console.log('-----------------------------------------------------------------------------------------------------------------------------');

  console.log('\n🎉 ALL ACTION AUTHORITY ACCEPTANCE TESTS PASSED!');
}

runAuthorityAcceptanceTests().catch((err) => {
  console.error('Authority test execution error:', err);
  process.exit(1);
});
