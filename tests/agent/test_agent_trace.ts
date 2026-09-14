import { AgentTelemetry } from '../../src/agents/telemetry.js';
import { initDatabase, insertAgentRun } from '../../src/db/database.js';

export function runTraceTests() {
  console.log('🧪 Running Test: Agent Mission Telemetry & Trace Correlation...');
  initDatabase();

  const runId = `trace_run_${Date.now()}`;
  insertAgentRun({
    id: runId,
    mission_id: `miss_${runId}`,
    opportunity_id: 'synth_02_insufficient_funds_att1',
    goal_type: 'RECOVER_PAYMENT',
    status: 'completed',
    start_time: new Date().toISOString(),
    end_time: new Date().toISOString(),
    total_steps: 3,
    llm_calls: 1,
    tool_calls: 2,
    replan_count: 0,
    total_tokens: 150,
    latency_ms: 250,
    termination_reason: 'Completed',
    created_at: new Date().toISOString(),
  });

  AgentTelemetry.logStep({
    runId,
    stepNumber: 1,
    state: 'OBSERVE',
    observation: 'Observed opportunity synth_02',
    thought: 'Investigating customer history',
  });

  AgentTelemetry.logToolCall({
    id: `tc_${Date.now()}`,
    runId,
    toolName: 'get_opportunity',
    agentName: 'PerceptionAgent',
    inputPayload: { id: 'synth_02' },
    outputPayload: { status: 'pending' },
    status: 'SUCCESS',
    latencyMs: 15,
    permissionLevel: 'READ',
  });

  const trace = AgentTelemetry.getMissionTrace(runId);
  if (trace.steps.length !== 1 || trace.tool_calls.length !== 1) {
    throw new Error('Trace correlation mismatch');
  }

  console.log('  ✅ PASS: Agent telemetry logs steps and tool calls with full trace correlation.');
}

if (process.argv[1]?.endsWith('test_agent_trace.ts')) {
  runTraceTests();
}
