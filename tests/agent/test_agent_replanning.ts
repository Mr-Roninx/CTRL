import { AgentPlanner } from '../../src/agents/planner.js';
import { AgentReplanEngine } from '../../src/agents/replan_engine.js';
import { AgentStateMachine } from '../../src/agents/state_machine.js';
import { MissionBudgetTracker } from '../../src/agents/budget.js';
import { RecoveryOpportunity } from '../../src/types/index.js';
import { initDatabase } from '../../src/db/database.js';

export function runReplanningTests() {
  console.log('🧪 Running Test: Plan Validation, Invalidation & Replanning Flow...');
  initDatabase();

  const runId = `replan_test_${Date.now()}`;
  const opp: RecoveryOpportunity = {
    id: `opp_replan_${Date.now()}`,
    source: 'synthetic',
    amount_paise: 250000,
    currency: 'INR',
    reason_code: 'insufficient_funds',
    decline_type: 'soft',
    attempt_count: 1,
    customer_id: 'cust_replan_1',
    customer_trust_score: 0.8,
    created_at: new Date().toISOString(),
    status: 'pending',
  };

  const sm = new AgentStateMachine(runId, 'TRIGGERED');
  sm.transition('OBSERVE', 'INIT');
  sm.transition('INVESTIGATE', 'FETCH_DATA');
  sm.transition('DIAGNOSE', 'ANALYZE');
  sm.transition('HYPOTHESIZE', 'HYP_SET');
  sm.transition('PLAN', 'INITIAL_PLAN');

  const budget = new MissionBudgetTracker();

  // 1. Create Initial Plan v1 (assuming gateway health = 0.95)
  const initialPlanResult = AgentPlanner.createPlan({
    runId,
    goal: { type: 'RECOVER_PAYMENT', desired_outcome: 'Recover' },
    opportunity: opp,
    gatewayHealth: 0.95,
  });

  if (!initialPlanResult.is_valid || initialPlanResult.plan.plan_version !== 1) {
    throw new Error('Initial plan creation failed');
  }

  // 2. Validate plan when environment is healthy, enter WAIT
  sm.transition('VALIDATE_PLAN', 'ASSUMPTIONS_OK');
  sm.transition('PROPOSE', 'SUBMIT_PROPOSAL');
  sm.transition('WAIT_AUTHORITY', 'AWAITING_CORE');
  sm.transition('WAIT', 'DEFERRED_FOR_GATEWAY');

  const validCheck = AgentReplanEngine.validateActivePlan({
    runId,
    currentGatewayHealth: 0.95,
  });
  if (!validCheck.is_valid) {
    throw new Error('Expected plan to be valid under healthy gateway');
  }

  // 3. Simulate Environment Change mid-mission: Gateway health drops to 0.40
  // Wake trigger occurs from timer or polling hook
  sm.transition('WAKE', 'GATEWAY_POLL_TICK');

  const brokenCheck = AgentReplanEngine.validateActivePlan({
    runId,
    currentGatewayHealth: 0.40,
  });
  if (brokenCheck.is_valid) {
    throw new Error('Expected plan validation to fail when gateway health degrades to 0.40');
  }

  // 4. Trigger Replanning Flow (WAKE -> PLAN_INVALIDATED -> REPLAN -> PLAN)
  const replanResult = AgentReplanEngine.executeReplan({
    runId,
    stateMachine: sm,
    budgetTracker: budget,
    opportunity: opp,
    currentGatewayHealth: 0.40,
    invalidationReason: brokenCheck.failed_assumptions[0].reason,
  });

  if (!replanResult.replanned || replanResult.new_plan?.plan_version !== 2) {
    throw new Error(`Replanning failed: ${replanResult.error}`);
  }

  if (sm.getCurrentState() !== 'PLAN') {
    throw new Error(`Expected state to be PLAN after replan, got ${sm.getCurrentState()}`);
  }

  console.log('  ✅ PASS: FAILURE -> PLAN -> WAIT -> ENVIRONMENT CHANGES -> WAKE -> PLAN INVALIDATED -> REPLAN -> PLAN (Plan v2 generated).');
}

if (process.argv[1]?.endsWith('test_agent_replanning.ts')) {
  runReplanningTests();
}
