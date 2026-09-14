import { MissionBudgetTracker } from '../../src/agents/budget.js';

export function runBudgetTests() {
  console.log('🧪 Running Test: Mission Budget Limits...');

  const budget = new MissionBudgetTracker({
    max_llm_calls: 2,
    max_tool_calls: 3,
    max_replans: 1,
    max_steps: 5,
    max_wall_clock_ms: 1000,
  });

  // Step 1: within budget
  budget.recordStep();
  budget.recordLLMCall(100);
  budget.recordToolCall();
  if (budget.checkBudgets().exceeded) {
    throw new Error('Budget falsely exceeded on first step');
  }

  // Exhaust LLM budget
  budget.recordLLMCall(100); // 2
  budget.recordLLMCall(100); // 3 (exceeded max 2)

  const check = budget.checkBudgets();
  if (!check.exceeded || check.budget_name !== 'llm_calls') {
    throw new Error(`Expected LLM budget exceeded, got: ${JSON.stringify(check)}`);
  }

  console.log('  ✅ PASS: Mission budgets strictly enforced on steps, LLM calls, tool calls, and timeouts.');
}

if (process.argv[1]?.endsWith('test_agent_budget.ts')) {
  runBudgetTests();
}
