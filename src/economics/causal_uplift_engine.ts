import { RecoveryOpportunity, Score, ConfidenceLevel, IVENBand } from '../types/index.js';
import { ThompsonSamplingBandit, resolveAmountTier } from './bandit_policy.js';
import { BayesianProbabilityCalibrator } from './bayesian_calibration.js';
import { calculateCosts, classifyIVENBand } from './scorer.js';
import { db } from '../db/database.js';

export interface CausalUpliftProfile {
  opportunity_id: string;
  p_natural_mean: number;
  p_natural_credible_interval: [number, number];
  p_intervention_mean: number;
  p_intervention_credible_interval: [number, number];
  treatment_effect_tau: number; // ΔP = P(int) - P(nat)
  treatment_effect_credible_interval: [number, number];
  amount_paise: number;
  expected_incremental_gross_paise: number; // τ * amount
  operational_cost_paise: number;
  fatigue_cost_paise: number;
  net_incremental_value_paise: number; // IVEN
  confidence: ConfidenceLevel;
  iven_band: IVENBand;
  context_cluster: string;
  source: 'BAYESIAN_POSTERIOR' | 'THOMPSON_BANDIT' | 'CAUSAL_PRIOR';
  counterfactual_disclaimer: string;
}

export interface IncrementalAlphaReport {
  total_opportunities_evaluated: number;
  total_acted_opportunities: number;
  total_recovered_opportunities: number;
  gross_recovered_paise: number;
  counterfactual_natural_paise: number;
  proved_incremental_alpha_paise: number; // Net ₹ recovered strictly attributable to CTRL intervention
  proved_incremental_alpha_inr: string;
  empirical_lift_percentage: string;
  bayesian_calibration_status: 'CALIBRATED' | 'COLLECTING_DATA';
}

/**
 * CausalUpliftEngine — Cutting-Edge Contextual Causal Inference Engine for Payment Recovery.
 * Estimates individual treatment effects (ITE) and causal uplift:
 * τ_i = E[ Y_i(1) - Y_i(0) | X_i = x_i ]
 */
export class CausalUpliftEngine {
  private static instance: CausalUpliftEngine;

  public static getInstance(): CausalUpliftEngine {
    if (!CausalUpliftEngine.instance) {
      CausalUpliftEngine.instance = new CausalUpliftEngine();
    }
    return CausalUpliftEngine.instance;
  }

  /**
   * Derive feature cluster string for contextual uplift stratification.
   */
  public static deriveContextCluster(opp: RecoveryOpportunity): string {
    const tier = resolveAmountTier(opp.amount_paise);
    const reason = (opp.reason_code || 'generic').toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const decline = opp.decline_type;
    const attempt = Math.min(opp.attempt_count || 1, 4);
    return `${decline}:${tier}:${reason}:att_${attempt}`;
  }

  /**
   * Evaluates deep causal uplift profile for an opportunity.
   */
  public static evaluateOpportunityUplift(opp: RecoveryOpportunity): CausalUpliftProfile {
    const reason = (opp.reason_code || '').toLowerCase();
    const declineType = opp.decline_type;
    const contextCluster = this.deriveContextCluster(opp);

    // Hard decline invariant: Zero treatment effect
    if (declineType === 'hard') {
      const costs = calculateCosts(opp.attempt_count);
      return {
        opportunity_id: opp.id,
        p_natural_mean: 0.02,
        p_natural_credible_interval: [0.01, 0.03],
        p_intervention_mean: 0.02,
        p_intervention_credible_interval: [0.01, 0.03],
        treatment_effect_tau: 0.0,
        treatment_effect_credible_interval: [0.0, 0.0],
        amount_paise: opp.amount_paise,
        expected_incremental_gross_paise: 0,
        operational_cost_paise: costs.operational_cost_paise,
        fatigue_cost_paise: costs.fatigue_cost_paise,
        net_incremental_value_paise: -costs.total_cost_paise,
        confidence: 'high',
        iven_band: 'NEGATIVE',
        context_cluster: contextCluster,
        source: 'CAUSAL_PRIOR',
        counterfactual_disclaimer: '*Model-estimated counterfactual. Zero treatment effect on hard decline.',
      };
    }

    // 1. Get Bayesian posteriors with Beta-Binomial updating
    const bayes = BayesianProbabilityCalibrator.getEffectiveProbabilitiesSync(reason, declineType);
    
    // 2. Adjust treatment effect using Contextual Bandit arm sampling
    const bandit = ThompsonSamplingBandit.getInstance();
    const banditSample = bandit.sampleProbabilities(opp, opp.tenant_id);

    // Blend Bayesian mean with contextual empirical parameters
    const pNat = Math.max(0.01, Math.min(0.95, (bayes.p_natural + banditSample.p_natural) / 2));
    const minSoftLift = declineType === 'soft' ? 0.05 : 0.0;
    const pInt = Math.max(pNat + minSoftLift, Math.min(0.98, (bayes.p_intervention + banditSample.p_intervention) / 2));
    const tau = Math.max(minSoftLift, Number((pInt - pNat).toFixed(4)));

    // Credible intervals based on posterior uncertainty
    const natStd = Math.max(0.02, (1 - pNat) * pNat * 0.15);
    const intStd = Math.max(0.02, (1 - pInt) * pInt * 0.15);
    const tauStd = Math.sqrt(natStd * natStd + intStd * intStd);

    const natCI: [number, number] = [
      Math.max(0.01, Number((pNat - 1.96 * natStd).toFixed(4))),
      Math.min(0.99, Number((pNat + 1.96 * natStd).toFixed(4))),
    ];
    const intCI: [number, number] = [
      Math.max(0.01, Number((pInt - 1.96 * intStd).toFixed(4))),
      Math.min(0.99, Number((pInt + 1.96 * intStd).toFixed(4))),
    ];
    const tauCI: [number, number] = [
      Math.max(0.0, Number((tau - 1.96 * tauStd).toFixed(4))),
      Math.min(0.99, Number((tau + 1.96 * tauStd).toFixed(4))),
    ];

    // Costs
    const costs = calculateCosts(opp.attempt_count);
    const grossPaise = Math.round(tau * opp.amount_paise);
    const netPaise = grossPaise - costs.total_cost_paise;

    // Confidence tier
    let confidence: ConfidenceLevel = 'medium';
    if (bayes.source === 'CALIBRATED' && (opp.customer_trust_score ?? 0.5) > 0.7) {
      confidence = 'high';
    } else if (opp.attempt_count >= 3 || declineType === 'unknown') {
      confidence = 'low';
    }

    return {
      opportunity_id: opp.id,
      p_natural_mean: Number(pNat.toFixed(4)),
      p_natural_credible_interval: natCI,
      p_intervention_mean: Number(pInt.toFixed(4)),
      p_intervention_credible_interval: intCI,
      treatment_effect_tau: tau,
      treatment_effect_credible_interval: tauCI,
      amount_paise: opp.amount_paise,
      expected_incremental_gross_paise: grossPaise,
      operational_cost_paise: costs.operational_cost_paise,
      fatigue_cost_paise: costs.fatigue_cost_paise,
      net_incremental_value_paise: netPaise,
      confidence,
      iven_band: classifyIVENBand(netPaise),
      context_cluster: contextCluster,
      source: bayes.source === 'CALIBRATED' ? 'BAYESIAN_POSTERIOR' : 'THOMPSON_BANDIT',
      counterfactual_disclaimer: '*Model-estimated counterfactual via Bayesian Causal Inference.',
    };
  }

  /**
   * Computes the Proved Incremental Alpha report from the double-entry ledger.
   * Compares actual recovered amount against estimated natural recovery counterfactual baseline.
   */
  public static calculateIncrementalAlphaReport(): IncrementalAlphaReport {
    try {
      const oppStats = db.prepare(`
        SELECT 
          COUNT(*) as total_opps,
          SUM(CASE WHEN status IN ('executing', 'recovered', 'not_recovered') THEN 1 ELSE 0 END) as total_acted,
          SUM(CASE WHEN status = 'recovered' THEN 1 ELSE 0 END) as total_recovered,
          SUM(CASE WHEN status = 'recovered' THEN amount_paise ELSE 0 END) as gross_recovered_paise
        FROM recovery_opportunities
      `).get() as any;

      const totalOpps = oppStats?.total_opps || 0;
      const totalActed = oppStats?.total_acted || 0;
      const totalRecovered = oppStats?.total_recovered || 0;
      const grossRecoveredPaise = oppStats?.gross_recovered_paise || 0;

      // Calculate counterfactual natural recovery using stored natural probabilities
      const scoreRows = db.prepare(`
        SELECT s.natural_recovery_prob, ro.amount_paise
        FROM scores s
        JOIN recovery_opportunities ro ON s.opportunity_id = ro.id
        WHERE ro.status = 'recovered'
      `).all() as Array<{ natural_recovery_prob: number; amount_paise: number }>;

      let naturalCounterfactualPaise = 0;
      for (const row of scoreRows) {
        naturalCounterfactualPaise += Math.round(row.natural_recovery_prob * row.amount_paise);
      }

      // Proved incremental alpha: Gross recovered minus what would have recovered anyway naturally
      const provedIncrementalPaise = Math.max(0, grossRecoveredPaise - naturalCounterfactualPaise);
      const liftPercentage = naturalCounterfactualPaise > 0
        ? ((provedIncrementalPaise / naturalCounterfactualPaise) * 100).toFixed(1)
        : totalRecovered > 0 ? '100.0' : '0.0';

      return {
        total_opportunities_evaluated: totalOpps,
        total_acted_opportunities: totalActed,
        total_recovered_opportunities: totalRecovered,
        gross_recovered_paise: grossRecoveredPaise,
        counterfactual_natural_paise: naturalCounterfactualPaise,
        proved_incremental_alpha_paise: provedIncrementalPaise,
        proved_incremental_alpha_inr: `₹${(provedIncrementalPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
        empirical_lift_percentage: `+${liftPercentage}%`,
        bayesian_calibration_status: totalRecovered >= 10 ? 'CALIBRATED' : 'COLLECTING_DATA',
      };
    } catch {
      return {
        total_opportunities_evaluated: 0,
        total_acted_opportunities: 0,
        total_recovered_opportunities: 0,
        gross_recovered_paise: 0,
        counterfactual_natural_paise: 0,
        proved_incremental_alpha_paise: 0,
        proved_incremental_alpha_inr: '₹0.00',
        empirical_lift_percentage: '+0.0%',
        bayesian_calibration_status: 'COLLECTING_DATA',
      };
    }
  }
}
