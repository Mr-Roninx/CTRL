import { RecoveryOpportunity } from '../types/index.js';
import {
  getBanditArm,
  upsertBanditArm,
  getAllBanditArms,
  BanditArmRecord,
} from '../db/database.js';

/**
 * Standard Box-Muller transform for generating standard Normal N(0, 1) variates.
 */
function sampleStandardNormal(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Marsaglia and Tsang (2000) Gamma distribution sampler: Gamma(shape, scale=1.0).
 */
export function sampleGamma(shape: number): number {
  if (shape < 1.0) {
    // Johnk's generator or property: Gamma(shape) = Gamma(shape + 1) * U^(1/shape)
    const g = sampleGamma(shape + 1.0);
    const u = Math.random();
    return g * Math.pow(u, 1.0 / shape);
  }

  const d = shape - 1.0 / 3.0;
  const c = 1.0 / Math.sqrt(9.0 * d);

  while (true) {
    const z = sampleStandardNormal();
    const v = Math.pow(1.0 + c * z, 3);

    if (v <= 0) continue;

    const u = Math.random();
    // Fast acceptance squeeze
    if (u < 1.0 - 0.0331 * Math.pow(z, 4)) {
      return d * v;
    }

    // Standard log-acceptance check
    if (Math.log(u) < 0.5 * Math.pow(z, 2) + d * (1.0 - v + Math.log(v))) {
      return d * v;
    }
  }
}

/**
 * Draws a random sample from Beta(alpha, beta) using Gamma variates:
 * If Y1 ~ Gamma(alpha, 1) and Y2 ~ Gamma(beta, 1), then Y1 / (Y1 + Y2) ~ Beta(alpha, beta).
 */
export function sampleBeta(alpha: number, beta: number): number {
  const safeAlpha = Math.max(0.01, alpha);
  const safeBeta = Math.max(0.01, beta);

  const y1 = sampleGamma(safeAlpha);
  const y2 = sampleGamma(safeBeta);

  if (y1 + y2 === 0) return 0.5;

  const raw = y1 / (y1 + y2);
  // Strictly clamp between 0.001 and 0.999
  return Math.max(0.001, Math.min(0.999, raw));
}

export type AmountTier = 'MICRO' | 'MID' | 'HIGH' | 'ENTERPRISE';

export function resolveAmountTier(amountPaise: number): AmountTier {
  if (amountPaise < 100000) return 'MICRO'; // < ₹1,000
  if (amountPaise < 500000) return 'MID';   // ₹1,000 - ₹5,000
  if (amountPaise < 2000000) return 'HIGH'; // ₹5,000 - ₹20,000
  return 'ENTERPRISE';                      // ₹20,000+
}

export interface ThompsonSampleResult {
  p_natural: number;
  p_intervention: number;
  p_incremental: number;
  context_key: string;
  alpha_interv: number;
  beta_interv: number;
  alpha_nat: number;
  beta_nat: number;
  is_hard_veto: boolean;
}

/**
 * Autonomous Thompson Sampling Contextual Bandit.
 * Balances exploration and exploitation across recovery opportunities
 * by sampling from Bayesian conjugate Beta posteriors.
 */
export class ThompsonSamplingBandit {
  private static instance: ThompsonSamplingBandit;

  private constructor() {}

  public static getInstance(): ThompsonSamplingBandit {
    if (!ThompsonSamplingBandit.instance) {
      ThompsonSamplingBandit.instance = new ThompsonSamplingBandit();
    }
    return ThompsonSamplingBandit.instance;
  }

  public getContextKey(opportunity: RecoveryOpportunity): string {
    const tier = resolveAmountTier(opportunity.amount_paise);
    const reason = opportunity.reason_code || 'generic_decline';
    return `${reason}:${tier}`;
  }

  /**
   * Samples counterfactual probabilities using Thompson Sampling from posterior Beta distributions.
   */
  public sampleProbabilities(
    opportunity: RecoveryOpportunity,
    tenantId: string = 'tenant_system_default'
  ): ThompsonSampleResult {
    const contextKey = this.getContextKey(opportunity);

    // NON-NEGOTIABLE COMPLIANCE INVARIANT:
    // If decline is classified as HARD (fraud, stolen, pickup), incremental probability MUST be 0.0.
    if (opportunity.decline_type === 'hard') {
      return {
        p_natural: 0.02,
        p_intervention: 0.02,
        p_incremental: 0.0,
        context_key: contextKey,
        alpha_interv: 1.0,
        beta_interv: 49.0,
        alpha_nat: 1.0,
        beta_nat: 49.0,
        is_hard_veto: true,
      };
    }

    // Retrieve or initialize conjugate Beta parameters
    const existingArm = getBanditArm(tenantId, contextKey);

    // Informative default priors:
    // P(intervention) ~ Beta(3, 3) -> prior mean 0.50
    // P(natural)      ~ Beta(2, 6) -> prior mean 0.25
    const alphaInterv = existingArm?.alpha_interv ?? 3.0;
    const betaInterv = existingArm?.beta_interv ?? 3.0;
    const alphaNat = existingArm?.alpha_nat ?? 2.0;
    const betaNat = existingArm?.beta_nat ?? 6.0;

    // Draw Thompson Samples
    const pInterventionSample = sampleBeta(alphaInterv, betaInterv);
    const pNaturalSample = sampleBeta(alphaNat, betaNat);

    // Incremental probability is the non-negative difference
    const pIncremental = Math.max(0.0, pInterventionSample - pNaturalSample);

    return {
      p_natural: Number(pNaturalSample.toFixed(4)),
      p_intervention: Number(pInterventionSample.toFixed(4)),
      p_incremental: Number(pIncremental.toFixed(4)),
      context_key: contextKey,
      alpha_interv: alphaInterv,
      beta_interv: betaInterv,
      alpha_nat: alphaNat,
      beta_nat: betaNat,
      is_hard_veto: false,
    };
  }

  /**
   * Online Bayesian Reward Updating:
   * Called by the Authoritative Reconciler when a payment link settles.
   */
  public updateReward(params: {
    tenantId: string;
    contextKey: string;
    isRecovered: boolean;
    isIntervention?: boolean;
  }): BanditArmRecord {
    const { tenantId, contextKey, isRecovered, isIntervention = true } = params;

    const existingArm = getBanditArm(tenantId, contextKey) || {
      id: `arm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      tenant_id: tenantId,
      context_key: contextKey,
      alpha_interv: 3.0,
      beta_interv: 3.0,
      alpha_nat: 2.0,
      beta_nat: 6.0,
      pull_count: 0,
      reward_sum: 0.0,
      updated_at: new Date().toISOString(),
    };

    if (isIntervention) {
      if (isRecovered) {
        existingArm.alpha_interv += 1.0;
        existingArm.reward_sum += 1.0;
      } else {
        existingArm.beta_interv += 1.0;
      }
    } else {
      // Natural holdout feedback
      if (isRecovered) {
        existingArm.alpha_nat += 1.0;
      } else {
        existingArm.beta_nat += 1.0;
      }
    }

    existingArm.pull_count += 1;
    existingArm.updated_at = new Date().toISOString();

    upsertBanditArm(existingArm);
    return existingArm;
  }

  /**
   * Returns current bandit statistics across all arms for a merchant.
   */
  public getArmAnalytics(tenantId: string = 'tenant_system_default'): Array<{
    context_key: string;
    expected_p_interv: number;
    expected_p_nat: number;
    expected_incremental_lift: number;
    pull_count: number;
    confidence: 'low' | 'medium' | 'high';
  }> {
    const arms = getAllBanditArms(tenantId);
    return arms.map((arm) => {
      const expInterv = arm.alpha_interv / (arm.alpha_interv + arm.beta_interv);
      const expNat = arm.alpha_nat / (arm.alpha_nat + arm.beta_nat);
      const lift = Math.max(0, expInterv - expNat);
      const totalPulls = arm.pull_count;

      let confidence: 'low' | 'medium' | 'high' = 'low';
      if (totalPulls >= 50) confidence = 'high';
      else if (totalPulls >= 15) confidence = 'medium';

      return {
        context_key: arm.context_key,
        expected_p_interv: Number(expInterv.toFixed(4)),
        expected_p_nat: Number(expNat.toFixed(4)),
        expected_incremental_lift: Number(lift.toFixed(4)),
        pull_count: totalPulls,
        confidence,
      };
    });
  }
}
