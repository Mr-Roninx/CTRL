import crypto from 'node:crypto';
import { RecoveryOpportunity, Score } from '../types/index.js';
import { SemanticSignal, AgentBudgetConfig, DEFAULT_AGENT_BUDGET } from './types.js';
import { AgentContextBuilder, SanitizedPromptContext } from './context_builder.js';
import { LLMProvider } from './llm_provider.js';
import { AgentTelemetry } from './telemetry.js';

/**
 * The structured output of a single reasoning step.
 * The agent loop reads this to determine what to do next.
 */
export interface ReasoningStepOutput {
  step_id: string;
  thought: string;
  observation_summary: string;
  tool_choice: ToolCallRequest | null;
  should_continue: boolean;
  confidence: number;
  semantic_signals: SemanticSignal[];
  proposed_action: 'ACT' | 'WAIT' | 'ABSTAIN' | 'INVESTIGATE' | 'HUMAN_REVIEW' | null;
  reasoning_chain: string[];
  created_at: string;
}

export interface ToolCallRequest {
  tool_name: string;
  params: Record<string, any>;
  rationale: string;
}

export interface ReasoningContext {
  opportunity: RecoveryOpportunity;
  score: Score | null | undefined;
  customer_trust_score: number;
  gateway_health: number;
  prior_observations: string[];
  tool_results: Array<{ tool_name: string; result_summary: string }>;
  memory_fragments: string[];
  iteration: number;
  max_iterations: number;
}

/**
 * ReasoningEngine — Structured Chain-of-Thought framework for the Agent Loop.
 *
 * INVARIANT: The reasoning engine NEVER executes financial actions. It only:
 * 1. Analyzes context
 * 2. Selects tools to investigate further
 * 3. Proposes an action (which the deterministic economics engine will validate)
 *
 * The engine uses LLM when available, but falls back to deterministic rule-based
 * reasoning when LLM is unavailable — ensuring the agent is always functional.
 */
export class ReasoningEngine {
  private static readonly MAX_REASONING_STEPS = 3;

  /**
   * Execute a single reasoning step.
   * Returns structured output the Agent Loop uses to decide next action.
   */
  public static async reason(params: {
    runId: string;
    context: ReasoningContext;
  }): Promise<ReasoningStepOutput> {
    const { runId, context } = params;
    const stepId = `reason_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // If we've exhausted reasoning iterations, force a decision
    if (context.iteration >= this.MAX_REASONING_STEPS) {
      return this.forceDecision(stepId, runId, context);
    }

    // Build sanitized prompt context
    const sanitizedCtx = AgentContextBuilder.buildContext({
      goal: `Autonomously investigate and decide recovery action for opportunity ${context.opportunity.id}`,
      opportunity: context.opportunity,
      score: context.score || undefined,
      gatewayHealth: context.gateway_health,
      currentTime: new Date().toISOString(),
    });

    // Try LLM-augmented reasoning first, fall back to deterministic
    try {
      const llmResult = await LLMProvider.generateAgentIntent({
        runId,
        opportunityId: context.opportunity.id,
        context: {
          ...sanitizedCtx,
          // Enrich with agent loop context
          mission_goal: this.buildIterativePrompt(context),
        },
      });

      const intent = llmResult.intent;

      // Extract tool choice from LLM's requested_tools
      let toolChoice: ToolCallRequest | null = null;
      if (intent.requested_tools.length > 0 && context.iteration < this.MAX_REASONING_STEPS - 1) {
        const firstTool = intent.requested_tools[0];
        if (firstTool) {
          toolChoice = {
            tool_name: firstTool.tool_name,
            params: firstTool.params,
            rationale: `LLM reasoning step ${context.iteration + 1}: investigating ${firstTool.tool_name}`,
          };
        }
      }

      // Determine if agent should continue investigating or decide
      const shouldContinue = toolChoice !== null && context.iteration < this.MAX_REASONING_STEPS - 1;
      const proposedAction = this.mapPreferredAction(intent.proposed_plan.preferred_action);

      const output: ReasoningStepOutput = {
        step_id: stepId,
        thought: intent.rationale_summary,
        observation_summary: intent.observations.join('; '),
        tool_choice: toolChoice,
        should_continue: shouldContinue,
        confidence: intent.diagnosis.confidence,
        semantic_signals: intent.semantic_signals,
        proposed_action: shouldContinue ? null : proposedAction,
        reasoning_chain: [
          `Step ${context.iteration + 1}: ${intent.diagnosis.root_cause}`,
          `Severity: ${intent.diagnosis.severity}, Recoverability: ${intent.diagnosis.recoverability_assessment}`,
          ...intent.hypotheses.map((h, i) => `Hypothesis ${i + 1}: ${h}`),
        ],
        created_at: new Date().toISOString(),
      };

      // Log reasoning step to telemetry
      AgentTelemetry.logStep({
        runId,
        stepNumber: 200 + context.iteration,
        state: 'DIAGNOSE',
        observation: output.observation_summary,
        thought: output.thought,
        actionType: shouldContinue ? 'CONTINUE_INVESTIGATION' : 'PROPOSE_ACTION',
        actionPayload: {
          tool_choice: toolChoice?.tool_name || null,
          proposed_action: output.proposed_action,
          confidence: output.confidence,
        },
      });

      return output;
    } catch (err: any) {
      console.error('ReasoningEngine: LLM reasoning failed, using deterministic fallback:', err?.message);
      return this.deterministicReason(stepId, runId, context);
    }
  }

  /**
   * Deterministic reasoning fallback — always available, no LLM required.
   * Uses the same rule tables as the existing IVEN scorer.
   */
  private static deterministicReason(
    stepId: string,
    runId: string,
    context: ReasoningContext
  ): ReasoningStepOutput {
    const opp = context.opportunity;
    const isHard = opp.decline_type === 'hard';
    const isRetryCap = opp.attempt_count >= 3;
    const reason = (opp.reason_code || '').toLowerCase();

    let thought: string;
    let proposedAction: ReasoningStepOutput['proposed_action'];
    let confidence: number;
    let signals: SemanticSignal[] = [];

    if (isHard) {
      thought = 'Hard decline detected (stolen/lost card). Zero incremental value. ABSTAIN immediately.';
      proposedAction = 'ABSTAIN';
      confidence = 0.95;
    } else if (isRetryCap) {
      thought = `Retry cap reached (${opp.attempt_count}/3). Customer fatigue is high. ABSTAIN to preserve goodwill.`;
      proposedAction = 'ABSTAIN';
      confidence = 0.90;
    } else if (reason.includes('insufficient_funds')) {
      thought = 'Insufficient funds — customer may have balance soon. ACT with payment link.';
      proposedAction = 'ACT';
      confidence = 0.80;
      signals.push({
        name: 'customer_liquidity',
        value: 0.70,
        confidence: 0.75,
        evidence_reference: `Reason: ${reason}`,
        timestamp: new Date().toISOString(),
        source: 'deterministic_reasoning_engine',
      });
    } else if (reason.includes('timeout') || reason.includes('gateway')) {
      thought = 'Gateway timeout — transient failure likely to self-resolve. WAIT for natural recovery.';
      proposedAction = 'WAIT';
      confidence = 0.85;
      signals.push({
        name: 'transient_failure',
        value: 0.85,
        confidence: 0.90,
        evidence_reference: `Reason: ${reason}`,
        timestamp: new Date().toISOString(),
        source: 'deterministic_reasoning_engine',
      });
    } else {
      thought = `Soft decline (${reason}). Moderate recoverability. ACT if within capacity.`;
      proposedAction = 'ACT';
      confidence = 0.70;
    }

    // Check if we should investigate further (first iteration only, for non-obvious cases)
    let toolChoice: ToolCallRequest | null = null;
    let shouldContinue = false;

    if (context.iteration === 0 && !isHard && !isRetryCap && confidence < 0.85) {
      toolChoice = {
        tool_name: 'get_customer_history',
        params: { customer_id: opp.customer_id },
        rationale: 'Gathering customer payment history to refine recovery probability estimate',
      };
      shouldContinue = true;
    }

    return {
      step_id: stepId,
      thought,
      observation_summary: `Opportunity ${opp.id}: ${opp.decline_type} decline, reason=${opp.reason_code}, attempt=${opp.attempt_count}`,
      tool_choice: toolChoice,
      should_continue: shouldContinue,
      confidence,
      semantic_signals: signals,
      proposed_action: shouldContinue ? null : proposedAction,
      reasoning_chain: [
        `Step ${context.iteration + 1}: Deterministic analysis of ${opp.id}`,
        `Decline: ${opp.decline_type}, Reason: ${opp.reason_code}, Attempts: ${opp.attempt_count}`,
        `Decision: ${proposedAction || 'INVESTIGATING'} (confidence: ${confidence})`,
      ],
      created_at: new Date().toISOString(),
    };
  }

  /**
   * When max reasoning steps are reached, force a decision based on accumulated context.
   */
  private static forceDecision(
    stepId: string,
    runId: string,
    context: ReasoningContext
  ): ReasoningStepOutput {
    const opp = context.opportunity;
    const isHard = opp.decline_type === 'hard';

    // Use accumulated observations to make final decision
    let proposedAction: ReasoningStepOutput['proposed_action'] = 'WAIT';
    let confidence = 0.60;

    if (isHard) {
      proposedAction = 'ABSTAIN';
      confidence = 0.95;
    } else if (context.score && context.score.expected_incremental_value_paise > 0) {
      proposedAction = 'ACT';
      confidence = Math.min(0.90, 0.60 + (context.tool_results.length * 0.10));
    } else if (context.score && context.score.expected_incremental_value_paise <= 0) {
      proposedAction = 'ABSTAIN';
      confidence = 0.85;
    }

    return {
      step_id: stepId,
      thought: `Reasoning budget exhausted after ${context.iteration} steps. Forcing decision: ${proposedAction} (accumulated confidence: ${confidence.toFixed(2)}).`,
      observation_summary: context.prior_observations.join('; ') || 'No additional observations.',
      tool_choice: null,
      should_continue: false,
      confidence,
      semantic_signals: [],
      proposed_action: proposedAction,
      reasoning_chain: [
        `FORCED DECISION at step ${context.iteration + 1} (max reached)`,
        `Prior observations: ${context.prior_observations.length}`,
        `Tool results: ${context.tool_results.length}`,
        `Final action: ${proposedAction}`,
      ],
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Build an iterative prompt that includes prior observations and tool results.
   */
  private static buildIterativePrompt(context: ReasoningContext): string {
    const parts: string[] = [
      `Iteration ${context.iteration + 1}/${context.max_iterations} of autonomous investigation.`,
      `Opportunity: ${context.opportunity.id} (${context.opportunity.decline_type} decline, ${context.opportunity.reason_code}).`,
    ];

    if (context.prior_observations.length > 0) {
      parts.push(`\nPrior observations:\n${context.prior_observations.map((o, i) => `  ${i + 1}. ${o}`).join('\n')}`);
    }

    if (context.tool_results.length > 0) {
      parts.push(`\nTool investigation results:\n${context.tool_results.map((t, i) => `  ${i + 1}. [${t.tool_name}]: ${t.result_summary}`).join('\n')}`);
    }

    if (context.memory_fragments.length > 0) {
      parts.push(`\nRelevant episodic memories:\n${context.memory_fragments.map((m, i) => `  ${i + 1}. ${m}`).join('\n')}`);
    }

    parts.push(`\nDetermine: Should you investigate further (select a tool) or propose a final action (ACT/WAIT/ABSTAIN)?`);

    return parts.join('\n');
  }

  /**
   * Maps LLM preferred action strings to our typed action enum.
   */
  private static mapPreferredAction(
    action: string
  ): ReasoningStepOutput['proposed_action'] {
    const upper = (action || '').toUpperCase();
    if (upper === 'ABSTAIN' || upper === 'MANUAL_REVIEW') return 'ABSTAIN';
    if (upper === 'WAIT' || upper === 'DEFER_RETRY') return 'WAIT';
    if (upper === 'ACT' || upper === 'SEND_PAYMENT_LINK') return 'ACT';
    if (upper === 'INVESTIGATE') return 'INVESTIGATE';
    if (upper === 'HUMAN_REVIEW') return 'HUMAN_REVIEW';
    return 'WAIT'; // Safe default
  }
}
