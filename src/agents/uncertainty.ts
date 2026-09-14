import { RecoveryOpportunity, Score } from '../types/index.js';
import { UncertaintyAssessment } from './types.js';
import { getScoreByOpportunityId } from '../db/database.js';
import { PerceptionAgent } from './specialists/perception_agent.js';

/**
 * CTRL v5.1 — Structured Uncertainty Model
 *
 * Separates uncertainty into three independent dimensions:
 *   MODEL_CONFIDENCE   — historical calibration quality for this failure type
 *   DATA_CONFIDENCE    — data completeness (score, perception, customer history)
 *   ECONOMIC_CONFIDENCE — IVEN magnitude relative to operational cost
 *
 * Combined composite confidence drives routing:
 *   High (>0.7)   → PROCEED (normal pipeline)
 *   Medium (0.4–0.7) → INVESTIGATE (gather more information)
 *   Low (<0.4)    → HUMAN_REVIEW or ABSTAIN
 *
 * The LLM self-confidence is NOT authoritative. Only deterministic
 * evidence-based signals feed this model.
 */
export class UncertaintyModel {

  // -------------------------------------------------------------------------
  // Deterministic confidence weights (not LLM-derived)
  // -------------------------------------------------------------------------
  private static readonly W_MODEL = 0.35;
  private static readonly W_DATA = 0.35;
  private static readonly W_ECONOMIC = 0.30;

  // -------------------------------------------------------------------------
  // Thresholds
  // -------------------------------------------------------------------------
  private static readonly HIGH_THRESHOLD = 0.70;
  private static readonly LOW_THRESHOLD = 0.40;

  /**
   * Assess uncertainty for a single recovery opportunity.
   */
  public static assess(params: {
    opportunity: RecoveryOpportunity;
    score: Score | null;
    hasPerception: boolean;
    hasCustomerHistory: boolean;
    hasGatewayState: boolean;
    historicalSampleSize: number;
    historicalCalibrationError: number;
  }): UncertaintyAssessment {
    const missingSignals: string[] = [];

    // -----------------------------------------------------------------------
    // Dimension 1: MODEL_CONFIDENCE
    // Based on historical calibration error for this failure category.
    // More samples + lower error → higher confidence.
    // -----------------------------------------------------------------------
    let modelConf = 0.50; // baseline
    if (params.historicalSampleSize >= 30) {
      modelConf = 1.0 - Math.min(params.historicalCalibrationError, 1.0);
    } else if (params.historicalSampleSize >= 10) {
      modelConf = 0.60 - (params.historicalCalibrationError * 0.3);
    } else {
      modelConf = 0.35;
      missingSignals.push('insufficient_historical_samples');
    }
    modelConf = clamp(modelConf, 0, 1);

    // -----------------------------------------------------------------------
    // Dimension 2: DATA_CONFIDENCE
    // Based on how much data is available about this opportunity.
    // -----------------------------------------------------------------------
    let dataConf = 0.20; // start low
    if (params.score) dataConf += 0.25;
    else missingSignals.push('missing_economic_score');

    if (params.hasPerception) dataConf += 0.25;
    else missingSignals.push('missing_perception_annotation');

    if (params.hasCustomerHistory) dataConf += 0.15;
    else missingSignals.push('missing_customer_history');

    if (params.hasGatewayState) dataConf += 0.15;
    else missingSignals.push('missing_gateway_state');

    dataConf = clamp(dataConf, 0, 1);

    // -----------------------------------------------------------------------
    // Dimension 3: ECONOMIC_CONFIDENCE
    // Based on IVEN magnitude relative to operational cost.
    // Large positive IVEN → high confidence the action is worthwhile.
    // -----------------------------------------------------------------------
    let econConf = 0.30;
    if (params.score) {
      const iven = params.score.expected_incremental_value_paise;
      const opCost = params.score.operational_cost_paise + params.score.fatigue_cost_paise;
      if (iven > opCost * 5) econConf = 0.95;
      else if (iven > opCost * 2) econConf = 0.75;
      else if (iven > opCost) econConf = 0.55;
      else if (iven > 0) econConf = 0.35;
      else econConf = 0.10;
    } else {
      missingSignals.push('no_iven_available');
    }
    econConf = clamp(econConf, 0, 1);

    // -----------------------------------------------------------------------
    // Composite
    // -----------------------------------------------------------------------
    const composite = this.W_MODEL * modelConf
                    + this.W_DATA * dataConf
                    + this.W_ECONOMIC * econConf;

    let recommendation: UncertaintyAssessment['recommendation'];
    let rationale: string;

    if (composite >= this.HIGH_THRESHOLD) {
      recommendation = 'PROCEED';
      rationale = `Composite confidence ${composite.toFixed(3)} ≥ ${this.HIGH_THRESHOLD}: sufficient evidence to proceed through normal pipeline.`;
    } else if (composite >= this.LOW_THRESHOLD) {
      recommendation = 'INVESTIGATE';
      rationale = `Composite confidence ${composite.toFixed(3)} in [${this.LOW_THRESHOLD}, ${this.HIGH_THRESHOLD}): additional investigation recommended before commitment. Missing: ${missingSignals.join(', ') || 'none'}.`;
    } else {
      recommendation = missingSignals.length >= 3 ? 'ABSTAIN' : 'HUMAN_REVIEW';
      rationale = `Composite confidence ${composite.toFixed(3)} < ${this.LOW_THRESHOLD}: insufficient evidence. Missing: ${missingSignals.join(', ')}. Recommendation: ${recommendation}.`;
    }

    return {
      opportunity_id: params.opportunity.id,
      model_confidence: Number(modelConf.toFixed(4)),
      data_confidence: Number(dataConf.toFixed(4)),
      economic_confidence: Number(econConf.toFixed(4)),
      composite_confidence: Number(composite.toFixed(4)),
      recommendation,
      missing_signals: missingSignals,
      rationale,
    };
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
