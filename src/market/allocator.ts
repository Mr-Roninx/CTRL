import {
  db,
  getAllOpportunities,
  getScoreByOpportunityId,
  upsertAllocationDecision,
  updateOpportunityStatus,
} from '../db/database.js';
import { scoreOpportunity } from '../economics/scorer.js';
import {
  RecoveryOpportunity,
  Score,
  AllocationDecision,
  DecisionType,
} from '../types/index.js';
import { DualMirrorBudgetPacer } from './capacity_policy.js';
import { AntiBlastEngine } from '../economics/anti_blast_engine.js';

export interface OpportunityWithScore {
  opportunity: RecoveryOpportunity;
  score: Score;
}

export interface MarketAllocationItem {
  opportunity_id: string;
  amount_paise: number;
  currency: string;
  reason_code: string;
  decline_type: string;
  attempt_count: number;
  incremental_prob: number;
  expected_incremental_value_paise: number;
  confidence: string;
  decision: DecisionType;
  rank_in_batch: number;
  shadow_price_paise_at_decision: number;
  reason: string;
}

export interface MarketRunResult {
  capacity: number;
  total_opportunities: number;
  eligible_count: number;
  abstained_count: number;
  accepted_count: number;
  deferred_count: number;
  shadow_price_paise: number;
  shadow_price_display: string;
  items: MarketAllocationItem[];
  lagrangian_shadow_multiplier?: number;
  lagrangian_target_shadow_price_paise?: number;
  budget_pacing_burn_rate?: number;
}

export function runMarketAllocation(options: { capacity?: number; opportunities?: RecoveryOpportunity[]; tenantId?: string; environment?: 'test' | 'live' } = {}): MarketRunResult {
  // Resolve capacity and environment: explicit > per-tenant DB > env var > default
  let capacity = options.capacity;
  let env = options.environment;
  if (options.tenantId) {
    try {
      const stmt = db.prepare('SELECT capacity_limit, environment FROM tenants WHERE id = ? LIMIT 1;');
      const row = stmt.get(options.tenantId) as { capacity_limit?: number; environment?: 'test' | 'live' } | undefined;
      if (capacity === undefined && row?.capacity_limit) capacity = row.capacity_limit;
      if (!env && row?.environment) env = row.environment;
    } catch { /* fallthrough to env var */ }
  }
  if (capacity === undefined) {
    capacity = Number(process.env.MAX_LINKS_PER_RUN) || 5;
  }

  // Filter opportunities to tenant scope & environment, excluding terminal and in-flight states
  const rawOpps = options.opportunities || getAllOpportunities(options.tenantId, env);
  const allOpps = rawOpps.filter(
    (opp) => opp.status === 'pending' || opp.status === 'scored' || opp.status === 'deferred'
  );

  // 1. Fetch or compute economic scores for all opportunities
  const scoredItems: OpportunityWithScore[] = allOpps.map((opp) => {
    let score = getScoreByOpportunityId(opp.id);
    if (!score) {
      score = scoreOpportunity(opp);
    }
    return { opportunity: opp, score };
  });

  const abstainedList: { item: OpportunityWithScore; reason: string }[] = [];
  const eligibleList: OpportunityWithScore[] = [];

  // 2. Filter: Route confidence=low or IVEN <= 0 straight to ABSTAIN (never enters ranking)
  for (const entry of scoredItems) {
    const { opportunity, score } = entry;
    if (score.confidence === 'low') {
      abstainedList.push({
        item: entry,
        reason: `abstained — low confidence score (${opportunity.decline_type}, attempt ${opportunity.attempt_count})`,
      });
    } else if (score.expected_incremental_value_paise <= 0) {
      abstainedList.push({
        item: entry,
        reason: `abstained — non-positive expected incremental value (₹${(score.expected_incremental_value_paise / 100).toFixed(2)})`,
      });
    } else if (AntiBlastEngine.isSyntheticHoldout(opportunity.id)) {
      abstainedList.push({
        item: entry,
        reason: `abstained — counterfactual holdout (5% deterministic control group)`,
      });
    } else {
      eligibleList.push(entry);
    }
  }

  // 3. Rank remaining eligible opportunities by IVEN descending
  eligibleList.sort((a, b) => {
    return b.score.expected_incremental_value_paise - a.score.expected_incremental_value_paise;
  });

  // 4. Calculate Shadow Price = IVEN of the last allocated (marginal) opportunity whenever capacity binds (Rule 4)
  const acceptedCount = Math.min(capacity, eligibleList.length);
  const capacityBinds = eligibleList.length >= capacity && capacity > 0;
  let shadowPricePaise = 0;
  if (capacityBinds && acceptedCount > 0) {
    shadowPricePaise = eligibleList[acceptedCount - 1]?.score.expected_incremental_value_paise ?? 0;
  }
  const shadowPriceDisplay = `₹${(shadowPricePaise / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const finalItems: MarketAllocationItem[] = [];

  // 5. Assign ACT and WAIT decisions to ranked items
  for (let i = 0; i < eligibleList.length; i++) {
    const rank = i + 1;
    const item = eligibleList[i];
    if (!item) continue;
    const { opportunity, score } = item;
    let decision: DecisionType;
    let reason: string;

    if (rank <= capacity) {
      decision = 'ACT';
      reason = `accepted — rank #${rank} within capacity limit of ${capacity} (marginal cutoff: ${shadowPriceDisplay})`;
      updateOpportunityStatus(opportunity.id, 'allocated');
    } else {
      decision = 'WAIT';
      reason = `deferred — below this run's marginal value of ${shadowPriceDisplay} (rank #${rank} vs cap ${capacity})`;
      updateOpportunityStatus(opportunity.id, 'deferred');
    }

    const decisionRecord: AllocationDecision = {
      opportunity_id: opportunity.id,
      decision,
      rank_in_batch: rank,
      shadow_price_paise_at_decision: shadowPricePaise,
      reason,
    };

    upsertAllocationDecision(decisionRecord);

    finalItems.push({
      opportunity_id: opportunity.id,
      amount_paise: opportunity.amount_paise,
      currency: opportunity.currency,
      reason_code: opportunity.reason_code,
      decline_type: opportunity.decline_type,
      attempt_count: opportunity.attempt_count,
      incremental_prob: score.incremental_prob,
      expected_incremental_value_paise: score.expected_incremental_value_paise,
      confidence: score.confidence,
      decision,
      rank_in_batch: rank,
      shadow_price_paise_at_decision: shadowPricePaise,
      reason,
    });
  }

  // 6. Record ABSTAIN decisions (rank_in_batch = 0)
  for (const { item, reason } of abstainedList) {
    const { opportunity, score } = item;
    const decision: DecisionType = 'ABSTAIN';
    updateOpportunityStatus(opportunity.id, 'abstained');

    const decisionRecord: AllocationDecision = {
      opportunity_id: opportunity.id,
      decision,
      rank_in_batch: 0,
      shadow_price_paise_at_decision: shadowPricePaise,
      reason,
    };

    upsertAllocationDecision(decisionRecord);

    // Record Anti-Blast prevented intervention and capital saved
    AntiBlastEngine.recordPreventedIntervention(opportunity, reason).catch(() => {});

    finalItems.push({
      opportunity_id: opportunity.id,
      amount_paise: opportunity.amount_paise,
      currency: opportunity.currency,
      reason_code: opportunity.reason_code,
      decline_type: opportunity.decline_type,
      attempt_count: opportunity.attempt_count,
      incremental_prob: score.incremental_prob,
      expected_incremental_value_paise: score.expected_incremental_value_paise,
      confidence: score.confidence,
      decision,
      rank_in_batch: 0,
      shadow_price_paise_at_decision: shadowPricePaise,
      reason,
    });
  }

    const pacingState = DualMirrorBudgetPacer.getPacingState(options.tenantId || 'merchant_default');
    const lagrangianTargetPaise = Math.round(pacingState.lambda * 400);

    return {
      capacity,
      total_opportunities: allOpps.length,
      eligible_count: eligibleList.length,
      abstained_count: abstainedList.length,
      accepted_count: Math.min(capacity, eligibleList.length),
      deferred_count: Math.max(0, eligibleList.length - capacity),
      shadow_price_paise: shadowPricePaise,
      shadow_price_display: shadowPriceDisplay,
      items: finalItems,
      lagrangian_shadow_multiplier: pacingState.lambda,
      lagrangian_target_shadow_price_paise: lagrangianTargetPaise,
      budget_pacing_burn_rate: Number((pacingState.spent_today_paise / (pacingState.daily_budget_paise || 1)).toFixed(4)),
    };
  }
