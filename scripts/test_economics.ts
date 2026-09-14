import dotenv from 'dotenv';
import path from 'node:path';
import {
  initDatabase,
  getOpportunityById,
  getScoreByOpportunityId,
} from '../src/db/database.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
initDatabase();

const PORT = process.env.PORT || 3001;
const BASE_URL = `http://localhost:${PORT}`;

async function runEconomicReasoningTests() {
  console.log('🧪 Starting Economic Reasoning Acceptance Tests...\n');

  // --- Scenario 1: Hard Decline ---
  console.log('--- Scenario 1: Hard Decline (Stolen/Lost Card) ---');
  const hardOpp = getOpportunityById('synth_01_stolen_card')!;
  const hardScore = getScoreByOpportunityId('synth_01_stolen_card')!;
  
  console.log(`Opportunity: ${hardOpp.id} | Amount: ₹${hardOpp.amount_paise / 100}`);
  console.log(`Natural: ${hardScore.natural_recovery_prob} | Intervention: ${hardScore.intervention_recovery_prob} | Incremental: ${hardScore.incremental_prob}`);
  console.log(`Operational Cost: ₹${hardScore.operational_cost_paise / 100} | Fatigue: ₹${hardScore.fatigue_cost_paise / 100} | IVEN: ₹${hardScore.expected_incremental_value_paise / 100} (${hardScore.expected_incremental_value_paise} paise)`);

  if (hardScore.incremental_prob === 0 && hardScore.expected_incremental_value_paise <= 0) {
    console.log('✅ PASS: Hard decline has incremental_prob = 0 and IVEN <= 0 (-400 paise).');
  } else {
    console.error('❌ FAIL: Hard decline criteria failed:', hardScore);
    process.exit(1);
  }

  // --- Scenario 2: Bank Timeout (High Natural Recovery) ---
  console.log('\n--- Scenario 2: Bank-Timeout / High-Natural-Recovery Case ---');
  const timeoutOpp = getOpportunityById('synth_07_high_val_enterprise')!; // ₹15,000
  const timeoutScore = getScoreByOpportunityId('synth_07_high_val_enterprise')!;
  
  console.log(`Opportunity: ${timeoutOpp.id} | High Amount: ₹${timeoutOpp.amount_paise / 100}`);
  console.log(`Natural: ${timeoutScore.natural_recovery_prob} (High) | Intervention: ${timeoutScore.intervention_recovery_prob} | Incremental: ${timeoutScore.incremental_prob} (Small)`);
  console.log(`Confidence: ${timeoutScore.confidence}`);

  if (timeoutScore.natural_recovery_prob === 0.60 && timeoutScore.incremental_prob === 0.10) {
    console.log('✅ PASS: Bank timeout has high natural recovery (0.60) and small incremental probability (0.10) even for large volume.');
  } else {
    console.error('❌ FAIL: Bank timeout criteria failed:', timeoutScore);
    process.exit(1);
  }

  // --- Scenario 3: Insufficient Funds Attempt 1 ---
  console.log('\n--- Scenario 3: Insufficient Funds, Attempt 1 ---');
  const fundsAtt1Opp = getOpportunityById('synth_02_insufficient_funds_att1')!; // ₹2,500
  const fundsAtt1Score = getScoreByOpportunityId('synth_02_insufficient_funds_att1')!;

  console.log(`Opportunity: ${fundsAtt1Opp.id} | Amount: ₹${fundsAtt1Opp.amount_paise / 100} | Attempt: ${fundsAtt1Opp.attempt_count}`);
  console.log(`Incremental Prob: ${fundsAtt1Score.incremental_prob} | Fatigue Cost: ${fundsAtt1Score.fatigue_cost_paise} paise`);
  console.log(`IVEN: ₹${fundsAtt1Score.expected_incremental_value_paise / 100} (${fundsAtt1Score.expected_incremental_value_paise} paise)`);

  if (fundsAtt1Score.incremental_prob > 0 && fundsAtt1Score.fatigue_cost_paise === 0 && fundsAtt1Score.expected_incremental_value_paise > 0) {
    console.log('✅ PASS: Insufficient funds attempt 1 yields clearly positive IVEN (+49,600 paise / ₹496.00).');
  } else {
    console.error('❌ FAIL: Insufficient funds attempt 1 criteria failed:', fundsAtt1Score);
    process.exit(1);
  }

  // --- Scenario 4: Insufficient Funds Attempt 3 ---
  console.log('\n--- Scenario 4: Insufficient Funds, Attempt 3 (Retry Cap) ---');
  const fundsAtt3Opp = getOpportunityById('synth_03_retry_cap_exceeded')!; // Attempt 3
  const fundsAtt3Score = getScoreByOpportunityId('synth_03_retry_cap_exceeded')!;

  console.log(`Opportunity: ${fundsAtt3Opp.id} | Attempt Count: ${fundsAtt3Opp.attempt_count}`);
  console.log(`Fatigue Cost: ${fundsAtt3Score.fatigue_cost_paise} paise | Confidence: ${fundsAtt3Score.confidence}`);

  if (fundsAtt3Opp.attempt_count >= 3 && fundsAtt3Score.confidence === 'low') {
    console.log("✅ PASS: Attempt 3 forces confidence to 'low' regardless of IVEN.");
  } else {
    console.error('❌ FAIL: Attempt 3 confidence check failed:', fundsAtt3Score);
    process.exit(1);
  }

  // --- Scenario 5: API Verification (GET /opportunities/:id/score) ---
  console.log('\n--- Scenario 5: API Verification (GET /opportunities/:id/score) ---');
  try {
    const res = await fetch(`${BASE_URL}/opportunities/synth_02_insufficient_funds_att1/score`);
    const json = await res.json();
    console.log('Response JSON:', JSON.stringify(json, null, 2));

    const requiredFields = [
      'opportunity_id',
      'natural_recovery_prob',
      'intervention_recovery_prob',
      'incremental_prob',
      'operational_cost_paise',
      'fatigue_cost_paise',
      'expected_incremental_value_paise',
      'confidence',
    ];

    for (const field of requiredFields) {
      if (json[field] === undefined) {
        console.error(`❌ FAIL: Missing required score field in API response: ${field}`);
        process.exit(1);
      }
    }

    if (json._labels?.natural_recovery_prob === 'model-estimated') {
      console.log("✅ PASS: API returns all exact schema fields with 'model-estimated' label metadata.");
    } else {
      console.error('❌ FAIL: Missing model-estimated labels.');
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ API test error:', err);
    process.exit(1);
  }

  console.log('\n🎉 ALL ECONOMIC REASONING ACCEPTANCE TESTS PASSED!');
}

runEconomicReasoningTests().catch((err) => {
  console.error('Economic Reasoning test error:', err);
  process.exit(1);
});
