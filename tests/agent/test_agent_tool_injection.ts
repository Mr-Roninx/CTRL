import { AgentToolRegistry } from '../../src/agents/tool_registry.js';
import { initDatabase } from '../../src/db/database.js';

export async function runToolInjectionTests() {
  console.log('🧪 Running Test: Tool Injection & Unauthorized Boundary Violation Defense...');
  initDatabase();

  const runId = 'sec_tool_inj_1';

  // 1. Attempt to execute unregistered or forbidden write tool
  const forbiddenAttempt = await AgentToolRegistry.executeTool({
    toolId: 'execute_payment',
    runId,
    agentName: 'PerceptionAgent',
    inputPayload: { amount: 500000 },
  });

  if (forbiddenAttempt.success) {
    throw new Error('Forbidden tool execution should have failed!');
  }

  // 2. Attempt to pass unauthorized agent name
  const unauthorizedAgent = await AgentToolRegistry.executeTool({
    toolId: 'get_opportunity',
    runId,
    agentName: 'MaliciousAttackerAgent' as any,
    inputPayload: { opportunity_id: 'synth_01_stolen_card' },
  });

  if (unauthorizedAgent.success || !unauthorizedAgent.denied) {
    throw new Error('Unregistered agent should be blocked by AgentAuthorityGate');
  }

  console.log('  ✅ PASS: Tool injection and unauthorized agent execution blocked by architecture.');
}

if (process.argv[1]?.endsWith('test_agent_tool_injection.ts')) {
  runToolInjectionTests();
}
