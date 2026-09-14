import { LoopGuard } from '../../src/agents/loop_guard.js';

export function runLoopGuardTests() {
  console.log('🧪 Running Test: Loop Guard (Fingerprinting & Anti-Recursion)...');

  const guard = new LoopGuard(3, 2);

  // 1. First 2 identical calls allowed
  const payload = { opportunity_id: 'opp_123' };
  guard.recordToolExecution('get_opportunity', payload, true);
  guard.recordToolExecution('get_opportunity', payload, true);

  const check1 = guard.checkToolCall('get_opportunity', payload);
  if (!check1.allowed) {
    throw new Error('2nd call should be allowed');
  }

  // 3rd identical call
  guard.recordToolExecution('get_opportunity', payload, true);

  // 4th identical call must be blocked
  const check2 = guard.checkToolCall('get_opportunity', payload);
  if (check2.allowed) {
    throw new Error('Expected 4th identical consecutive tool call to be blocked by Loop Guard');
  }

  // 2. Cyclic Plan Detection
  const p1 = guard.checkPlanLoop(['step1', 'step2'], 'SEND_PAYMENT_LINK');
  if (!p1.allowed) throw new Error('First plan should be allowed');

  const p2 = guard.checkPlanLoop(['step1', 'step2'], 'SEND_PAYMENT_LINK');
  if (p2.allowed) throw new Error('Expected identical cyclic plan to be blocked by Loop Guard');

  console.log('  ✅ PASS: Loop Guard prevents tool loops and cyclic plan replanning.');
}

if (process.argv[1]?.endsWith('test_agent_loop_guard.ts')) {
  runLoopGuardTests();
}
