import { LLMProvider } from '../../src/agents/llm_provider.js';
import { AgentContextBuilder } from '../../src/agents/context_builder.js';
import { RecoveryOpportunity } from '../../src/types/index.js';
import { initDatabase } from '../../src/db/database.js';

export async function runLLMFallbackTests() {
  console.log('🧪 Running Test: LLM Provider Abstraction & Deterministic Fallback Modes...');
  initDatabase();

  const opp: RecoveryOpportunity = {
    id: 'opp_fallback_1',
    source: 'synthetic',
    amount_paise: 450000,
    currency: 'INR',
    reason_code: 'stolen_card',
    decline_type: 'hard',
    attempt_count: 1,
    customer_id: 'cust_fb',
    customer_trust_score: 0.1,
    created_at: new Date().toISOString(),
    status: 'pending',
  };

  const context = AgentContextBuilder.buildContext({
    goal: 'Test fallback',
    opportunity: opp,
  });

  // Call LLMProvider: will either call real NVIDIA NIM if key exists or fall back to deterministic policy seamlessly
  const result = await LLMProvider.generateAgentIntent({
    runId: `run_fb_${Date.now()}`,
    opportunityId: opp.id,
    context,
  });

  if (!result.success || !result.intent) {
    throw new Error('LLMProvider failed to return structured intent');
  }

  // Verify diagnosis is populated
  if (!result.intent.diagnosis || !result.intent.diagnosis.root_cause) {
    throw new Error('Intent diagnosis is missing root_cause');
  }

  console.log(`  ✅ PASS: LLMProvider successfully generated structured AgentIntent (provider: ${result.provider}, is_fallback: ${result.is_fallback}).`);
}

if (process.argv[1]?.endsWith('test_agent_llm_fallback.ts')) {
  runLLMFallbackTests();
}
