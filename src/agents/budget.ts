import { AgentBudgetConfig, DEFAULT_AGENT_BUDGET } from './types.js';

export interface BudgetUsage {
  llm_calls: number;
  tool_calls: number;
  replans: number;
  steps: number;
  total_tokens: number;
  start_time_ms: number;
  elapsed_ms: number;
}

export interface BudgetCheckResult {
  exceeded: boolean;
  budget_name?: 'llm_calls' | 'tool_calls' | 'replans' | 'steps' | 'wall_clock_ms';
  limit?: number;
  current?: number;
  message?: string;
}

export class MissionBudgetTracker {
  private config: AgentBudgetConfig;
  private usage: BudgetUsage;

  constructor(config: Partial<AgentBudgetConfig> = {}) {
    this.config = { ...DEFAULT_AGENT_BUDGET, ...config };
    this.usage = {
      llm_calls: 0,
      tool_calls: 0,
      replans: 0,
      steps: 0,
      total_tokens: 0,
      start_time_ms: Date.now(),
      elapsed_ms: 0,
    };
  }

  public getConfig(): AgentBudgetConfig {
    return { ...this.config };
  }

  public getUsage(): BudgetUsage {
    return {
      ...this.usage,
      elapsed_ms: Date.now() - this.usage.start_time_ms,
    };
  }

  public recordStep(): BudgetCheckResult {
    this.usage.steps += 1;
    return this.checkBudgets();
  }

  public recordLLMCall(tokensUsed: number = 0): BudgetCheckResult {
    this.usage.llm_calls += 1;
    this.usage.total_tokens += tokensUsed;
    return this.checkBudgets();
  }

  public recordToolCall(): BudgetCheckResult {
    this.usage.tool_calls += 1;
    return this.checkBudgets();
  }

  public recordReplan(): BudgetCheckResult {
    this.usage.replans += 1;
    return this.checkBudgets();
  }

  public checkBudgets(): BudgetCheckResult {
    const elapsed = Date.now() - this.usage.start_time_ms;

    if (this.usage.llm_calls > this.config.max_llm_calls) {
      return {
        exceeded: true,
        budget_name: 'llm_calls',
        limit: this.config.max_llm_calls,
        current: this.usage.llm_calls,
        message: `Exceeded maximum LLM calls budget (${this.usage.llm_calls}/${this.config.max_llm_calls})`,
      };
    }

    if (this.usage.tool_calls > this.config.max_tool_calls) {
      return {
        exceeded: true,
        budget_name: 'tool_calls',
        limit: this.config.max_tool_calls,
        current: this.usage.tool_calls,
        message: `Exceeded maximum tool calls budget (${this.usage.tool_calls}/${this.config.max_tool_calls})`,
      };
    }

    if (this.usage.replans > this.config.max_replans) {
      return {
        exceeded: true,
        budget_name: 'replans',
        limit: this.config.max_replans,
        current: this.usage.replans,
        message: `Exceeded maximum replans budget (${this.usage.replans}/${this.config.max_replans})`,
      };
    }

    if (this.usage.steps > this.config.max_steps) {
      return {
        exceeded: true,
        budget_name: 'steps',
        limit: this.config.max_steps,
        current: this.usage.steps,
        message: `Exceeded maximum steps budget (${this.usage.steps}/${this.config.max_steps})`,
      };
    }

    if (elapsed > this.config.max_wall_clock_ms) {
      return {
        exceeded: true,
        budget_name: 'wall_clock_ms',
        limit: this.config.max_wall_clock_ms,
        current: elapsed,
        message: `Exceeded maximum wall-clock timeout (${elapsed}ms / ${this.config.max_wall_clock_ms}ms)`,
      };
    }

    return { exceeded: false };
  }
}
