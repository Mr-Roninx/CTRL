import { runStateMachineTests } from './test_agent_state_machine.js';
import { runGateTests } from './test_agent_gate.js';
import { runBudgetTests } from './test_agent_budget.js';
import { runLoopGuardTests } from './test_agent_loop_guard.js';
import { runToolRegistryTests } from './test_agent_tool_registry.js';
import { runTemporalFirewallTests } from './test_agent_temporal_firewall.js';
import { runMemoryStoreTests } from './test_agent_memory.js';
import { runSchemaTests } from './test_agent_schema.js';
import { runPromptInjectionTests } from './test_agent_prompt_injection.js';
import { runToolInjectionTests } from './test_agent_tool_injection.js';
import { runSemanticSignalsTests } from './test_agent_semantic_signals.js';
import { runEconomicBridgeTests } from './test_agent_economic_bridge.js';
import { runAuthorityBoundaryTests } from './test_agent_authority_boundary.js';
import { runExecutionBoundaryTests } from './test_agent_execution_boundary.js';
import { runReplanningTests } from './test_agent_replanning.js';
import { runLearningTests } from './test_agent_learning.js';
import { runLLMFallbackTests } from './test_agent_llm_fallback.js';
import { runTraceTests } from './test_agent_trace.js';
import { runKillSwitchTests } from './test_agent_kill_switch.js';
import { runOrchestratorTests } from './test_agent_orchestrator.js';
import { runSpecialistTests } from './test_agent_specialists.js';
import { runProviderTruthInvariantTests } from '../truth/test_provider_truth_invariants.js';
import { runUncertaintyTests } from './test_uncertainty.js';
import { runInformationValueTests } from './test_information_value.js';
import { runPlanMonitorTests } from './test_plan_monitor.js';
import { runPortfolioAgentTests } from './test_portfolio_agent.js';
import { runConcurrencyTests } from './test_concurrency.js';
import { runReplayTests } from './test_replay.js';
import { seedSyntheticData } from '../../scripts/seed_synthetic.js';

async function runAllAgentTests() {
  console.log('======================================================================');
  console.log('🚀 CTRL-AGENT MASTER TEST SUITE EXECUTION');
  console.log('======================================================================\n');

  // Guarantee test database contains synthetic fixtures
  seedSyntheticData();

  let passed = 0;
  let failed = 0;

  const testList: [string, () => any][] = [
    ['State Machine (21 States & Transitions)', runStateMachineTests],
    ['Authority Gate (9 Security Checks)', runGateTests],
    ['Mission Budgets & Hard Limits', runBudgetTests],
    ['Loop Guard & Anti-Recursion', runLoopGuardTests],
    ['Tool Registry & 18 Bounded Tools', runToolRegistryTests],
    ['Temporal Memory Firewall (Anti-Lookahead)', runTemporalFirewallTests],
    ['Memory Store (Working/Episodic/Semantic)', runMemoryStoreTests],
    ['Schema Validation & Sanitization', runSchemaTests],
    ['Prompt Injection & Adversarial Text Defense', runPromptInjectionTests],
    ['Tool Injection & Boundary Protection', runToolInjectionTests],
    ['Semantic Signals & Normalization', runSemanticSignalsTests],
    ['Economic Bridge & Safety Invariants', runEconomicBridgeTests],
    ['Action Authority Independent Compliance Gate', runAuthorityBoundaryTests],
    ['Execution Boundary & Zero-Bypass', runExecutionBoundaryTests],
    ['Plan Validation, Invalidation & Replanning', runReplanningTests],
    ['Outcome Evaluation & Auditable Learning', runLearningTests],
    ['LLM Provider Abstraction & Fallbacks', runLLMFallbackTests],
    ['Mission Telemetry & Trace Correlation', runTraceTests],
    ['Global Kill Switch Propagation', runKillSwitchTests],
    ['Specialist Capabilities (5 Specialists)', runSpecialistTests],
    ['Provider Truth & Recovery Invariants', runProviderTruthInvariantTests],
    ['Agent Orchestrator End-to-End Mission', runOrchestratorTests],
    // v5.1 Step 1: Portfolio Intelligence
    ['Uncertainty Model (3 Dimensions)', runUncertaintyTests],
    ['Information Value Estimator', runInformationValueTests],
    ['Plan Monitor & Assumption Validation', runPlanMonitorTests],
    ['Portfolio Agent (Multi-Opportunity)', runPortfolioAgentTests],
    // v5.1 Steps 4 & 5: Concurrency & Replay
    ['Mission Concurrency Coordinator', runConcurrencyTests],
    ['Mission Replay & Cryptographic Fingerprinting', runReplayTests],
  ];

  for (const [name, fn] of testList) {
    try {
      await fn();
      passed++;
    } catch (err: any) {
      console.error(`❌ FAILED: ${name}`);
      console.error(err);
      failed++;
    }
  }

  console.log('\n======================================================================');
  console.log(`🏁 AGENT TEST SUITE COMPLETED: ${passed} PASSED | ${failed} FAILED`);
  console.log('======================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllAgentTests();
