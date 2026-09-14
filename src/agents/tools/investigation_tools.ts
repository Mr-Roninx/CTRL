import {
  getCustomerById,
  getOpportunityById,
  getLedgerEntriesByOpportunity,
  getAllAgentRuns,
} from '../../db/database.js';

/**
 * Autonomous Investigation Tools for CTRL Agents
 * Enables agents to conduct in-depth diagnosis of payment failures.
 */

export interface NetworkStatusResult {
  network: string;
  bank_code?: string;
  status: 'OPERATIONAL' | 'DEGRADED' | 'OUTAGE';
  success_rate: number;
  avg_latency_ms: number;
  recommended_wait_minutes: number;
  downtime_active: boolean;
}

export interface CustomerInteractionHistoryResult {
  customer_id: string;
  total_attempts: number;
  prior_recoveries: number;
  channels_contacted: string[];
  last_interaction_timestamp: string | null;
  fatigue_level: 'LOW' | 'MEDIUM' | 'HIGH';
  preferred_channel: 'WHATSAPP' | 'SMS' | 'EMAIL' | 'PUSH';
  unsubscribed: boolean;
}

export interface RetryWindowSimulationResult {
  opportunity_id: string;
  current_odds: number;
  projections: Array<{
    window: string;
    estimated_recovery_prob: number;
    recommended: boolean;
  }>;
  optimal_window: string;
  recommendation_rationale: string;
}

export interface OptimalDiscountResult {
  opportunity_id: string;
  original_amount_paise: number;
  discount_percentage: number;
  discounted_amount_paise: number;
  expected_conversion_uplift: number;
  net_iven_gain_paise: number;
  is_net_positive: boolean;
  rationale: string;
}

export interface CustomerRiskProfileResult {
  customer_id: string;
  composite_risk_score: number; // 0.0 (safe) to 1.0 (high risk)
  risk_tier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  factors: {
    trust_score: number;
    amount_risk: number;
    velocity_risk: number;
    chargeback_probability: number;
  };
  recommended_action: 'PROCEED' | 'HOLD_FOR_REVIEW' | 'ABSTAIN';
}

export class InvestigationTools {
  /**
   * 1. Check Card Network & Banking Rails Status
   */
  public static async checkCardNetworkStatus(params: {
    network?: string;
    bank_code?: string;
  }): Promise<NetworkStatusResult> {
    const network = (params.network || 'VISA').toUpperCase();
    const bank = (params.bank_code || 'HDFC').toUpperCase();

    // Simulated known bank downtime lookup
    const bankDowntimes: Record<string, { status: 'OPERATIONAL' | 'DEGRADED' | 'OUTAGE'; rate: number; wait: number }> = {
      SBI: { status: 'DEGRADED', rate: 0.72, wait: 25 },
      HDFC: { status: 'OPERATIONAL', rate: 0.94, wait: 0 },
      ICICI: { status: 'OPERATIONAL', rate: 0.92, wait: 0 },
      AXIS: { status: 'OPERATIONAL', rate: 0.89, wait: 0 },
      KOTAK: { status: 'OPERATIONAL', rate: 0.91, wait: 0 },
      YESB: { status: 'DEGRADED', rate: 0.68, wait: 45 },
    };

    const bankProfile = bankDowntimes[bank] ?? { status: 'OPERATIONAL', rate: 0.90, wait: 0 };
    const avgLatency = bankProfile.status === 'DEGRADED' ? 3200 : 850;

    return {
      network,
      bank_code: bank,
      status: bankProfile.status,
      success_rate: bankProfile.rate,
      avg_latency_ms: avgLatency,
      recommended_wait_minutes: bankProfile.wait,
      downtime_active: bankProfile.status !== 'OPERATIONAL',
    };
  }

  /**
   * 2. Query Customer Interaction History & Fatigue Signals
   */
  public static async queryCustomerInteractionHistory(params: {
    customer_id: string;
  }): Promise<CustomerInteractionHistoryResult> {
    const customer = getCustomerById(params.customer_id);
    const relatedRuns = getAllAgentRuns().filter(
      (r) => r.opportunity_id === params.customer_id || r.mission_id?.includes(params.customer_id)
    );

    const channels = ['WHATSAPP', 'SMS'];
    let fatigue: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';

    // Infer fatigue from trust score or interactions
    const trust = customer?.trust_score ?? 0.65;
    if (trust < 0.35 || relatedRuns.length >= 3) {
      fatigue = 'HIGH';
    } else if (trust < 0.6 || relatedRuns.length >= 2) {
      fatigue = 'MEDIUM';
    }

    return {
      customer_id: params.customer_id,
      total_attempts: relatedRuns.length > 0 ? relatedRuns.length : 1,
      prior_recoveries: trust > 0.7 ? 2 : 0,
      channels_contacted: channels,
      last_interaction_timestamp: relatedRuns[0]?.start_time ?? null,
      fatigue_level: fatigue,
      preferred_channel: trust > 0.8 ? 'WHATSAPP' : 'SMS',
      unsubscribed: false,
    };
  }

  /**
   * 3. Simulate Dynamic Retry Windows
   */
  public static async simulateRetryWindow(params: {
    opportunity_id: string;
    reason_code?: string;
    amount_paise?: number;
  }): Promise<RetryWindowSimulationResult> {
    const opp = getOpportunityById(params.opportunity_id);
    const reason = params.reason_code || opp?.reason_code || 'GATEWAY_ERROR';

    let projections: Array<{ window: string; estimated_recovery_prob: number; recommended: boolean }>;

    if (reason === 'INSUFFICIENT_FUNDS') {
      // Salaried pattern: higher recovery odds after salary crediting (t+24h)
      projections = [
        { window: 't+15m', estimated_recovery_prob: 0.12, recommended: false },
        { window: 't+1h', estimated_recovery_prob: 0.20, recommended: false },
        { window: 't+4h', estimated_recovery_prob: 0.35, recommended: false },
        { window: 't+24h', estimated_recovery_prob: 0.68, recommended: true },
      ];
    } else if (reason.includes('NETWORK') || reason.includes('TIMEOUT') || reason === 'GATEWAY_ERROR') {
      // Transient glitches recover fastest at t+15m - t+1h
      projections = [
        { window: 't+15m', estimated_recovery_prob: 0.74, recommended: true },
        { window: 't+1h', estimated_recovery_prob: 0.65, recommended: false },
        { window: 't+4h', estimated_recovery_prob: 0.40, recommended: false },
        { window: 't+24h', estimated_recovery_prob: 0.22, recommended: false },
      ];
    } else {
      projections = [
        { window: 't+15m', estimated_recovery_prob: 0.30, recommended: false },
        { window: 't+1h', estimated_recovery_prob: 0.45, recommended: true },
        { window: 't+4h', estimated_recovery_prob: 0.38, recommended: false },
        { window: 't+24h', estimated_recovery_prob: 0.25, recommended: false },
      ];
    }

    const defaultProjection = projections[0] ?? {
      window: 'T+24h',
      estimated_recovery_prob: 0.25,
      operational_cost_paise: 250,
      recommended: true,
    };
    const optimal = projections.find((p) => p.recommended) ?? defaultProjection;

    return {
      opportunity_id: params.opportunity_id,
      current_odds: defaultProjection.estimated_recovery_prob,
      projections,
      optimal_window: optimal.window,
      recommendation_rationale: `Optimal retry window is ${optimal.window} with ${(optimal.estimated_recovery_prob * 100).toFixed(0)}% simulated recovery probability based on failure code '${reason}'.`,
    };
  }

  /**
   * 4. Calculate Net-Positive Recovery Discount
   */
  public static async calculateOptimalDiscount(params: {
    opportunity_id: string;
    amount_paise?: number;
    customer_trust_score?: number;
  }): Promise<OptimalDiscountResult> {
    const opp = getOpportunityById(params.opportunity_id);
    const amount = params.amount_paise ?? opp?.amount_paise ?? 500000;
    const trust = params.customer_trust_score ?? opp?.customer_trust_score ?? 0.65;

    // For larger transactions (>₹5,000) with moderate trust, a 3% incentive can push incremental odds +25%
    const discountPct = amount >= 500000 ? 3 : 0;
    const discountPaise = Math.round(amount * (discountPct / 100));
    const discountedAmount = amount - discountPaise;

    const baseProb = 0.40;
    const uplift = discountPct > 0 ? 0.22 : 0.0;
    const boostedProb = baseProb + uplift;

    // IVEN comparison: (BoostedProb * DiscountedAmount) - (BaseProb * Amount)
    const originalExpected = baseProb * amount;
    const boostedExpected = boostedProb * discountedAmount;
    const netGain = Math.round(boostedExpected - originalExpected);

    const isPositive = netGain > 5000; // Net positive by at least ₹50

    return {
      opportunity_id: params.opportunity_id,
      original_amount_paise: amount,
      discount_percentage: discountPct,
      discounted_amount_paise: discountedAmount,
      expected_conversion_uplift: uplift,
      net_iven_gain_paise: netGain,
      is_net_positive: isPositive,
      rationale: isPositive
        ? `Offering ${discountPct}% incentive yields ₹${(netGain / 100).toFixed(2)} incremental expected value over baseline.`
        : 'Incentive discount does not overcome margin erosion. Retain full price.',
    };
  }

  /**
   * 5. Multi-factor Customer Risk Evaluation
   */
  public static async evaluateCustomerRiskProfile(params: {
    customer_id: string;
    amount_paise?: number;
  }): Promise<CustomerRiskProfileResult> {
    const customer = getCustomerById(params.customer_id);
    const trustScore = customer?.trust_score ?? 0.65;
    const amount = params.amount_paise ?? 100000;

    // Higher amounts (>₹50,000) slightly elevate verification need
    const amountRisk = amount > 5000000 ? 0.35 : 0.10;
    const velocityRisk = 0.15;
    const chargebackProb = (1.0 - trustScore) * 0.15;

    const compositeRisk = Math.min(1.0, (1.0 - trustScore) * 0.6 + amountRisk + velocityRisk);

    let tier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    let action: 'PROCEED' | 'HOLD_FOR_REVIEW' | 'ABSTAIN' = 'PROCEED';

    if (compositeRisk >= 0.8) {
      tier = 'CRITICAL';
      action = 'ABSTAIN';
    } else if (compositeRisk >= 0.55) {
      tier = 'HIGH';
      action = 'HOLD_FOR_REVIEW';
    } else if (compositeRisk >= 0.3) {
      tier = 'MEDIUM';
      action = 'PROCEED';
    }

    return {
      customer_id: params.customer_id,
      composite_risk_score: Number(compositeRisk.toFixed(3)),
      risk_tier: tier,
      factors: {
        trust_score: trustScore,
        amount_risk: amountRisk,
        velocity_risk: velocityRisk,
        chargeback_probability: Number(chargebackProb.toFixed(3)),
      },
      recommended_action: action,
    };
  }
}
