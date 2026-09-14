import { SyntheticDataGenerator } from './synthetic_generator.js';
import { calculateScore } from '../economics/scorer.js';
import { evaluateOpportunity } from '../authority/gate.js';
import { RecoveryOpportunity, Score, AllocationDecision } from '../types/index.js';

export type ScenarioType = 'BALANCED_BATCH' | 'CAPACITY_STRESS' | 'HARD_DECLINE_WAVE' | 'COUNTERFACTUAL_A_B';

export interface ScenarioRunResult {
  scenario_type: ScenarioType;
  total_opportunities: number;
  capacity_limit: number;
  allocated_count: number;
  deferred_count: number;
  blocked_count: number;
  abstained_count: number;
  shadow_price_paise: number;
  total_at_risk_paise: number;
  total_allocated_expected_revenue_paise: number;
  counterfactual_lift?: {
    intervention_arm_recovery_rate: number;
    control_arm_natural_rate: number;
    incremental_lift: number;
    is_model_estimated: boolean;
  };
  duration_ms: number;
}

export class ScenarioRunner {
  private generator: SyntheticDataGenerator;

  constructor(tenantId: string = 'tenant_sim_01') {
    this.generator = new SyntheticDataGenerator({ tenantId });
  }

  /**
   * Executes a parameterized scenario batch through the full economic and authority pipeline.
   */
  public async runScenario(type: ScenarioType, options: { count?: number; capacity?: number } = {}): Promise<ScenarioRunResult> {
    const startTime = Date.now();
    const capacity = options.capacity || 5;
    const count = options.count || (type === 'CAPACITY_STRESS' ? 20 : 10);

    let opportunities: RecoveryOpportunity[] = [];

    if (type === 'HARD_DECLINE_WAVE') {
      // 100% hard declines
      for (let i = 0; i < count; i++) {
        const evt = this.generator.generateFailureEvent({
          failure_type: 'hard',
          failure_code: 'card_reported_lost_or_stolen',
          failure_description: 'Fraudulent card decline',
        });
        opportunities.push({
          id: `opp_hard_${i}_${Date.now()}`,
          source: 'synthetic',
          amount_paise: evt.amount_paise,
          currency: 'INR',
          reason_code: evt.failure_code || 'card_reported_lost_or_stolen',
          decline_type: 'hard',
          attempt_count: 1,
          customer_id: evt.customer_reference,
          customer_trust_score: 20,
          created_at: evt.occurred_at,
          status: 'pending',
          tenant_id: 'tenant_system_default',
          environment: 'test',
        });
      }
    } else if (type === 'CAPACITY_STRESS') {
      // 100% positive IVEN soft declines to stress capacity K
      for (let i = 0; i < count; i++) {
        const evt = this.generator.generateFailureEvent({
          failure_type: 'soft',
          failure_code: 'bad_request_payment_card_expired',
          amount_paise: 200000 + i * 20000,
        });
        opportunities.push({
          id: `opp_stress_${i}_${Date.now()}`,
          source: 'synthetic',
          amount_paise: evt.amount_paise,
          currency: 'INR',
          reason_code: evt.failure_code || 'bad_request_payment_card_expired',
          decline_type: 'soft',
          attempt_count: 1,
          customer_id: evt.customer_reference,
          customer_trust_score: 90,
          created_at: evt.occurred_at,
          status: 'pending',
          tenant_id: 'tenant_system_default',
          environment: 'test',
        });
      }
    } else {
      opportunities = this.generator.generateOpportunityBatch({ count });
    }

    // Step 1: Score all opportunities (Stage 1 Economics)
    const scoredPairs: { opp: RecoveryOpportunity; score: Score }[] = opportunities.map((opp) => ({
      opp,
      score: calculateScore(opp),
    }));

    // Step 2: Market Ranking & Greedy Allocation
    const positiveIven = scoredPairs.filter((p) => p.score.expected_incremental_value_paise > 0);
    positiveIven.sort((a, b) => b.score.expected_incremental_value_paise - a.score.expected_incremental_value_paise);

    const accepted = positiveIven.slice(0, capacity);
    const deferred = positiveIven.slice(capacity);
    const negative = scoredPairs.filter((p) => p.score.expected_incremental_value_paise <= 0);

    const shadowPricePaise = accepted.length > 0 ? (accepted[accepted.length - 1]?.score.expected_incremental_value_paise ?? 0) : 0;

    // Step 3: Action Authority Compliance Evaluation (Stage 2 Gate)
    let allocated_count = 0;
    let blocked_count = 0;
    let abstained_count = 0;
    let deferred_count = deferred.length;
    let total_allocated_expected_revenue_paise = 0;

    for (let i = 0; i < accepted.length; i++) {
      const pair = accepted[i];
      if (!pair) continue;
      const { opp, score } = pair;
      const decision: AllocationDecision = {
        opportunity_id: opp.id,
        decision: 'ACT',
        rank_in_batch: i + 1,
        shadow_price_paise_at_decision: shadowPricePaise,
        reason: 'Accepted in simulation batch',
      };

      const authVerdict = evaluateOpportunity(opp, decision, score);
      if (authVerdict.verdict === 'AUTHORIZED') {
        allocated_count++;
        total_allocated_expected_revenue_paise += score.expected_incremental_value_paise;
      } else if (authVerdict.verdict === 'BLOCKED') {
        blocked_count++;
      } else if (authVerdict.verdict === 'ABSTAIN') {
        abstained_count++;
      }
    }

    for (const { opp, score } of negative) {
      const decision: AllocationDecision = {
        opportunity_id: opp.id,
        decision: 'ABSTAIN',
        rank_in_batch: 999,
        shadow_price_paise_at_decision: shadowPricePaise,
        reason: 'Negative IVEN in simulation',
      };
      const authVerdict = evaluateOpportunity(opp, decision, score);
      if (authVerdict.verdict === 'BLOCKED') blocked_count++;
      else abstained_count++;
    }

    const totalAtRiskPaise = opportunities.reduce((acc, o) => acc + o.amount_paise, 0);

    // Step 4: Counterfactual Lift computation if A/B scenario
    let counterfactual_lift = undefined;
    if (type === 'COUNTERFACTUAL_A_B') {
      const avgInterventionProb =
        scoredPairs.reduce((acc, p) => acc + p.score.intervention_recovery_prob, 0) / scoredPairs.length;
      const avgNaturalProb =
        scoredPairs.reduce((acc, p) => acc + p.score.natural_recovery_prob, 0) / scoredPairs.length;
      const lift = avgInterventionProb - avgNaturalProb;

      counterfactual_lift = {
        intervention_arm_recovery_rate: Number(avgInterventionProb.toFixed(4)),
        control_arm_natural_rate: Number(avgNaturalProb.toFixed(4)),
        incremental_lift: Number(lift.toFixed(4)),
        is_model_estimated: true,
      };
    }

    return {
      scenario_type: type,
      total_opportunities: count,
      capacity_limit: capacity,
      allocated_count,
      deferred_count,
      blocked_count,
      abstained_count,
      shadow_price_paise: shadowPricePaise,
      total_at_risk_paise: totalAtRiskPaise,
      total_allocated_expected_revenue_paise,
      counterfactual_lift,
      duration_ms: Date.now() - startTime,
    };
  }
}
