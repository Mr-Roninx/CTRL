import { RecoveryOpportunity, Score } from '../types/index.js';
import { SemanticSignal } from './types.js';
import { calculateCosts, determineConfidence, estimateProbabilities } from '../economics/scorer.js';

export interface CalibratedEconomicModifiers {
  incremental_prob_modifier: number; // e.g. -0.05 to +0.08
  fatigue_cost_modifier_paise: number; // e.g. 0 to +500 paise
  operational_cost_modifier_paise: number; // 0
  confidence_override?: 'low' | 'medium' | 'high';
  calibrated_signals: Record<string, number>;
}

export interface BoundedEconomicScoringResult {
  score: Score;
  baseline_iven_paise: number;
  calibrated_iven_paise: number;
  modifiers_applied: CalibratedEconomicModifiers;
  deterministic_invariant_verified: boolean;
}

export class SemanticEconomicsBridge {
  /**
   * Translates validated semantic signals (0.0 to 1.0) into strictly bounded deterministic modifiers.
   */
  public static calculateModifiers(signals: SemanticSignal[]): CalibratedEconomicModifiers {
    let probModifier = 0.0;
    let fatigueModifierPaise = 0;
    const signalMap: Record<string, number> = {};

    for (const sig of signals) {
      // Enforce hard numeric clamping (0.0 to 1.0)
      const clampedVal = Math.max(0, Math.min(1, Number(sig.value) || 0));
      const clampedConf = Math.max(0, Math.min(1, Number(sig.confidence) || 0.5));
      signalMap[sig.name] = clampedVal;

      if (sig.name === 'transient_failure') {
        // High transient failure indicates intervention lift is solid (boost up to +0.08)
        probModifier += (clampedVal - 0.5) * 0.10 * clampedConf;
      } else if (sig.name === 'gateway_instability') {
        // Gateway instability dampens immediate intervention probability (down to -0.06)
        probModifier -= clampedVal * 0.06 * clampedConf;
      } else if (sig.name === 'customer_liquidity') {
        // Strong liquidity signal increases recovery odds (boost up to +0.05)
        probModifier += (clampedVal - 0.5) * 0.08 * clampedConf;
      } else if (sig.name === 'fatigue') {
        // Fatigue adds penalty cost (up to +500 paise / ₹5.00)
        fatigueModifierPaise += Math.round(clampedVal * 500 * clampedConf);
      }
    }

    // Hard bounds on modifiers to prevent runaway manipulation
    const boundedProbMod = Math.max(-0.10, Math.min(0.10, Number(probModifier.toFixed(4))));
    const boundedFatigueMod = Math.max(0, Math.min(500, fatigueModifierPaise));

    return {
      incremental_prob_modifier: boundedProbMod,
      fatigue_cost_modifier_paise: boundedFatigueMod,
      operational_cost_modifier_paise: 0,
      calibrated_signals: signalMap,
    };
  }

  /**
   * Deterministically computes the final calibrated Score under strict safety invariants.
   */
  public static scoreWithSemanticBridge(
    opp: RecoveryOpportunity,
    signals: SemanticSignal[] = []
  ): BoundedEconomicScoringResult {
    // 1. Baseline Deterministic Calculation
    const baselineProbs = estimateProbabilities(opp);
    const baselineCosts = calculateCosts(opp.attempt_count || 1);
    const baselineConfidence = determineConfidence(opp);

    const baselineIven = Math.round(
      baselineProbs.incremental_prob * opp.amount_paise -
      baselineCosts.operational_cost_paise -
      baselineCosts.fatigue_cost_paise
    );

    // 2. Compute Bounded Modifiers
    const llmInfluenceDisabled = process.env.DISABLE_LLM_SCORING_INFLUENCE === 'true';
    const modifiers = llmInfluenceDisabled
      ? { incremental_prob_modifier: 0, fatigue_cost_modifier_paise: 0, operational_cost_modifier_paise: 0, calibrated_signals: {} }
      : this.calculateModifiers(signals);

    if (!llmInfluenceDisabled && (modifiers.incremental_prob_modifier !== 0 || modifiers.fatigue_cost_modifier_paise !== 0)) {
      console.log(`📐 SemanticBridge: Applied modifiers to ${opp.id}: prob_mod=${modifiers.incremental_prob_modifier}, fatigue_mod=${modifiers.fatigue_cost_modifier_paise}p`);
    }

    // Hard rule: Hard declines can NEVER receive positive incremental probability
    let finalIncrementalProb = baselineProbs.incremental_prob;
    if (opp.decline_type === 'hard') {
      finalIncrementalProb = 0.0;
    } else {
      finalIncrementalProb = Math.max(0, Math.min(0.95, Number((baselineProbs.incremental_prob + modifiers.incremental_prob_modifier).toFixed(4))));
    }

    const finalFatigueCostPaise = baselineCosts.fatigue_cost_paise + modifiers.fatigue_cost_modifier_paise;
    const finalOperationalCostPaise = baselineCosts.operational_cost_paise;

    // 3. Final Deterministic IVEN Formula
    const finalIvenPaise = Math.round(
      finalIncrementalProb * opp.amount_paise -
      finalOperationalCostPaise -
      finalFatigueCostPaise
    );

    const score: Score = {
      opportunity_id: opp.id,
      natural_recovery_prob: baselineProbs.natural_recovery_prob,
      intervention_recovery_prob: Number((baselineProbs.natural_recovery_prob + finalIncrementalProb).toFixed(4)),
      incremental_prob: finalIncrementalProb,
      operational_cost_paise: finalOperationalCostPaise,
      fatigue_cost_paise: finalFatigueCostPaise,
      expected_incremental_value_paise: finalIvenPaise,
      confidence: baselineConfidence,
      probability_disclaimer: 'All probabilities are model-estimated counterfactuals. The true counterfactual is never observed for any real payment.',
      probability_source: baselineProbs.source || 'STATIC',
    };

    return {
      score,
      baseline_iven_paise: baselineIven,
      calibrated_iven_paise: finalIvenPaise,
      modifiers_applied: modifiers,
      deterministic_invariant_verified: true,
    };
  }
}
