import crypto from 'node:crypto';
import { RecoveryOpportunity, Score, AllocationDecision, AuthorityVerdict } from '../types/index.js';
import {
  AgentRunRecord,
  AgentBudgetConfig,
  DEFAULT_AGENT_BUDGET,
  SemanticSignal,
} from './types.js';
import { AgentStateMachine } from './state_machine.js';
import { MissionBudgetTracker, BudgetCheckResult } from './budget.js';
import { LoopGuard } from './loop_guard.js';
import { AgentContextBuilder } from './context_builder.js';
import { AgentMemoryStore } from './memory.js';
import { AgentTelemetry } from './telemetry.js';
import { AgentToolRegistry } from './tool_registry.js';
import { ReasoningEngine, ReasoningStepOutput, ReasoningContext } from './reasoning_engine.js';
import { SemanticEconomicsBridge } from './bridge.js';
import { AgentLearningEngine } from './learning.js';
import { PerceptionAgent } from './specialists/perception_agent.js';
import { isKillSwitchActive } from '../authority/gate.js';
import {
  insertAgentRun,
  updateAgentRun,
  getOpportunityById,
  getCustomerById,
  getScoreByOpportunityId,
  upsertScore,
  upsertAllocationDecision,
  updateOpportunityStatus,
} from '../db/database.js';
import { evaluateOpportunity } from '../authority/gate.js';
import { runMarketAllocation } from '../market/allocator.js';
import { executeOpportunity } from '../execution/executor.js';
import { OutreachAgent } from './specialists/outreach_agent.js';
import { withSpan, CTRL_SPANS } from '../observability/otel.js';

/**
 * Result of a single agent loop iteration.
 */
export interface LoopIterationResult {
  iteration: number;
  state: string;
  reasoning: ReasoningStepOutput;
  tool_executed: boolean;
  tool_result?: { tool_name: string; result_summary: string };
  budget_status: BudgetCheckResult;
  should_continue: boolean;
  timestamp: string;
}

/**
 * Final result of a complete agent loop execution.
 */
export interface AgentLoopResult {
  run_id: string;
  opportunity_id: string;
  status: 'completed' | 'aborted' | 'human_review' | 'budget_exceeded';
  final_decision: 'ACT' | 'WAIT' | 'ABSTAIN';
  authority_verdict: AuthorityVerdict;
  execution_link_id?: string;
  execution_link_url?: string;
  iterations_executed: number;
  reasoning_trace: LoopIterationResult[];
  total_llm_calls: number;
  total_tool_calls: number;
  total_tokens: number;
  latency_ms: number;
  rationale: string;
  semantic_signals: SemanticSignal[];
}

/**
 * AgentLoop — The Autonomous Observe-Reason-Act-Learn Engine
 *
 * This replaces the linear orchestrator pipeline with a genuine agent loop:
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │                                                     │
 *   │   OBSERVE → REASON → (TOOL_CALL?) → EVALUATE →     │
 *   │      ↑                                    │         │
 *   │      └────── continue? ←──────────────────┘         │
 *   │                                                     │
 *   │   When done: PROPOSE → MARKET → AUTHORITY → EXEC   │
 *   └─────────────────────────────────────────────────────┘
 *
 * KEY INVARIANTS (preserved from original design):
 * 1. LLM reasons and proposes — it NEVER executes or decides
 * 2. Deterministic economics (IVEN) is the sole financial authority
 * 3. Action Authority gate vetoes independently of economics
 * 4. Kill switch halts the loop immediately
 * 5. Every iteration is stored as an auditable AgentStepRecord
 * 6. Budget limits enforce bounded execution (max 8 LLM, 20 tools, 40 steps, 30s)
 */
export class AgentLoop {
  private stateMachine: AgentStateMachine;
  private budgetTracker: MissionBudgetTracker;
  private loopGuard: LoopGuard;
  private runId: string;
  private startTime: number;
  private reasoningTrace: LoopIterationResult[] = [];
  private accumulatedSignals: SemanticSignal[] = [];
  private priorObservations: string[] = [];
  private toolResults: Array<{ tool_name: string; result_summary: string }> = [];

  constructor(
    runId: string,
    budgetConfig?: Partial<AgentBudgetConfig>,
  ) {
    this.runId = runId;
    this.startTime = Date.now();
    this.stateMachine = new AgentStateMachine(runId, 'IDLE');
    this.budgetTracker = new MissionBudgetTracker(budgetConfig);
    this.loopGuard = new LoopGuard();
  }

  /**
   * Execute the full autonomous agent loop for a recovery opportunity.
   *
   * This is the entry point called by the orchestrator. It runs:
   * 1. Perception enrichment (one-time)
   * 2. Iterative reasoning loop (observe → reason → tool_call? → evaluate)
   * 3. Economic scoring with semantic bridge
   * 4. Market allocation
   * 5. Authority gate check
   * 6. Execution (if AUTHORIZED)
   * 7. Outcome evaluation & learning
   */
  public async run(params: {
    opportunityId: string;
    tenantId?: string;
    environment?: 'SYNTHETIC' | 'FIXTURE' | 'RAZORPAY_TEST' | 'PROVIDER_VERIFIED';
  }): Promise<AgentLoopResult> {
    const opp = getOpportunityById(params.opportunityId, params.tenantId);
    if (!opp) {
      throw new Error(`AgentLoop: Opportunity '${params.opportunityId}' not found${params.tenantId ? ` for tenant '${params.tenantId}'` : ''}.`);
    }

    // Create run record
    const missionId = `miss_${Date.now()}_${params.opportunityId.slice(0, 8)}`;
    const runRecord: AgentRunRecord = {
      id: this.runId,
      mission_id: missionId,
      opportunity_id: opp.id,
      goal_type: 'RECOVER_PAYMENT',
      status: 'running',
      start_time: new Date().toISOString(),
      end_time: null,
      total_steps: 0,
      llm_calls: 0,
      tool_calls: 0,
      replan_count: 0,
      total_tokens: 0,
      latency_ms: 0,
      termination_reason: null,
      created_at: new Date().toISOString(),
    };
    insertAgentRun(runRecord);

    // ── Gate: Kill Switch ──
    this.stateMachine.transition('TRIGGERED', 'OPPORTUNITY_INGESTED', { opp_id: opp.id });
    this.budgetTracker.recordStep();

    if (isKillSwitchActive()) {
      return this.abort(opp, 'Global kill switch is active. Agent mission halted.');
    }

    // ── Phase 1: Perception Enrichment (one-time) ──
    this.stateMachine.transition('OBSERVE', 'PERCEPTION_ENRICHMENT');
    this.budgetTracker.recordStep();

    const customer = getCustomerById(opp.customer_id);
    const existingScore = getScoreByOpportunityId(opp.id);

    try {
      await PerceptionAgent.analyzeOpportunity({ runId: this.runId, opportunity: opp });
    } catch (err: any) {
      console.warn('AgentLoop: Perception enrichment failed (non-fatal):', err?.message);
    }

    const memories = AgentMemoryStore.queryEpisodicMemories({
      failureType: opp.reason_code,
      cutoffTimestamp: opp.created_at,
    });

    this.priorObservations.push(
      `Initial: ${opp.decline_type} decline, reason=${opp.reason_code}, amount=₹${(opp.amount_paise / 100).toFixed(2)}, attempts=${opp.attempt_count}`
    );

    // ── Phase 2: Iterative Reasoning Loop ──
    this.stateMachine.transition('INVESTIGATE', 'BEGIN_REASONING_LOOP');
    this.budgetTracker.recordStep();

    const maxIterations = 3; // Max reasoning-tool cycles
    let iterationCount = 0;

    for (let i = 0; i < maxIterations; i++) {
      // Check kill switch every iteration
      if (isKillSwitchActive()) {
        return this.abort(opp, 'Kill switch engaged during reasoning loop.');
      }

      // Check budget
      const budgetCheck = this.budgetTracker.checkBudgets();
      if (budgetCheck.exceeded) {
        return this.budgetExceeded(opp, budgetCheck);
      }

      // Build reasoning context with accumulated knowledge
      const reasoningCtx: ReasoningContext = {
        opportunity: opp,
        score: existingScore ?? null,
        customer_trust_score: customer?.trust_score ?? opp.customer_trust_score ?? 0.65,
        gateway_health: 0.98,
        prior_observations: [...this.priorObservations],
        tool_results: [...this.toolResults],
        memory_fragments: memories.slice(0, 5).map(m => m.context_summary),
        iteration: i,
        max_iterations: maxIterations,
      };

      // REASON: Get structured reasoning output
      this.stateMachine.transition('DIAGNOSE', `REASONING_STEP_${i + 1}`);
      this.budgetTracker.recordStep();

      const reasoningOutput = await withSpan(
        CTRL_SPANS.AGENT_ITERATION,
        {
          opportunity_id: opp.id,
          iteration: i + 1,
          run_id: this.runId,
        },
        async () =>
          ReasoningEngine.reason({
            runId: this.runId,
            context: reasoningCtx,
          })
      );

      // Accumulate semantic signals
      this.accumulatedSignals.push(...reasoningOutput.semantic_signals);

      // Execute tool if reasoning suggests investigation
      let toolExecuted = false;
      let toolResult: { tool_name: string; result_summary: string } | undefined;

      if (reasoningOutput.tool_choice && reasoningOutput.should_continue) {
        toolExecuted = true;
        const toolCallResult = await this.executeInvestigationTool(
          reasoningOutput.tool_choice.tool_name,
          reasoningOutput.tool_choice.params,
          opp,
          params.environment,
        );
        toolResult = {
          tool_name: reasoningOutput.tool_choice.tool_name,
          result_summary: toolCallResult,
        };
        this.toolResults.push(toolResult);
        this.priorObservations.push(`Tool [${toolResult.tool_name}]: ${toolResult.result_summary}`);
      }

      // Record iteration
      const iterResult: LoopIterationResult = {
        iteration: i + 1,
        state: this.stateMachine.getCurrentState(),
        reasoning: reasoningOutput,
        tool_executed: toolExecuted,
        tool_result: toolResult,
        budget_status: this.budgetTracker.checkBudgets(),
        should_continue: reasoningOutput.should_continue,
        timestamp: new Date().toISOString(),
      };
      this.reasoningTrace.push(iterResult);
      iterationCount = i + 1;

      // If reasoning says we're done, break out of loop
      if (!reasoningOutput.should_continue) {
        break;
      }
    }

    // ── Phase 3: Economic Scoring via Semantic Bridge ──
    this.stateMachine.transition('HYPOTHESIZE', 'ECONOMIC_SCORING');
    this.budgetTracker.recordStep();

    // Deduplicate signals by name, keeping highest-confidence version
    const deduplicatedSignals = this.deduplicateSignals(this.accumulatedSignals);
    const calibratedEcon = SemanticEconomicsBridge.scoreWithSemanticBridge(opp, deduplicatedSignals);
    upsertScore(calibratedEcon.score);

    // ── Phase 4: Market Allocation ──
    this.stateMachine.transition('PLAN', 'MARKET_ALLOCATION');
    this.budgetTracker.recordStep();

    const oppTenantId = opp.tenant_id || (opp as any).merchant_id;
    const marketRun = await withSpan(
      CTRL_SPANS.MARKET_ALLOCATION,
      { opportunity_id: opp.id, run_id: this.runId },
      async () => runMarketAllocation({ capacity: 5, tenantId: oppTenantId })
    );
    const marketItem = marketRun.items.find(d => d.opportunity_id === opp.id);
    const allocation: AllocationDecision = marketItem
      ? {
          opportunity_id: marketItem.opportunity_id,
          decision: marketItem.decision,
          rank_in_batch: marketItem.rank_in_batch,
          shadow_price_paise_at_decision: marketItem.shadow_price_paise_at_decision,
          reason: marketItem.reason,
        }
      : {
          opportunity_id: opp.id,
          decision: opp.decline_type === 'hard' ? 'ABSTAIN' : 'WAIT',
          rank_in_batch: 999,
          shadow_price_paise_at_decision: 0,
          reason: opp.decline_type === 'hard' ? 'Hard decline: issuer security stop' : 'Outside portfolio capacity limit',
        };
    upsertAllocationDecision(allocation);

    // ── Phase 5: Action Authority Gate ──
    this.stateMachine.transition('WAIT_AUTHORITY', 'AUTHORITY_EVALUATION');
    this.budgetTracker.recordStep();

    const authResult = await withSpan(
      CTRL_SPANS.AUTHORITY_CHECK,
      { opportunity_id: opp.id, run_id: this.runId, decision: allocation.decision },
      async () => evaluateOpportunity(opp, allocation, calibratedEcon.score)
    );

    // ── Phase 6: Execution (if AUTHORIZED) ──
    let executionPlinkId: string | undefined;
    let executionPlinkUrl: string | undefined;

    if (authResult.verdict === 'AUTHORIZED' && allocation.decision === 'ACT') {
      this.stateMachine.transition('EXECUTE', 'DISPATCH_TO_EXECUTOR');
      this.budgetTracker.recordStep();

      const execResult = await withSpan(
        CTRL_SPANS.EXECUTION_DISPATCH,
        { opportunity_id: opp.id, run_id: this.runId },
        async () => executeOpportunity(opp.id)
      );
      if (execResult.success && execResult.record) {
        executionPlinkId = execResult.record.razorpay_payment_link_id;
        executionPlinkUrl = execResult.record.link_url;

        // Draft outreach communication
        try {
          await OutreachAgent.draftCustomerCommunication({
            runId: this.runId,
            opportunity: opp,
            channel: 'SMS',
            paymentLinkUrl: executionPlinkUrl,
          });
        } catch (err: any) {
          console.warn('AgentLoop: Outreach draft failed (non-fatal):', err?.message);
        }
      }
    } else {
      updateOpportunityStatus(opp.id, authResult.verdict === 'BLOCKED' ? 'blocked' : 'abstained');
    }

    // ── Phase 7: Outcome Evaluation & Learning ──
    this.stateMachine.transition('OBSERVE_OUTCOME', 'EVALUATE_OUTCOME');
    this.budgetTracker.recordStep();

    AgentLearningEngine.evaluateOutcome({
      runId: this.runId,
      opportunityId: opp.id,
      actualRecovered: authResult.verdict === 'AUTHORIZED',
      actualRevenuePaise: opp.amount_paise,
      customerResponse: authResult.verdict === 'AUTHORIZED' ? 'Payment link dispatched via agent loop' : 'Agent decided not to act',
    });

    this.stateMachine.transition('LEARN', 'UPDATE_MEMORY');
    this.budgetTracker.recordStep();

    // Store episodic memory of this mission
    AgentMemoryStore.recordEpisode({
      runId: this.runId,
      opportunityId: opp.id,
      failureType: opp.reason_code || 'unknown',
      summary: `Agent loop completed ${iterationCount} reasoning iterations. Decision: ${allocation.decision}. Authority: ${authResult.verdict}.`,
      actionTaken: allocation.decision,
      predictedOutcome: `IVEN=₹${(calibratedEcon.score.expected_incremental_value_paise / 100).toFixed(2)}`,
      actualOutcome: authResult.verdict === 'AUTHORIZED' ? 'DISPATCHED' : 'NOT_DISPATCHED',
      provenance: 'AgentLoop:run',
    });

    this.stateMachine.transition('MEMORY_UPDATE', 'PERSIST_EPISODIC');
    this.budgetTracker.recordStep();

    this.stateMachine.transition('COMPLETE', 'MISSION_COMPLETED');

    // Finalize run record
    const usage = this.budgetTracker.getUsage();
    const totalLatency = Date.now() - this.startTime;

    updateAgentRun({
      id: this.runId,
      status: 'completed',
      end_time: new Date().toISOString(),
      total_steps: usage.steps,
      llm_calls: usage.llm_calls,
      tool_calls: usage.tool_calls,
      replan_count: 0,
      total_tokens: usage.total_tokens,
      latency_ms: totalLatency,
      termination_reason: `Agent loop completed after ${iterationCount} reasoning iterations`,
    });

    // Determine rationale from final reasoning output
    const finalReasoning = this.reasoningTrace[this.reasoningTrace.length - 1];
    const rationale = finalReasoning?.reasoning?.thought || `Agent loop processed ${opp.id} with ${iterationCount} iterations.`;

    const effectiveDecision: 'ACT' | 'WAIT' | 'ABSTAIN' =
      authResult.verdict === 'BLOCKED' || opp.decline_type === 'hard'
        ? 'ABSTAIN'
        : allocation.decision;

    return {
      run_id: this.runId,
      opportunity_id: opp.id,
      status: 'completed',
      final_decision: effectiveDecision,
      authority_verdict: authResult.verdict,
      execution_link_id: executionPlinkId,
      execution_link_url: executionPlinkUrl,
      iterations_executed: iterationCount,
      reasoning_trace: this.reasoningTrace,
      total_llm_calls: usage.llm_calls,
      total_tool_calls: usage.tool_calls,
      total_tokens: usage.total_tokens,
      latency_ms: totalLatency,
      rationale,
      semantic_signals: deduplicatedSignals,
    };
  }

  /**
   * Execute a read-only investigation tool via the Tool Registry.
   */
  private async executeInvestigationTool(
    toolName: string,
    params: Record<string, any>,
    opp: RecoveryOpportunity,
    environment?: string,
  ): Promise<string> {
    this.stateMachine.transition('OBSERVE', `TOOL_CALL_${toolName}`);
    this.budgetTracker.recordToolCall();

    try {
      const result = await AgentToolRegistry.executeTool({
        toolId: toolName,
        runId: this.runId,
        agentName: 'AgentOrchestrator',
        inputPayload: { ...params, opportunity_id: opp.id },
        budgetTracker: this.budgetTracker,
        loopGuard: this.loopGuard,
        environment: environment as any,
      });

      if (result.success) {
        return typeof result.data === 'string'
          ? result.data.slice(0, 500)
          : JSON.stringify(result.data).slice(0, 500);
      }

      return `Tool ${toolName} failed: ${result.error || 'unknown error'}`;
    } catch (err: any) {
      return `Tool ${toolName} error: ${err?.message || 'execution failed'}`;
    }
  }

  /**
   * Abort the mission due to kill switch or critical error.
   */
  private abort(opp: RecoveryOpportunity, reason: string): AgentLoopResult {
    this.stateMachine.transition('ABORTED', 'MISSION_ABORTED');
    const totalLatency = Date.now() - this.startTime;
    const usage = this.budgetTracker.getUsage();

    updateAgentRun({
      id: this.runId,
      status: 'aborted',
      end_time: new Date().toISOString(),
      total_steps: usage.steps,
      llm_calls: usage.llm_calls,
      tool_calls: usage.tool_calls,
      replan_count: 0,
      total_tokens: usage.total_tokens,
      latency_ms: totalLatency,
      termination_reason: reason,
    });

    return {
      run_id: this.runId,
      opportunity_id: opp.id,
      status: 'aborted',
      final_decision: 'ABSTAIN',
      authority_verdict: 'BLOCKED',
      iterations_executed: this.reasoningTrace.length,
      reasoning_trace: this.reasoningTrace,
      total_llm_calls: usage.llm_calls,
      total_tool_calls: usage.tool_calls,
      total_tokens: usage.total_tokens,
      latency_ms: totalLatency,
      rationale: reason,
      semantic_signals: [],
    };
  }

  /**
   * Handle budget exceeded termination.
   */
  private budgetExceeded(opp: RecoveryOpportunity, budgetCheck: BudgetCheckResult): AgentLoopResult {
    const reason = `Budget exceeded: ${budgetCheck.message}`;
    this.stateMachine.transition('ABORTED', 'BUDGET_EXCEEDED');
    const totalLatency = Date.now() - this.startTime;
    const usage = this.budgetTracker.getUsage();

    updateAgentRun({
      id: this.runId,
      status: 'aborted',
      end_time: new Date().toISOString(),
      total_steps: usage.steps,
      llm_calls: usage.llm_calls,
      tool_calls: usage.tool_calls,
      replan_count: 0,
      total_tokens: usage.total_tokens,
      latency_ms: totalLatency,
      termination_reason: reason,
    });

    const effectiveDecision: 'ACT' | 'WAIT' | 'ABSTAIN' =
      opp.decline_type === 'hard' ? 'ABSTAIN' : 'WAIT';

    return {
      run_id: this.runId,
      opportunity_id: opp.id,
      status: 'budget_exceeded',
      final_decision: effectiveDecision,
      authority_verdict: opp.decline_type === 'hard' ? 'BLOCKED' : 'WAIT',
      iterations_executed: this.reasoningTrace.length,
      reasoning_trace: this.reasoningTrace,
      total_llm_calls: usage.llm_calls,
      total_tool_calls: usage.tool_calls,
      total_tokens: usage.total_tokens,
      latency_ms: totalLatency,
      rationale: reason,
      semantic_signals: this.accumulatedSignals,
    };
  }

  /**
   * Deduplicate semantic signals, keeping the highest-confidence version for each signal name.
   */
  private deduplicateSignals(signals: SemanticSignal[]): SemanticSignal[] {
    const best = new Map<string, SemanticSignal>();
    for (const sig of signals) {
      const existing = best.get(sig.name);
      if (!existing || sig.confidence > existing.confidence) {
        best.set(sig.name, sig);
      }
    }
    return Array.from(best.values());
  }
}
