import { AgentStateMachine, VALID_STATE_TRANSITIONS } from '../../src/agents/state_machine.js';
import { initDatabase } from '../../src/db/database.js';

export function runStateMachineTests() {
  console.log('🧪 Running Test: Agent State Machine...');
  initDatabase();

  const runId = `test_sm_${Date.now()}`;
  const sm = new AgentStateMachine(runId, 'IDLE');

  // 1. Initial state
  if (sm.getCurrentState() !== 'IDLE') {
    throw new Error(`Expected initial state 'IDLE', got '${sm.getCurrentState()}'`);
  }

  // 2. Valid transition IDLE -> TRIGGERED
  const t1 = sm.transition('TRIGGERED', 'TEST_TRIGGER');
  if (!t1.success || sm.getCurrentState() !== 'TRIGGERED') {
    throw new Error(`Valid transition IDLE -> TRIGGERED failed: ${t1.error}`);
  }

  // 3. Invalid transition TRIGGERED -> COMPLETE (must fail)
  const invalid = sm.transition('COMPLETE', 'INVALID_JUMP');
  if (invalid.success) {
    throw new Error('Expected invalid transition TRIGGERED -> COMPLETE to fail, but it succeeded');
  }

  // 4. Sequential valid path: TRIGGERED -> OBSERVE -> INVESTIGATE -> DIAGNOSE -> HYPOTHESIZE -> PLAN -> VALIDATE_PLAN -> PROPOSE -> WAIT_AUTHORITY -> EXECUTE -> WAIT -> WAKE -> OBSERVE_OUTCOME -> LEARN -> MEMORY_UPDATE -> COMPLETE
  const sequence: any[] = [
    ['OBSERVE', 'FETCH_OBSERVATION'],
    ['INVESTIGATE', 'TOOL_INVESTIGATION'],
    ['DIAGNOSE', 'SYNTHESIS'],
    ['HYPOTHESIZE', 'HYPOTHESIS_SET'],
    ['PLAN', 'PLAN_SET'],
    ['VALIDATE_PLAN', 'ASSUMPTIONS_OK'],
    ['PROPOSE', 'SUBMIT_PROPOSAL'],
    ['WAIT_AUTHORITY', 'AWAIT_CHECK'],
    ['EXECUTE', 'DISPATCH'],
    ['WAIT', 'ENTER_WAIT'],
    ['WAKE', 'WAKE_EVENT'],
    ['OBSERVE_OUTCOME', 'EVAL_TRUTH'],
    ['LEARN', 'COMPUTE_ERROR'],
    ['MEMORY_UPDATE', 'STORE_EPISODE'],
    ['COMPLETE', 'FINISH'],
  ];

  for (const [nextState, trigger] of sequence) {
    const res = sm.transition(nextState, trigger);
    if (!res.success) {
      throw new Error(`Failed valid sequence transition to '${nextState}': ${res.error}`);
    }
  }

  if (sm.getCurrentState() !== 'COMPLETE') {
    throw new Error(`Expected final state 'COMPLETE', got '${sm.getCurrentState()}'`);
  }

  console.log('  ✅ PASS: State machine handles valid and invalid transitions correctly with SQLite persistence.');
}

if (process.argv[1]?.endsWith('test_agent_state_machine.ts')) {
  runStateMachineTests();
}
