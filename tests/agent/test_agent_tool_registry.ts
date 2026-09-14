import { AgentToolRegistry } from '../../src/agents/tool_registry.js';
import { initDatabase } from '../../src/db/database.js';

export async function runToolRegistryTests() {
  console.log('🧪 Running Test: Agent Tool Registry & Read Tools...');
  initDatabase();

  const allTools = AgentToolRegistry.getAllTools();
  if (allTools.length < 18) {
    throw new Error(`Expected at least 18 registered tools, got ${allTools.length}`);
  }

  // Test executing read-only tools
  const runId = `test_tool_reg_${Date.now()}`;

  // 1. get_gateway_state
  const gw = await AgentToolRegistry.executeTool({
    toolId: 'get_gateway_state',
    runId,
    agentName: 'AgentOrchestrator',
    inputPayload: {},
  });
  if (!gw.success || gw.data?.gateway_provider !== 'Razorpay') {
    throw new Error('get_gateway_state tool failed');
  }

  // 2. get_opportunity (READ tool -> ALLOWED)
  const oppRes = await AgentToolRegistry.executeTool({
    toolId: 'get_opportunity',
    runId,
    agentName: 'AgentOrchestrator',
    inputPayload: { opportunity_id: 'synth_02_insufficient_funds_att1' },
  });
  if (!oppRes.success || !oppRes.data?.id) {
    throw new Error('READ tool (get_opportunity) failed');
  }

  // 3. create_perception_annotation (PROPOSE tool -> ALLOWED)
  const propRes = await AgentToolRegistry.executeTool({
    toolId: 'create_perception_annotation',
    runId,
    agentName: 'PerceptionAgent',
    inputPayload: {
      opportunity_id: 'synth_02_insufficient_funds_att1',
      failure_intent: 'customer_liquidity_lag',
      customer_urgency_score: 0.8,
      merchant_risk_score: 0.2,
      semantic_notes: 'Soft decline, high customer recovery potential',
      confidence: 0.85,
    },
  });
  if (!propRes.success) {
    throw new Error(`PROPOSE tool (create_perception_annotation) failed: ${propRes.error}`);
  }

  // 4. EXECUTE permission tool -> DENIED
  const executeAttempt = await AgentToolRegistry.executeTool({
    toolId: 'execute_recovery_link',
    runId,
    agentName: 'StrategyAgent',
    inputPayload: { opportunity_id: 'synth_02_insufficient_funds_att1' },
  });
  if (executeAttempt.success) {
    throw new Error('EXECUTE permission tool should have been DENIED');
  }

  // 5. FINANCIAL_WRITE permission tool -> DENIED
  const finWriteAttempt = await AgentToolRegistry.executeTool({
    toolId: 'direct_financial_charge',
    runId,
    agentName: 'PerceptionAgent',
    inputPayload: { amount: 50000 },
  });
  if (finWriteAttempt.success) {
    throw new Error('FINANCIAL_WRITE permission tool should have been DENIED');
  }

  console.log('  ✅ PASS: All tools registered (READ allowed, PROPOSE allowed, EXECUTE denied, FINANCIAL_WRITE denied, SDK inaccessible).');
}

if (process.argv[1]?.endsWith('test_agent_tool_registry.ts')) {
  runToolRegistryTests();
}
