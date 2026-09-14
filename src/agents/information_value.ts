import { RecoveryOpportunity, Score } from '../types/index.js';
import { InformationValueResult, ProposedAction } from './types.js';

/**
 * CTRL v5.1 — Information Value Estimator
 *
 * Helps the agent decide between ACT, WAIT, and INVESTIGATE by computing
 * the deterministic expected value of gathering additional information
 * before committing scarce recovery capacity.
 *
 * All thresholds and bounds are fixed configuration constants,
 * not LLM-derived.
 *
 * The model MUST NOT assign unrestricted monetary value to information.
 * All values are deterministically bounded.
 */
export class InformationValueEstimator {

  // Maximum information value as fraction of IVEN (prevents runaway valuation)
  private static readonly MAX_INFO_VALUE_FRACTION = 0.20;

  // Investigation cost: fixed operational overhead per investigation round (paise)
  private static readonly INVESTIGATION_COST_PAISE = 200;

  // Gateway instability threshold
  private static readonly GATEWAY_UNSTABLE_THRESHOLD = 0.75;

  // IVEN threshold below which WAIT is preferred over ACT
  private static readonly IVEN_BORDERLINE_THRESHOLD_PAISE = 5000;

  /**
   * Estimate the value of gathering additional information for this opportunity.
   */
  public static estimate(params: {
    opportunity: RecoveryOpportunity;
    score: Score | null;
    gatewayHealth: number;
    compositeConfidence: number;
    hasPerception: boolean;
  }): InformationValueResult {
    const iven = params.score?.expected_incremental_value_paise ?? 0;
    const gw = params.gatewayHealth;
    const conf = params.compositeConfidence;

    // -----------------------------------------------------------------------
    // Expected Value of Information (EVOI)
    //
    // EVOI = potential_iven_improvement × uncertainty_reduction_potential
    //      = IVEN × (1 - composite_confidence) × MAX_INFO_VALUE_FRACTION
    //
    // Bounded: EVOI ≤ IVEN × MAX_INFO_VALUE_FRACTION
    // -----------------------------------------------------------------------
    const uncertaintyGap = Math.max(0, 1.0 - conf);
    const evoi = Math.round(iven * uncertaintyGap * this.MAX_INFO_VALUE_FRACTION);

    const investigationCost = this.INVESTIGATION_COST_PAISE;

    // -----------------------------------------------------------------------
    // Decision Logic (deterministic, no LLM)
    // -----------------------------------------------------------------------
    let action: ProposedAction;
    let rationale: string;

    // Case 1: Gateway unstable AND investigation would yield value
    if (gw < this.GATEWAY_UNSTABLE_THRESHOLD && evoi > investigationCost) {
      action = 'INVESTIGATE';
      rationale = `Gateway degraded (${gw.toFixed(2)} < ${this.GATEWAY_UNSTABLE_THRESHOLD}) and EVOI (₹${(evoi/100).toFixed(2)}) exceeds investigation cost (₹${(investigationCost/100).toFixed(2)}). Gathering more information before committing capacity.`;
    }
    // Case 2: High confidence + healthy gateway + strong IVEN → ACT
    else if (conf >= 0.70 && gw >= this.GATEWAY_UNSTABLE_THRESHOLD && iven > this.IVEN_BORDERLINE_THRESHOLD_PAISE) {
      action = 'ACT';
      rationale = `High confidence (${conf.toFixed(3)}), healthy gateway (${gw.toFixed(2)}), strong IVEN (₹${(iven/100).toFixed(2)}). Proceeding to act.`;
    }
    // Case 3: IVEN borderline or gateway degraded → WAIT
    else if (iven <= this.IVEN_BORDERLINE_THRESHOLD_PAISE || gw < this.GATEWAY_UNSTABLE_THRESHOLD) {
      action = 'WAIT';
      rationale = `IVEN borderline (₹${(iven/100).toFixed(2)}) or gateway degraded (${gw.toFixed(2)}). Waiting for conditions to improve.`;
    }
    // Case 4: Medium confidence, investigate if cost-effective
    else if (evoi > investigationCost) {
      action = 'INVESTIGATE';
      rationale = `Medium confidence (${conf.toFixed(3)}), EVOI (₹${(evoi/100).toFixed(2)}) exceeds cost. Investigating to refine estimates.`;
    }
    // Default: act if IVEN positive
    else {
      action = iven > 0 ? 'ACT' : 'WAIT';
      rationale = `EVOI (₹${(evoi/100).toFixed(2)}) does not justify investigation cost. ${iven > 0 ? 'Proceeding with current information.' : 'Waiting.'}`;
    }

    return {
      opportunity_id: params.opportunity.id,
      current_iven_paise: iven,
      gateway_health: gw,
      investigation_cost_paise: investigationCost,
      expected_value_of_information_paise: evoi,
      recommended_action: action,
      rationale,
    };
  }
}
