import { setKillSwitch } from '../../src/authority/gate.js';
import { AgentOrchestrator } from '../../src/agents/orchestrator.js';
import { initDatabase, upsertOpportunity } from '../../src/db/database.js';

export async function runKillSwitchTests() {
  console.log('🧪 Running Test: Global Kill Switch Propagation to Agent Subsystems...');
  initDatabase();

  const oppId = `opp_kill_test_${Date.now()}`;
  upsertOpportunity({
    id: oppId,
    source: 'synthetic',
    amount_paise: 250000,
    currency: 'INR',
    reason_code: 'insufficient_funds',
    decline_type: 'soft',
    attempt_count: 1,
    customer_id: 'cust_kill',
    customer_trust_score: 0.8,
    created_at: new Date().toISOString(),
    status: 'pending',
  });

  // Engage Kill Switch
  setKillSwitch(true);

  const missionResult = await AgentOrchestrator.executeRecoveryMission({
    opportunityId: oppId,
  });

  // Disengage Kill Switch
  setKillSwitch(false);

  if (missionResult.status !== 'aborted' || missionResult.final_decision !== 'ABSTAIN') {
    throw new Error(`Expected mission to be aborted under kill switch, got: ${missionResult.status}`);
  }

  console.log('  ✅ PASS: Kill switch instantly halts agent orchestration loops, proposals, and execution.');
}

if (process.argv[1]?.endsWith('test_agent_kill_switch.ts')) {
  runKillSwitchTests();
}
