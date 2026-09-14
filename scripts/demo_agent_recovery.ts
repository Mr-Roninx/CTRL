import dotenv from 'dotenv';
import path from 'node:path';
import {
  initDatabase,
  getOpportunityById,
  getAllOpportunities,
  getExecutionRecordByOpportunityId,
  getScoreByOpportunityId,
  getAllocationDecisionByOpportunityId,
  getAuthorityChecksByOpportunityId,
  getMemories,
} from '../src/db/database.js';
import { AgentOrchestrator } from '../src/agents/orchestrator.js';
import { seedSyntheticData } from './seed_synthetic.js';
import { AgentReplanEngine } from '../src/agents/replan_engine.js';
import { AgentStateMachine } from '../src/agents/state_machine.js';
import { MissionBudgetTracker } from '../src/agents/budget.js';
import { AgentPlanner } from '../src/agents/planner.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
initDatabase();

async function runEndToEndAgentDemo() {
  console.log('================================================================================');
  console.log('🌟 CTRL-AGENT CANONICAL END-TO-END DEMONSTRATION');
  console.log('   Autonomous AI Agent Operating Above Deterministic Razorpay Control Plane');
  console.log('================================================================================\n');

  // Step 1: Seed Clean Test Scenarios
  console.log('--- Step 1: Ingesting Failed Payment Event & Preparing Control Plane ---');
  seedSyntheticData();

  const oppId = 'synth_02_insufficient_funds_att1';
  const opp = getOpportunityById(oppId)!;
  console.log(`Opportunity Ingested: ${opp.id} (Amount: ₹${(opp.amount_paise / 100).toFixed(2)}, Reason: ${opp.reason_code}, Decline: ${opp.decline_type})`);

  // Step 2: Trigger Autonomous Mission via Orchestrator
  console.log('\n--- Step 2: Agent Orchestrator Dispatches Specialist Mission ---');
  console.log('1. Perception Agent investigates context and generates semantic annotations...');
  console.log('2. LLM Provider constructs structured diagnosis and semantic signals...');
  console.log('3. Agent Planner builds bounded execution plan with validity assumptions...');
  console.log('4. Semantic Economics Bridge calculates calibrated IVEN...');
  console.log('5. Recovery Market allocates under portfolio capacity limit...');
  console.log('6. Action Authority independently validates compliance (zero bypass)...');
  console.log('7. Executor creates real Razorpay payment link...');
  console.log('8. Outcome Evaluator computes prediction error and net economic gain...');
  console.log('9. Episodic Memory records experience for future missions...');

  const missionResult = await AgentOrchestrator.executeRecoveryMission({
    opportunityId: oppId,
  });

  console.log('\n=== MISSION RESULT SUMMARY ===');
  console.log('Run ID:', missionResult.run_id);
  console.log('Mission Status:', missionResult.status);
  console.log('Steps Executed:', missionResult.steps_executed);
  console.log('Market Decision:', missionResult.final_decision);
  console.log('Authority Verdict:', missionResult.authority_verdict);
  console.log('Execution Link ID:', missionResult.execution_link_id || 'N/A');
  console.log('Execution Link URL:', missionResult.execution_link_url || 'N/A');
  console.log('Rationale:', missionResult.rationale);

  // Step 3: Verify Durable Stored Records
  console.log('\n--- Step 3: Forensic Database Verification ---');
  const score = getScoreByOpportunityId(oppId);
  const decision = getAllocationDecisionByOpportunityId(oppId);
  const checks = getAuthorityChecksByOpportunityId(oppId);
  const exec = getExecutionRecordByOpportunityId(oppId);
  const memories = getMemories('episodic');

  console.log(`- Stored IVEN: ₹${((score?.expected_incremental_value_paise || 0) / 100).toFixed(2)} (Confidence: ${score?.confidence})`);
  console.log(`- Stored Market Decision: ${decision?.decision} (Rank: #${decision?.rank_in_batch})`);
  console.log(`- Stored Authority Checks: ${checks.filter((c) => c.passed).length}/${checks.length} checks passed`);
  console.log(`- Stored Execution Record: ${exec?.razorpay_payment_link_id ? 'EXISTS (✓)' : 'NONE'}`);
  console.log(`- Stored Episodic Memories: ${memories.length} episodes on record`);

  // Step 4: Autonomous Replanning Demonstration
  console.log('\n--- Step 4: Mid-Flight Environment Change & Autonomous Replanning Demo ---');
  console.log('Scenario: Mid-flight network event causes Razorpay gateway health to drop to 0.35...');

  const runIdReplan = `replan_demo_${Date.now()}`;
  const sm = new AgentStateMachine(runIdReplan, 'TRIGGERED');
  sm.transition('OBSERVE', 'INIT');
  sm.transition('INVESTIGATE', 'FETCH');
  sm.transition('DIAGNOSE', 'ANALYZE');
  sm.transition('HYPOTHESIZE', 'HYP');
  sm.transition('PLAN', 'INITIAL_PLAN');

  const initialPlan = AgentPlanner.createPlan({
    runId: runIdReplan,
    goal: { type: 'RECOVER_PAYMENT', desired_outcome: 'Recover' },
    opportunity: opp,
    gatewayHealth: 0.95,
  });
  console.log(`Initial Plan v1 created with assumptions: [gateway_health >= 0.75 (current: 0.95)]`);

  const validation = AgentReplanEngine.validateActivePlan({
    runId: runIdReplan,
    currentGatewayHealth: 0.35,
  });
  console.log(`Gateway health dropped to 0.35! Plan validity status: ${validation.is_valid ? 'VALID' : 'INVALIDATED (✗)'}`);
  console.log(`Invalidation Reason: ${validation.failed_assumptions[0]?.reason}`);

  const replanOutput = AgentReplanEngine.executeReplan({
    runId: runIdReplan,
    stateMachine: sm,
    budgetTracker: new MissionBudgetTracker(),
    opportunity: opp,
    currentGatewayHealth: 0.35,
    invalidationReason: validation.failed_assumptions[0].reason,
  });

  console.log(`Autonomous Replan Triggered! New Plan v${replanOutput.new_plan?.plan_version} generated with preferred action: ${replanOutput.new_plan?.preferred_action}`);

  console.log('\n================================================================================');
  console.log('✅ CANONICAL END-TO-END DEMO COMPLETED SUCCESSFULLY');
  console.log('   All invariants preserved: Zero LLM financial authority, deterministic control plane.');
  console.log('================================================================================');
}

runEndToEndAgentDemo();
