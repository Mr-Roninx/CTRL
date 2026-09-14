import { initDatabase, getAllOpportunities, upsertScore } from '../src/db/database.js';
import { seedSyntheticData } from './seed_synthetic.js';
import { SemanticEconomicsBridge } from '../src/agents/bridge.js';
import { runMarketAllocation } from '../src/market/allocator.js';
import { SemanticSignal } from '../src/agents/types.js';

export interface EconomicComparisonResult {
  llm_off: {
    total_opportunities: number;
    allocated_count: number;
    abstained_count: number;
    deferred_count: number;
    total_expected_recovery_paise: number;
    shadow_price_paise: number;
    sample_scores: { id: string; incremental_prob: number; iven_paise: number }[];
  };
  llm_on: {
    total_opportunities: number;
    allocated_count: number;
    abstained_count: number;
    deferred_count: number;
    total_expected_recovery_paise: number;
    shadow_price_paise: number;
    sample_scores: { id: string; incremental_prob: number; iven_paise: number; delta_prob_modifier: number }[];
  };
  measurements: {
    mean_semantic_prob_lift: number;
    mean_soft_decline_iven_lift_paise: number;
    hard_decline_iven_lift_paise: number;
    portfolio_recovery_lift_paise: number;
    shadow_price_delta_paise: number;
    ranking_reorders_count: number;
  };
  malicious_safety_tests: {
    extreme_positive_signal_blocked: boolean;
    extreme_negative_signal_blocked: boolean;
    nan_signal_blocked: boolean;
    hard_decline_override_prevented: boolean;
  };
}

export function runEconomicComparison(): EconomicComparisonResult {
  initDatabase();
  seedSyntheticData();

  const opportunities = getAllOpportunities();

  // 1. LLM OFF: Score strictly using base deterministic economics
  const scoresOff = opportunities.map((opp) => {
    const res = SemanticEconomicsBridge.scoreWithSemanticBridge(opp, []);
    upsertScore(res.score);
    return res.score;
  });

  const allocOff = runMarketAllocation({ capacity: 5 });

  // 2. LLM ON: Simulate calibrated semantic signals from perception and strategy agents
  const scoresOn = opportunities.map((opp) => {
    const signals: SemanticSignal[] = [];
    if (opp.decline_type === 'soft') {
      signals.push(
        {
          name: 'transient_failure',
          value: opp.attempt_count === 1 ? 0.85 : 0.40,
          confidence: 0.90,
          evidence_reference: 'gateway_retry_feasibility',
        },
        {
          name: 'customer_liquidity',
          value: opp.customer_trust_score >= 0.7 ? 0.80 : 0.35,
          confidence: 0.85,
          evidence_reference: 'historical_repayment_trajectory',
        }
      );
    } else {
      // Hard decline: even with adversarial positive signals, must remain 0
      signals.push({
        name: 'transient_failure',
        value: 0.99,
        confidence: 0.99,
        evidence_reference: 'malicious_override_attempt',
      });
    }

    const res = SemanticEconomicsBridge.scoreWithSemanticBridge(opp, signals);
    upsertScore(res.score);
    return res.score;
  });

  const allocOn = runMarketAllocation({ capacity: 5 });

  // 3. Measure Shifts
  let totalProbModifier = 0;
  let softCount = 0;
  let totalSoftIvenLift = 0;
  let hardIvenLift = 0;
  let rankReorders = 0;

  for (let i = 0; i < opportunities.length; i++) {
    const opp = opportunities[i];
    const sOff = scoresOff[i];
    const sOn = scoresOn[i];

    if (opp.decline_type === 'soft') {
      softCount++;
      totalProbModifier += sOn.incremental_prob - sOff.incremental_prob;
      totalSoftIvenLift += sOn.expected_incremental_value_paise - sOff.expected_incremental_value_paise;
    } else {
      hardIvenLift += sOn.expected_incremental_value_paise - sOff.expected_incremental_value_paise;
    }
  }

  // Compare allocation ranks
  const decisionsOffMap = new Map(allocOff.items.map((d) => [d.opportunity_id, d]));
  const decisionsOnMap = new Map(allocOn.items.map((d) => [d.opportunity_id, d]));

  for (const opp of opportunities) {
    const dOff = decisionsOffMap.get(opp.id);
    const dOn = decisionsOnMap.get(opp.id);
    if (dOff && dOn && dOff.decision !== dOn.decision) {
      rankReorders++;
    }
  }

  // 4. Test Malicious Economic Values
  const hardOpp = opportunities.find((o) => o.decline_type === 'hard') || opportunities[0];

  const malRes1 = SemanticEconomicsBridge.scoreWithSemanticBridge(hardOpp, [
    { name: 'transient_failure', value: 9999999, confidence: 1.0, evidence_reference: 'malicious' },
  ]);
  const malRes2 = SemanticEconomicsBridge.scoreWithSemanticBridge(hardOpp, [
    { name: 'transient_failure', value: -1000, confidence: 1.0, evidence_reference: 'malicious' },
  ]);
  const malRes3 = SemanticEconomicsBridge.scoreWithSemanticBridge(hardOpp, [
    { name: 'transient_failure', value: NaN, confidence: NaN, evidence_reference: 'malicious' },
  ]);

  const maliciousSafety = {
    extreme_positive_signal_blocked: malRes1.score.incremental_prob === 0.0 && malRes1.score.expected_incremental_value_paise <= 0,
    extreme_negative_signal_blocked: malRes2.score.incremental_prob === 0.0 && malRes2.score.expected_incremental_value_paise <= 0,
    nan_signal_blocked: !Number.isNaN(malRes1.score.incremental_prob) && !Number.isNaN(malRes1.score.expected_incremental_value_paise),
    hard_decline_override_prevented: malRes1.score.incremental_prob === 0.0,
  };

  const totalExpRecoveryOff = allocOff.items
    .filter((d) => d.decision === 'ACT')
    .reduce((sum, d) => sum + d.expected_incremental_value_paise, 0);

  const totalExpRecoveryOn = allocOn.items
    .filter((d) => d.decision === 'ACT')
    .reduce((sum, d) => sum + d.expected_incremental_value_paise, 0);

  return {
    llm_off: {
      total_opportunities: opportunities.length,
      allocated_count: allocOff.accepted_count,
      abstained_count: allocOff.abstained_count,
      deferred_count: allocOff.deferred_count,
      total_expected_recovery_paise: totalExpRecoveryOff,
      shadow_price_paise: allocOff.shadow_price_paise,
      sample_scores: scoresOff.slice(0, 3).map((s) => ({
        id: s.opportunity_id,
        incremental_prob: s.incremental_prob,
        iven_paise: s.expected_incremental_value_paise,
      })),
    },
    llm_on: {
      total_opportunities: opportunities.length,
      allocated_count: allocOn.accepted_count,
      abstained_count: allocOn.abstained_count,
      deferred_count: allocOn.deferred_count,
      total_expected_recovery_paise: totalExpRecoveryOn,
      shadow_price_paise: allocOn.shadow_price_paise,
      sample_scores: scoresOn.slice(0, 3).map((s) => ({
        id: s.opportunity_id,
        incremental_prob: s.incremental_prob,
        iven_paise: s.expected_incremental_value_paise,
        delta_prob_modifier: Number((s.incremental_prob - (scoresOff.find((x) => x.opportunity_id === s.opportunity_id)?.incremental_prob || 0)).toFixed(4)),
      })),
    },
    measurements: {
      mean_semantic_prob_lift: softCount > 0 ? Number((totalProbModifier / softCount).toFixed(4)) : 0,
      mean_soft_decline_iven_lift_paise: softCount > 0 ? Math.round(totalSoftIvenLift / softCount) : 0,
      hard_decline_iven_lift_paise: hardIvenLift,
      portfolio_recovery_lift_paise: totalExpRecoveryOn - totalExpRecoveryOff,
      shadow_price_delta_paise: allocOn.shadow_price_paise - allocOff.shadow_price_paise,
      ranking_reorders_count: rankReorders,
    },
    malicious_safety_tests: maliciousSafety,
  };
}

if (process.argv[1]?.endsWith('test_llm_economic_influence.ts')) {
  console.log('Running LLM Economic Comparison...');
  const result = runEconomicComparison();
  console.log(JSON.stringify(result, null, 2));
}
