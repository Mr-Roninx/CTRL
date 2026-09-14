import dotenv from 'dotenv';
import path from 'node:path';
import {
  initDatabase,
  getOpportunityById,
  getScoreByOpportunityId,
  getAllocationDecisionByOpportunityId,
  getAuthorityChecksByOpportunityId,
} from '../src/db/database.js';
import { explainOpportunityDecision } from '../src/llm/explainer.js';
import { seedSyntheticData } from './seed_synthetic.js';
import { runAuthorityPipeline } from '../src/authority/gate.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
initDatabase();

async function testLLMExplanation() {
  console.log('================================================================================');
  console.log('🧠 CTRL: NVIDIA NIM API (NEMOTRON-3.5-LIGHTNING-30B) DECISION EXPLAINER VERIFICATION');
  console.log('================================================================================\n');

  console.log('Configured Provider:', process.env.NVIDIA_BASE_URL);
  console.log('Configured Model:', process.env.LLM_MODEL);
  console.log('API Key Present:', Boolean(process.env.NVIDIA_API_KEY));

  // Seed baseline data and run authority pipeline to have scores & decisions
  console.log('\n--- Step 1: Preparing Scored & Allocated Portfolio ---');
  seedSyntheticData();
  runAuthorityPipeline({ capacity: 5 });

  // Test Case 1: Explain an AUTHORIZED opportunity (synth_04_expired_card)
  const targetId1 = 'synth_04_expired_card';
  console.log(`\n--- Step 2: Requesting AI Explanation for AUTHORIZED item [${targetId1}] ---`);
  
  const opp1 = getOpportunityById(targetId1)!;
  const score1 = getScoreByOpportunityId(targetId1);
  const decision1 = getAllocationDecisionByOpportunityId(targetId1);
  const checks1 = getAuthorityChecksByOpportunityId(targetId1);

  console.log('Sending request to NVIDIA NIM API (nvidia/nemotron-3.5-lightning-30b-a3b)...');
  const result1 = await explainOpportunityDecision(opp1, score1, decision1, checks1);

  console.log('\n=== AI MODEL RESPONSE 1 (AUTHORIZED) ===');
  console.log('Opportunity ID:', result1.opportunity_id);
  console.log('Model:', result1.model);
  console.log('Provider:', result1.provider);
  if (result1.reasoning_content) {
    console.log('\n🧠 [Reasoning Content]:');
    console.log(result1.reasoning_content);
  }
  console.log('\n💬 [Synthesized Explanation]:');
  console.log(result1.explanation);

  // Test Case 2: Explain a BLOCKED opportunity (synth_01_stolen_card)
  const targetId2 = 'synth_01_stolen_card';
  console.log(`\n--- Step 3: Requesting AI Explanation for BLOCKED item [${targetId2}] ---`);
  
  const opp2 = getOpportunityById(targetId2)!;
  const score2 = getScoreByOpportunityId(targetId2);
  const decision2 = getAllocationDecisionByOpportunityId(targetId2);
  const checks2 = getAuthorityChecksByOpportunityId(targetId2);

  const result2 = await explainOpportunityDecision(opp2, score2, decision2, checks2);

  console.log('\n=== AI MODEL RESPONSE 2 (BLOCKED) ===');
  console.log('Opportunity ID:', result2.opportunity_id);
  console.log('Model:', result2.model);
  console.log('Provider:', result2.provider);
  if (result2.reasoning_content) {
    console.log('\n🧠 [Reasoning Content]:');
    console.log(result2.reasoning_content);
  }
  console.log('\n💬 [Synthesized Explanation]:');
  console.log(result2.explanation);

  if (result1.explanation && result2.explanation) {
    console.log('\n================================================================================');
    console.log('✅ PASS: NVIDIA NIM API (nvidia/nemotron-3.5-lightning-30b-a3b) successfully connected and generated structured decision explanations!');
    console.log('================================================================================\n');
  } else {
    console.error('❌ FAIL: Explanation generation failed.');
    process.exit(1);
  }
}

testLLMExplanation().catch((err) => {
  console.error('Fatal LLM Test Error:', err);
  process.exit(1);
});
