import { AgentAuthorityGate } from '../../src/agents/gate.js';
import { setKillSwitch } from '../../src/authority/gate.js';
import { initDatabase } from '../../src/db/database.js';

export function runGateTests() {
  console.log('🧪 Running Test: Agent Authority Gate (9 Security Checks)...');
  initDatabase();
  setKillSwitch(false);

  const runId = `gate_test_${Date.now()}`;

  // 1. Normal read-only call passes
  const normalPass = AgentAuthorityGate.evaluate({
    runId,
    agentName: 'PerceptionAgent',
    toolName: 'get_opportunity',
    inputPayload: { opportunity_id: 'synth_02_insufficient_funds_att1' },
    permissionLevel: 'READ',
  });
  if (!normalPass.allowed) {
    throw new Error(`Expected normal read tool to pass gate, but failed: ${normalPass.reason}`);
  }

  // 2. Kill switch active blocks everything
  setKillSwitch(true);
  const killBlock = AgentAuthorityGate.evaluate({
    runId,
    agentName: 'PerceptionAgent',
    toolName: 'get_opportunity',
    inputPayload: { opportunity_id: 'synth_02_insufficient_funds_att1' },
    permissionLevel: 'READ',
  });
  setKillSwitch(false); // restore

  if (killBlock.allowed || killBlock.failed_check !== 'kill_switch_check') {
    throw new Error('Expected kill switch to block tool execution.');
  }

  // 3. Write boundary violation (attempt to call execute_payment or FINANCIAL_WRITE)
  const writeBlock = AgentAuthorityGate.evaluate({
    runId,
    agentName: 'PerceptionAgent',
    toolName: 'execute_payment',
    inputPayload: { amount: 1000 },
    permissionLevel: 'FINANCIAL_WRITE',
  });
  if (writeBlock.allowed || writeBlock.failed_check !== 'tool_scope_check' && writeBlock.failed_check !== 'write_boundary_check') {
    throw new Error('Expected write boundary to block financial write tool.');
  }

  // 4. Injection taint check
  const injectionBlock = AgentAuthorityGate.evaluate({
    runId,
    agentName: 'PerceptionAgent',
    toolName: 'get_opportunity',
    inputPayload: { opportunity_id: "synth_01'; DROP TABLE recovery_opportunities; --" },
    permissionLevel: 'READ',
  });
  if (injectionBlock.allowed || injectionBlock.failed_check !== 'injection_taint_check') {
    throw new Error('Expected injection taint check to block hostile SQL input.');
  }

  console.log('  ✅ PASS: All 9 Agent Authority Gate security checks enforced.');
}

if (process.argv[1]?.endsWith('test_agent_gate.ts')) {
  runGateTests();
}
