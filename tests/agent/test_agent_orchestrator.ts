import { AgentOrchestrator } from '../../src/agents/orchestrator.js';
import { initDatabase, upsertOpportunity } from '../../src/db/database.js';

export async function runOrchestratorTests() {
  console.log('🧪 Running Test: Agent Orchestrator End-to-End Recovery Mission...');
  initDatabase();

  const oppId = 'synth_02_insufficient_funds_att1';

  const result = await AgentOrchestrator.executeRecoveryMission({
    opportunityId: oppId,
  });

  if (result.status !== 'completed') {
    throw new Error(`Expected mission status 'completed', got '${result.status}'`);
  }

  if (result.steps_executed < 5) {
    throw new Error(`Expected multi-step mission trajectory, executed only ${result.steps_executed} steps`);
  }

  console.log(`  ✅ PASS: End-to-end agent recovery mission completed (${result.steps_executed} steps, decision: ${result.final_decision}, verdict: ${result.authority_verdict}).`);
}

if (process.argv[1]?.endsWith('test_agent_orchestrator.ts')) {
  runOrchestratorTests();
}
