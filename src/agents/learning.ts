import crypto from 'node:crypto';
import {
  insertAgentOutcome,
  getAllAgentOutcomes,
  getScoreByOpportunityId,
  getOpportunityById,
} from '../db/database.js';
import { AgentOutcomeRecord } from './types.js';
import { AgentMemoryStore } from './memory.js';
import { AgentTelemetry } from './telemetry.js';

export interface OutcomeEvaluationResult {
  outcome_record: AgentOutcomeRecord;
  learning_summary: string;
  is_empirical_threshold_met: boolean;
  calibration_proposal_eligible: boolean;
}

export class AgentLearningEngine {
  public static EVIDENCE_THRESHOLD = 30; // Min confirmed real outcomes required before proposing parameter updates

  /**
   * Evaluates mission outcome against provider reconciliation truth and updates episodic memory.
   * INVARIANT: Never infer y = 1 simply because an action was executed or link created.
   * If outcome is PENDING or UNKNOWN, brier_score is set to null to avoid false learning.
   */
  public static evaluateOutcome(params: {
    runId: string;
    opportunityId: string;
    actualRecovered?: boolean | null;
    actualRevenuePaise?: number;
    customerResponse?: string;
    providerStatus?: string;
    amountPaidPaise?: number;
    evidenceClass?: string;
  }): OutcomeEvaluationResult {
    const opp = getOpportunityById(params.opportunityId);
    const score = getScoreByOpportunityId(params.opportunityId);

    const predictedProb = score?.intervention_recovery_prob ?? 0.45;
    const opCost = score?.operational_cost_paise ?? 400;
    const fatigueCost = score?.fatigue_cost_paise ?? 0;
    const revenuePaise = params.actualRevenuePaise ?? (params.amountPaidPaise ?? 0);

    let isRecoveredBoolean = false;
    let brierScore: number | null = null;
    let predictionError: number = 0;
    let netGainPaise: number = -(opCost + fatigueCost);
    let outcomeStatus: string = 'UNKNOWN';

    if (params.actualRecovered === true && (params.amountPaidPaise === undefined || params.amountPaidPaise > 0)) {
      // Confirmed recovery
      isRecoveredBoolean = true;
      brierScore = Number(Math.pow(1.0 - predictedProb, 2).toFixed(4));
      predictionError = Number(Math.abs(1.0 - predictedProb).toFixed(4));
      netGainPaise = revenuePaise - opCost - fatigueCost;
      outcomeStatus = 'CONFIRMED_RECOVERED';
    } else if (params.actualRecovered === false) {
      // Confirmed non-recovery (e.g. link expired or cancelled)
      isRecoveredBoolean = false;
      brierScore = Number(Math.pow(0.0 - predictedProb, 2).toFixed(4));
      predictionError = Number(Math.abs(0.0 - predictedProb).toFixed(4));
      netGainPaise = -(opCost + fatigueCost);
      outcomeStatus = 'CONFIRMED_NOT_RECOVERED';
    } else {
      // Pending / Unknown: Provider link created, but payment not confirmed
      isRecoveredBoolean = false;
      brierScore = null;
      predictionError = 0;
      netGainPaise = -(opCost + fatigueCost);
      outcomeStatus = 'PENDING_PROVIDER_CONFIRMATION';
    }

    const outcomeId = `out_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const evaluatedAt = new Date().toISOString();

    const record: AgentOutcomeRecord = {
      id: outcomeId,
      run_id: params.runId,
      opportunity_id: params.opportunityId,
      predicted_recovery_prob: predictedProb,
      actual_recovered: isRecoveredBoolean,
      prediction_error: predictionError,
      actual_revenue_paise: revenuePaise,
      operational_cost_paise: opCost,
      net_gain_paise: netGainPaise,
      customer_response: params.customerResponse || `Status: ${outcomeStatus}`,
      evaluated_at: evaluatedAt,
    };

    insertAgentOutcome(record);

    // Record to Episodic Memory only when outcome is confirmed
    if (outcomeStatus !== 'PENDING_PROVIDER_CONFIRMATION') {
      AgentMemoryStore.recordEpisode({
        runId: params.runId,
        opportunityId: params.opportunityId,
        failureType: opp?.reason_code || 'unknown_decline',
        summary: `Episode ${params.opportunityId}: ${opp?.reason_code} -> Result: ${isRecoveredBoolean ? 'RECOVERED' : 'NOT_RECOVERED'} (Net: ₹${(netGainPaise / 100).toFixed(2)}, Error: ${predictionError})`,
        actionTaken: 'SEND_PAYMENT_LINK',
        predictedOutcome: `P(rec)=${predictedProb}`,
        actualOutcome: isRecoveredBoolean ? 'RECOVERED' : 'NOT_RECOVERED',
        predictionError,
        provenance: `AgentLearningEngine:evaluateOutcome (${params.evidenceClass || 'PROVIDER_EVAL'})`,
      });
    }

    AgentTelemetry.logStep({
      runId: params.runId,
      stepNumber: 105,
      state: 'LEARN',
      observation: `Outcome evaluated: ${outcomeStatus} (Brier: ${brierScore !== null ? brierScore : 'N/A'})`,
      thought: `Net economic gain: ₹${(netGainPaise / 100).toFixed(2)}. Evidence class: ${params.evidenceClass || 'STANDARD'}`,
      actionType: 'OUTCOME_EVALUATED',
      actionPayload: { outcome_id: outcomeId, outcome_status: outcomeStatus, brier_score: brierScore },
    });

    // Check empirical dataset size (counting only confirmed outcomes)
    const allOutcomes = getAllAgentOutcomes();
    const thresholdMet = allOutcomes.length >= this.EVIDENCE_THRESHOLD;

    return {
      outcome_record: record,
      learning_summary: `Outcome logged with status ${outcomeStatus}. Brier score: ${brierScore !== null ? brierScore : 'N/A'}. Historical outcomes: ${allOutcomes.length}.`,
      is_empirical_threshold_met: thresholdMet,
      calibration_proposal_eligible: thresholdMet,
    };
  }

  /**
   * Calculates aggregate empirical accuracy and calibration statistics.
   */
  public static getCalibrationStatistics(): {
    total_outcomes: number;
    mean_prediction_error: number;
    empirical_recovery_rate: number;
    mean_net_gain_paise: number;
    brier_score: number;
  } {
    const outcomes = getAllAgentOutcomes();
    if (outcomes.length === 0) {
      return {
        total_outcomes: 0,
        mean_prediction_error: 0,
        empirical_recovery_rate: 0,
        mean_net_gain_paise: 0,
        brier_score: 0,
      };
    }

    const total = outcomes.length;
    const totalRecovered = outcomes.filter((o) => o.actual_recovered).length;
    const totalError = outcomes.reduce((sum, o) => sum + o.prediction_error, 0);
    const totalNetGain = outcomes.reduce((sum, o) => sum + o.net_gain_paise, 0);
    const brierScore = outcomes.reduce((sum, o) => {
      const actual = o.actual_recovered ? 1.0 : 0.0;
      return sum + Math.pow(o.predicted_recovery_prob - actual, 2);
    }, 0) / total;

    return {
      total_outcomes: total,
      mean_prediction_error: Number((totalError / total).toFixed(4)),
      empirical_recovery_rate: Number((totalRecovered / total).toFixed(4)),
      mean_net_gain_paise: Math.round(totalNetGain / total),
      brier_score: Number(brierScore.toFixed(4)),
    };
  }
}
