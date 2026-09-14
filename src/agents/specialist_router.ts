import { RecoveryOpportunity, Score } from '../types/index.js';
import { PerceptionAgent } from './specialists/perception_agent.js';
import { StrategyAgent } from './specialists/strategy_agent.js';
import { OutreachAgent } from './specialists/outreach_agent.js';
import { ComplianceCopilot } from './specialists/compliance_copilot.js';
import { PerceptionAnnotationRecord, OutreachDraftRecord, SemanticSignal } from './types.js';

export interface SpecialistEnsembleResult {
  opportunity_id: string;
  perception: PerceptionAnnotationRecord;
  strategy?: {
    eligible: boolean;
    statistics: any;
    recommended_channel: string;
    optimal_window: string;
  };
  outreach_draft?: OutreachDraftRecord;
  compliance: {
    dnd_active: boolean;
    contact_limit_exceeded: boolean;
    hard_decline_blocked: boolean;
    can_proceed: boolean;
    veto_reason?: string;
  };
  signals: SemanticSignal[];
  ensemble_action_recommendation: 'ACT' | 'WAIT' | 'ABSTAIN';
  execution_latency_ms: number;
}

/**
 * SpecialistRouter — Intelligent Multi-Agent Coordinator
 * Dispatches opportunities to domain specialists, executes them,
 * and deterministic aggregates their outputs with strict compliance veto supremacy.
 */
export class SpecialistRouter {
  /**
   * Route and run all relevant specialists for an opportunity.
   */
  public static async coordinateSpecialists(params: {
    runId: string;
    opportunity: RecoveryOpportunity;
    score?: Score | null;
  }): Promise<SpecialistEnsembleResult> {
    const startTime = Date.now();
    const opp = params.opportunity;

    // 1. Compliance Pre-check (Compliance is sovereign)
    const complianceVerdict = ComplianceCopilot.checkPreExecutionCompliance(opp);

    // 2. Run Perception Agent
    const perceptionPromise = PerceptionAgent.analyzeOpportunity({
      runId: params.runId,
      opportunity: opp,
    });

    // 3. Run Strategy evaluation if applicable
    const strategyPromise = StrategyAgent.evaluateOpportunityStrategy({
      runId: params.runId,
      opportunity: opp,
      score: params.score,
    });

    // Await core parallel analysis
    const [perception, strategy] = await Promise.all([
      perceptionPromise,
      strategyPromise,
    ]);

    // 4. Outreach drafting if compliant and eligible
    let outreachDraft: OutreachDraftRecord | undefined;
    const recommendedChannel = strategy.recommended_channel as 'SMS' | 'WHATSAPP' | 'EMAIL';

    if (complianceVerdict.can_proceed && opp.decline_type !== 'hard') {
      try {
        outreachDraft = await OutreachAgent.draftCustomerCommunication({
          runId: params.runId,
          opportunity: opp,
          channel: recommendedChannel,
        });
      } catch (err) {
        console.warn('SpecialistRouter: Outreach draft generation failed:', err);
      }
    }

    // 5. Aggregate Semantic Signals
    const signals: SemanticSignal[] = [];

    if (opp.decline_type === 'hard') {
      signals.push({
        name: 'relationship_risk',
        value: 0.95,
        confidence: 0.98,
        evidence_reference: `opp:${opp.id}:hard_decline`,
        timestamp: new Date().toISOString(),
        source: 'PerceptionAgent',
      });
    }

    if (complianceVerdict.dnd_active) {
      signals.push({
        name: 'fatigue',
        value: 0.85,
        confidence: 1.0,
        evidence_reference: `opp:${opp.id}:dnd_active`,
        timestamp: new Date().toISOString(),
        source: 'ComplianceCopilot',
      });
    }

    if (perception.failure_intent.includes('network') || perception.failure_intent.includes('latency')) {
      signals.push({
        name: 'transient_failure',
        value: 0.90,
        confidence: 0.92,
        evidence_reference: `opp:${opp.id}:gateway_latency`,
        timestamp: new Date().toISOString(),
        source: 'PerceptionAgent',
      });
    }

    // 6. Deterministic Conflict Resolution:
    // Rule 1: Compliance veto ALWAYS overrides everything -> ABSTAIN or WAIT
    // Rule 2: Hard decline ALWAYS -> ABSTAIN
    // Rule 3: DND active -> WAIT
    // Rule 4: Otherwise follow economic/perception recommendation
    let finalRecommendation: 'ACT' | 'WAIT' | 'ABSTAIN' = 'ACT';

    if (opp.decline_type === 'hard' || complianceVerdict.hard_decline_blocked) {
      finalRecommendation = 'ABSTAIN';
    } else if (complianceVerdict.dnd_active || complianceVerdict.contact_limit_exceeded) {
      finalRecommendation = 'WAIT';
    } else if (params.score && params.score.expected_incremental_value_paise <= 0) {
      finalRecommendation = 'ABSTAIN';
    } else if (perception.customer_urgency_score < 0.25) {
      finalRecommendation = 'WAIT';
    }

    return {
      opportunity_id: opp.id,
      perception,
      strategy: {
        eligible: strategy.eligible,
        statistics: strategy.statistics,
        recommended_channel: recommendedChannel,
        optimal_window: strategy.optimal_window,
      },
      outreach_draft: outreachDraft,
      compliance: complianceVerdict,
      signals,
      ensemble_action_recommendation: finalRecommendation,
      execution_latency_ms: Date.now() - startTime,
    };
  }
}
