import { AgentLearningEngine } from '../learning.js';
import { AgentToolRegistry } from '../tool_registry.js';
import { AgentProposalRecord } from '../types.js';
import { RecoveryOpportunity, Score } from '../../types/index.js';

export interface OpportunityStrategyEvaluation {
  eligible: boolean;
  statistics: any;
  recommended_channel: 'WHATSAPP' | 'SMS' | 'EMAIL';
  optimal_window: string;
  expected_uplift: number;
  shadow_price_check: {
    shadow_price_paise: number;
    iven_paise: number;
    cleared: boolean;
  };
}

export class StrategyAgent {
  /**
   * Evaluate optimal multi-action recovery strategy for a specific opportunity.
   */
  public static async evaluateOpportunityStrategy(params: {
    runId: string;
    opportunity: RecoveryOpportunity;
    score?: Score | null;
  }): Promise<OpportunityStrategyEvaluation> {
    const opp = params.opportunity;
    const stats = AgentLearningEngine.getCalibrationStatistics();

    // 1. Channel optimization based on ticket size and customer trust
    let channel: 'WHATSAPP' | 'SMS' | 'EMAIL' = 'WHATSAPP';
    const amount = opp.amount_paise;
    const trust = opp.customer_trust_score ?? 0.65;

    if (amount > 1000000) {
      // High ticket (>₹10,000): WhatsApp + Email
      channel = trust >= 0.5 ? 'WHATSAPP' : 'EMAIL';
    } else if (amount < 100000) {
      // Micro-ticket (<₹1,000): Lightweight SMS
      channel = 'SMS';
    } else {
      channel = 'WHATSAPP';
    }

    // 2. Optimal timing window
    let window = 't+15m';
    if (opp.reason_code?.toUpperCase().includes('FUNDS')) {
      window = 't+24h';
    } else if (opp.attempt_count > 1) {
      window = 't+4h';
    }

    // 3. Shadow price check
    const currentShadowPrice = 25000; // ₹250 baseline shadow price
    const iven = params.score?.expected_incremental_value_paise ?? 0;
    const cleared = iven >= currentShadowPrice;

    return {
      eligible: opp.decline_type !== 'hard' && iven > 0,
      statistics: stats,
      recommended_channel: channel,
      optimal_window: window,
      expected_uplift: params.score?.incremental_prob ?? 0.25,
      shadow_price_check: {
        shadow_price_paise: currentShadowPrice,
        iven_paise: iven,
        cleared,
      },
    };
  }

  /**
   * Evaluate whether learning engine outcomes justify a portfolio-level calibration proposal.
   */
  public static async evaluateStrategyCalibration(params: {
    runId: string;
    opportunityId?: string;
  }): Promise<{
    eligible: boolean;
    statistics: any;
    proposal?: AgentProposalRecord;
    message: string;
  }> {
    const stats = AgentLearningEngine.getCalibrationStatistics();
    const oppId = params.opportunityId || 'global_calibration';

    if (stats.total_outcomes < AgentLearningEngine.EVIDENCE_THRESHOLD) {
      return {
        eligible: false,
        statistics: stats,
        message: `Insufficient empirical evidence (${stats.total_outcomes}/${AgentLearningEngine.EVIDENCE_THRESHOLD} outcomes). Policy updates blocked.`,
      };
    }

    // If empirical recovery rate deviates from predicted baseline, propose calibration
    const proposedDelta = Number((stats.empirical_recovery_rate - 0.45).toFixed(4));

    const toolRes = await AgentToolRegistry.executeTool({
      toolId: 'create_strategy_proposal',
      runId: params.runId,
      agentName: 'StrategyAgent',
      inputPayload: {
        run_id: params.runId,
        opportunity_id: oppId,
        proposed_intervention_prob_delta: proposedDelta,
        empirical_sample_size: stats.total_outcomes,
        justification: `Empirical recovery rate (${stats.empirical_recovery_rate}) over ${stats.total_outcomes} outcomes indicates model calibration shift.`,
      },
    });

    return {
      eligible: true,
      statistics: stats,
      proposal: toolRes.data,
      message: `Strategy proposal created for operator review based on ${stats.total_outcomes} validated outcomes.`,
    };
  }
}
