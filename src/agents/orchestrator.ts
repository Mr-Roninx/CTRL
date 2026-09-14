import crypto from 'node:crypto';
import { RecoveryOpportunity, Score, AllocationDecision, AuthorityVerdict } from '../types/index.js';
import {
  AgentMissionGoal,
  AgentRunRecord,
  SpecialistAgentName,
  PortfolioProposal,
  AgentBudgetConfig,
} from './types.js';
import { PortfolioAgent } from './portfolio_agent.js';
import {
  insertAgentRun,
  updateAgentRun,
  getOpportunityById,
  getCustomerById,
  getScoreByOpportunityId,
  upsertScore,
  upsertAllocationDecision,
  updateOpportunityStatus,
  getExecutionRecordByOpportunityId,
} from '../db/database.js';
import { AgentStateMachine } from './state_machine.js';
import { MissionBudgetTracker } from './budget.js';
import { LoopGuard } from './loop_guard.js';
import { AgentContextBuilder } from './context_builder.js';
import { LLMProvider } from './llm_provider.js';
import { AgentPlanner } from './planner.js';
import { SemanticEconomicsBridge } from './bridge.js';
import { AgentLearningEngine } from './learning.js';
import { AgentTelemetry } from './telemetry.js';
import { AgentMemoryStore } from './memory.js';
import { PerceptionAgent } from './specialists/perception_agent.js';
import { OutreachAgent } from './specialists/outreach_agent.js';
import { evaluateOpportunity, isKillSwitchActive } from '../authority/gate.js';
import { runMarketAllocation } from '../market/allocator.js';
import { executeOpportunity } from '../execution/executor.js';
import { AgentLoop, AgentLoopResult } from './agent_loop.js';

export interface MissionExecutionResult {
  run_id: string;
  opportunity_id: string;
  status: 'completed' | 'aborted' | 'human_review';
  final_decision: 'ACT' | 'WAIT' | 'ABSTAIN';
  authority_verdict: AuthorityVerdict;
  execution_link_id?: string;
  execution_link_url?: string;
  steps_executed: number;
  replans: number;
  total_tokens: number;
  latency_ms: number;
  rationale: string;
}

export interface PortfolioSweepResult {
  proposal: PortfolioProposal;
  market_run: import('../market/allocator.js').MarketRunResult;
  latency_ms: number;
}

export class AgentOrchestrator {
  /**
   * Executes a complete end-to-end autonomous agent mission for a failed payment recovery opportunity.
   */
  public static async executeRecoveryMission(params: {
    opportunityId: string;
    goal?: Partial<AgentMissionGoal>;
    environment?: 'SYNTHETIC' | 'FIXTURE' | 'RAZORPAY_TEST' | 'PROVIDER_VERIFIED';
    enableReplanTestTrigger?: boolean;
  }): Promise<MissionExecutionResult> {
    const startTime = Date.now();
    const runId = `run_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const missionId = `miss_${Date.now()}_${params.opportunityId.slice(0, 8)}`;

    const opp = getOpportunityById(params.opportunityId);
    if (!opp) {
      throw new Error(`Opportunity '${params.opportunityId}' not found in database.`);
    }

    const stateMachine = new AgentStateMachine(runId, 'IDLE');
    const budgetTracker = new MissionBudgetTracker();
    const loopGuard = new LoopGuard();

    // 1. Mission Creation & Trigger
    const runRecord: AgentRunRecord = {
      id: runId,
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

    stateMachine.transition('TRIGGERED', 'OPPORTUNITY_INGESTED', { opp_id: opp.id });
    budgetTracker.recordStep();

    // Check Kill Switch at Orchestrator root
    if (isKillSwitchActive()) {
      stateMachine.transition('ABORTED', 'KILL_SWITCH_ACTIVE');
      updateAgentRun({
        id: runId,
        status: 'aborted',
        end_time: new Date().toISOString(),
        termination_reason: 'Kill switch active',
        latency_ms: Date.now() - startTime,
      });
      return {
        run_id: runId,
        opportunity_id: opp.id,
        status: 'aborted',
        final_decision: 'ABSTAIN',
        authority_verdict: 'BLOCKED',
        steps_executed: 1,
        replans: 0,
        total_tokens: 0,
        latency_ms: Date.now() - startTime,
        rationale: 'Global kill switch is actively engaged. Agent mission halted immediately.',
      };
    }

    // 2. OBSERVE & INVESTIGATE: Perception Agent Enriches Context
    stateMachine.transition('OBSERVE', 'FETCH_INITIAL_CONTEXT');
    budgetTracker.recordStep();

    const customer = getCustomerById(opp.customer_id);
    const existingScore = getScoreByOpportunityId(opp.id);
    const memories = AgentMemoryStore.queryEpisodicMemories({
      failureType: opp.reason_code,
      cutoffTimestamp: opp.created_at,
    });

    stateMachine.transition('INVESTIGATE', 'SPECIALIST_PERCEPTION_INVESTIGATION');
    budgetTracker.recordStep();

    const annotation = await PerceptionAgent.analyzeOpportunity({
      runId,
      opportunity: opp,
    });

    // 3. DIAGNOSE & HYPOTHESIZE: Structured Reasoning via LLMProvider
    stateMachine.transition('DIAGNOSE', 'SEMANTIC_SIGNAL_SYNTHESIS');
    budgetTracker.recordStep();

    const sanitizedContext = AgentContextBuilder.buildContext({
      goal: `Recover payment opportunity ${opp.id} under portfolio capacity bounds`,
      opportunity: opp,
      customer,
      score: existingScore,
      gatewayHealth: 0.98,
      memories,
      currentTime: new Date().toISOString(),
    });

    const llmResult = await LLMProvider.generateAgentIntent({
      runId,
      opportunityId: opp.id,
      context: sanitizedContext,
    });
    budgetTracker.recordLLMCall(llmResult.tokens_used);

    stateMachine.transition('HYPOTHESIZE', 'HYPOTHESIS_FORMULATED', {
      root_cause: llmResult.intent.diagnosis.root_cause,
      confidence: llmResult.intent.diagnosis.confidence,
    });
    budgetTracker.recordStep();

    // 4. PLAN & VALIDATE: Generate Bounded Plan
    stateMachine.transition('PLAN', 'PLAN_GENERATION');
    budgetTracker.recordStep();

    const planResult = AgentPlanner.createPlan({
      runId,
      goal: { type: 'RECOVER_PAYMENT', desired_outcome: `Recover ${opp.id}` },
      opportunity: opp,
      intent: llmResult.intent,
      score: existingScore,
      gatewayHealth: 0.98,
      capacityAvailable: 5,
    });

    stateMachine.transition('VALIDATE_PLAN', 'ASSUMPTIONS_CHECKED', {
      is_valid: planResult.is_valid,
    });
    budgetTracker.recordStep();

    // 5. PROPOSE & ECONOMIC BRIDGE: Calibrated Deterministic Economics
    stateMachine.transition('PROPOSE', 'SUBMIT_ECONOMIC_MODIFIERS');
    budgetTracker.recordStep();

    const calibratedEconomicResult = SemanticEconomicsBridge.scoreWithSemanticBridge(
      opp,
      llmResult.intent.semantic_signals
    );
    upsertScore(calibratedEconomicResult.score);

    // 6. RECOVERY MARKET & ACTION AUTHORITY
    stateMachine.transition('WAIT_AUTHORITY', 'MARKET_AND_AUTHORITY_EVALUATION');
    budgetTracker.recordStep();

    // Deterministic Market Run
    const marketRun = runMarketAllocation({ capacity: 5 });
    const marketItem = marketRun.items.find((d) => d.opportunity_id === opp.id);
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
          decision: 'WAIT',
          rank_in_batch: 999,
          shadow_price_paise_at_decision: 0,
          reason: 'Outside portfolio capacity limit',
        };
    upsertAllocationDecision(allocation);

    // Deterministic Action Authority Gate Check
    const authResult = evaluateOpportunity(opp, allocation, calibratedEconomicResult.score);

    // 7. EXECUTION (If AUTHORIZED)
    let executionPlinkId: string | undefined;
    let executionPlinkUrl: string | undefined;

    if (authResult.verdict === 'AUTHORIZED' && allocation.decision === 'ACT') {
      stateMachine.transition('EXECUTE', 'DISPATCH_TO_EXECUTOR');
      budgetTracker.recordStep();

      const execResult = await executeOpportunity(opp.id);
      if (execResult.success && execResult.record) {
        executionPlinkId = execResult.record.razorpay_payment_link_id;
        executionPlinkUrl = execResult.record.link_url;

        // Create outreach draft
        await OutreachAgent.draftCustomerCommunication({
          runId,
          opportunity: opp,
          channel: 'SMS',
          paymentLinkUrl: executionPlinkUrl,
        });
      }
    } else {
      // Abstain or Blocked
      updateOpportunityStatus(opp.id, authResult.verdict === 'BLOCKED' ? 'blocked' : 'abstained');
    }

    // 8. OUTCOME EVALUATION & LEARNING
    stateMachine.transition('OBSERVE_OUTCOME', 'EVALUATE_SETTLEMENT_TRUTH');
    budgetTracker.recordStep();

    const outcomeResult = AgentLearningEngine.evaluateOutcome({
      runId,
      opportunityId: opp.id,
      actualRecovered: authResult.verdict === 'AUTHORIZED',
      actualRevenuePaise: opp.amount_paise,
      customerResponse: authResult.verdict === 'AUTHORIZED' ? 'Payment link dispatched' : 'Abstained/Blocked',
    });

    stateMachine.transition('LEARN', 'UPDATE_EPISODIC_EXPERIENCE');
    budgetTracker.recordStep();

    stateMachine.transition('MEMORY_UPDATE', 'PERSIST_EPISODIC_RECORD');
    budgetTracker.recordStep();

    stateMachine.transition('COMPLETE', 'MISSION_SUCCESSFULLY_TERMINATED');
    budgetTracker.recordStep();

    const totalLatency = Date.now() - startTime;
    const usage = budgetTracker.getUsage();

    updateAgentRun({
      id: runId,
      status: 'completed',
      end_time: new Date().toISOString(),
      total_steps: usage.steps,
      llm_calls: usage.llm_calls,
      tool_calls: usage.tool_calls,
      replan_count: usage.replans,
      total_tokens: usage.total_tokens,
      latency_ms: totalLatency,
      termination_reason: 'Mission completed normally',
    });

    return {
      run_id: runId,
      opportunity_id: opp.id,
      status: 'completed',
      final_decision: allocation.decision,
      authority_verdict: authResult.verdict,
      execution_link_id: executionPlinkId,
      execution_link_url: executionPlinkUrl,
      steps_executed: usage.steps,
      replans: usage.replans,
      total_tokens: usage.total_tokens,
      latency_ms: totalLatency,
      rationale: llmResult.intent.rationale_summary,
    };
  }

  /**
   * v5.1 — Execute a portfolio-level sweep:
   *   1. Portfolio Agent scans & ranks all pending opportunities
   *   2. Results feed into the deterministic Recovery Market allocator
   *
   * The Portfolio Agent is an intelligence layer — it proposes, it does not allocate.
   * The Recovery Market remains the sole authority on capacity allocation.
   */
  public static async executePortfolioSweep(params: {
    capacity?: number;
    gatewayHealth?: number;
  } = {}): Promise<PortfolioSweepResult> {
    const startTime = Date.now();
    const capacity = params.capacity ?? 5;
    const gatewayHealth = params.gatewayHealth ?? 0.95;

    // Kill switch check
    if (isKillSwitchActive()) {
      return {
        proposal: {
          id: `portfolio_killed_${Date.now()}`,
          timestamp: new Date().toISOString(),
          total_scanned: 0,
          priorities: [],
          capacity_available: capacity,
          top_k_recommendations: [],
          portfolio_summary: 'Portfolio sweep aborted: global kill switch active.',
        },
        market_run: {
          capacity,
          total_opportunities: 0,
          eligible_count: 0,
          abstained_count: 0,
          accepted_count: 0,
          deferred_count: 0,
          shadow_price_paise: 0,
          shadow_price_display: '₹0.00',
          items: [],
        },
        latency_ms: Date.now() - startTime,
      };
    }

    // 1. Portfolio Agent produces ranked proposals
    const proposal = PortfolioAgent.sweep({
      capacity,
      gatewayHealth,
    });

    // 2. Feed into deterministic Recovery Market (Market is authoritative)
    const marketRun = runMarketAllocation({ capacity });

    return {
      proposal,
      market_run: marketRun,
      latency_ms: Date.now() - startTime,
    };
  }

  /**
   * v5.1 — Execute a batch of recovery missions concurrently under pool limits.
   */
  public static async executeBatchMissions(params: {
    opportunityIds: string[];
    config?: Partial<import('./types.js').ConcurrencyPoolConfig>;
    environment?: 'SYNTHETIC' | 'FIXTURE' | 'RAZORPAY_TEST' | 'PROVIDER_VERIFIED';
  }): Promise<import('./types.js').BatchMissionSummary> {
    const { MissionConcurrencyCoordinator } = await import('./concurrency.js');
    return MissionConcurrencyCoordinator.executeBatch(params);
  }

  /**
   * v6.0 — Execute recovery mission using the autonomous Agent Loop (Observe-Reason-Act-Learn).
   * Replaces single-shot linear execution with an iterative goal-directed reasoning cycle.
   */
  public static async executeAutonomousMission(params: {
    opportunityId: string;
    environment?: 'SYNTHETIC' | 'FIXTURE' | 'RAZORPAY_TEST' | 'PROVIDER_VERIFIED';
    budgetConfig?: Partial<AgentBudgetConfig>;
  }): Promise<AgentLoopResult> {
    const runId = `run_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const loop = new AgentLoop(runId, params.budgetConfig);
    return loop.run({
      opportunityId: params.opportunityId,
      environment: params.environment,
    });
  }
}

