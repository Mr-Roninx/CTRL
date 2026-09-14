import type { RecoveryOpportunity, Score, ConfidenceLevel, IVENBand } from '../types/index.js';
import { upsertScore, updateOpportunityStatus } from '../db/database.js';
import { BayesianProbabilityCalibrator } from './bayesian_calibration.js';
import { ThompsonSamplingBandit } from './bandit_policy.js';

export type { IVENBand };

/**
 * Classifies an IVEN value into economic priority bands:
 * - STRONG: IVEN >= ₹150 (15,000 paise) — High-conviction recovery
 * - MODERATE: ₹50 <= IVEN < ₹150 (5,000 to 14,999 paise) — Profitable recovery
 * - WEAK: ₹0 < IVEN < ₹50 (1 to 4,999 paise) — Marginal recovery
 * - NEGATIVE: IVEN <= ₹0 — Value destructive (must ABSTAIN)
 */
export function classifyIVENBand(ivenPaise: number): IVENBand {
  if (ivenPaise >= 15000) return 'STRONG';
  if (ivenPaise >= 5000) return 'MODERATE';
  if (ivenPaise > 0) return 'WEAK';
  return 'NEGATIVE';
}

export interface ProbabilityEstimate {
  natural_recovery_prob: number;
  intervention_recovery_prob: number;
  incremental_prob: number;
  source?: 'STATIC' | 'CALIBRATED';
  credible_interval_95?: [number, number];
}

export interface CostBreakdown {
  operational_cost_paise: number;
  fatigue_cost_paise: number;
  total_cost_paise: number;
}

/**
 * Probabilities estimated via Bayesian Calibration engine.
 * Reads from Beta-Binomial posterior distributions with sample-size gated auto-promotion.
 * Note: All probabilities are model-estimated counterfactuals.
 */
export function estimateProbabilities(opp: RecoveryOpportunity): ProbabilityEstimate {
  const reason = (opp.reason_code || '').toLowerCase();
  const declineType = opp.decline_type;

  // Query Bayesian Calibration engine (hot cache / Beta posterior)
  const bayes = BayesianProbabilityCalibrator.getEffectiveProbabilitiesSync(reason, declineType);

  let natural = bayes.p_natural;
  let intervention = bayes.p_intervention;

  // Invariant: Hard declines strictly have 0 incremental recovery probability
  if (declineType === 'hard') {
    natural = 0.02;
    intervention = 0.02;
  }

  const incremental = Math.max(0, Number((intervention - natural).toFixed(4)));

  return {
    natural_recovery_prob: natural,
    intervention_recovery_prob: intervention,
    incremental_prob: incremental,
    source: bayes.source,
    credible_interval_95: bayes.credible_interval_95,
  };
}

/**
 * Calculates operational delivery cost and customer fatigue penalties
 * 
 * Fatigue cost curve:
 * - Attempt 1: 0 paise (₹0.00)
 * - Attempt 2: 250 paise (₹2.50)
 * - Attempt 3: 750 paise (₹7.50)
 * - Attempt 4+: 1500 paise (₹15.00) + 500 paise per subsequent attempt
 */
export function calculateCosts(attemptCount: number): CostBreakdown {
  const operational_cost_paise = 400; // Fixed ₹4.00 per payment link

  let fatigue_cost_paise = 0;
  if (attemptCount <= 1) {
    fatigue_cost_paise = 0;
  } else if (attemptCount === 2) {
    fatigue_cost_paise = 250;
  } else if (attemptCount === 3) {
    fatigue_cost_paise = 750;
  } else {
    fatigue_cost_paise = 1500 + (attemptCount - 4) * 500;
  }

  return {
    operational_cost_paise,
    fatigue_cost_paise,
    total_cost_paise: operational_cost_paise + fatigue_cost_paise,
  };
}

/**
 * Computes confidence level based on decline determinism and attempt history
 * - low: unknown decline OR attempt_count >= 3
 * - high: hard decline OR bank timeout (clear-cut outcomes)
 * - medium: standard soft declines at attempts 1-2
 */
export function determineConfidence(opp: RecoveryOpportunity): ConfidenceLevel {
  const reason = (opp.reason_code || '').toLowerCase();
  const isBankTimeout =
    reason.includes('timeout') ||
    reason.includes('network') ||
    reason.includes('bank_gateway_timeout');

  if (opp.decline_type === 'unknown' || opp.attempt_count >= 3) {
    return 'low';
  }

  if (opp.decline_type === 'hard' || isBankTimeout) {
    return 'high';
  }

  return 'medium';
}

export interface ScoreOptions {
  useBanditSampling?: boolean;
  tenantId?: string;
}

/**
 * Full scoring calculation for an opportunity
 * Computes IVEN (Expected Incremental Value) = incremental_prob * amount - costs
 */
export function calculateScore(opp: RecoveryOpportunity, options?: ScoreOptions): Score {
  // Input Sanitization & Boundary Defenses
  const safeAmount = Math.max(0, Number.isFinite(opp.amount_paise) ? Math.floor(opp.amount_paise) : 0);
  const safeAttempts = Math.max(1, Math.min(20, Number.isFinite(opp.attempt_count) ? Math.floor(opp.attempt_count) : 1));

  let probs: ProbabilityEstimate;

  if (options?.useBanditSampling || process.env.ENABLE_THOMPSON_SAMPLING === 'true') {
    const bandit = ThompsonSamplingBandit.getInstance();
    const sample = bandit.sampleProbabilities(opp, options?.tenantId || opp.tenant_id);
    probs = {
      natural_recovery_prob: Math.max(0, Math.min(1, sample.p_natural)),
      intervention_recovery_prob: Math.max(0, Math.min(1, sample.p_intervention)),
      incremental_prob: Math.max(0, Math.min(1, sample.p_incremental)),
      source: 'CALIBRATED',
    };
  } else {
    probs = estimateProbabilities(opp);
  }

  // Ensure incremental probability strictly reflects intervention minus natural
  const boundedIncremental = Math.max(0, Number((probs.intervention_recovery_prob - probs.natural_recovery_prob).toFixed(4)));
  probs.incremental_prob = boundedIncremental;

  const costs = calculateCosts(safeAttempts);
  const confidence = determineConfidence(opp);

  // IVEN = (incremental_prob * amount_paise) - operational_cost - fatigue_cost
  const expectedIncrementalGross = probs.incremental_prob * safeAmount;
  let expected_incremental_value_paise = Math.round(
    expectedIncrementalGross - costs.operational_cost_paise - costs.fatigue_cost_paise
  );

  // Invariant Guard: Hard decline strictly cannot yield positive IVEN
  if (opp.decline_type === 'hard') {
    expected_incremental_value_paise = Math.min(0, expected_incremental_value_paise);
  }

  const iven_band = classifyIVENBand(expected_incremental_value_paise);

  return {
    opportunity_id: opp.id,
    tenant_id: opp.tenant_id,
    natural_recovery_prob: probs.natural_recovery_prob,
    intervention_recovery_prob: probs.intervention_recovery_prob,
    incremental_prob: probs.incremental_prob,
    operational_cost_paise: costs.operational_cost_paise,
    fatigue_cost_paise: costs.fatigue_cost_paise,
    expected_incremental_value_paise,
    confidence,
    iven_band,
    probability_disclaimer: 'All probabilities are model-estimated counterfactuals. The true counterfactual is never observed for any real payment.',
    probability_source: probs.source || 'STATIC',
  };
}

/**
 * Scores an opportunity, saves to SQLite scores table, and updates opportunity status
 */
export function scoreOpportunity(opp: RecoveryOpportunity, options?: ScoreOptions): Score {
  const score = calculateScore(opp, options);
  upsertScore(score);

  if (opp.status === 'pending') {
    updateOpportunityStatus(opp.id, 'scored');
  }

  return score;
}
