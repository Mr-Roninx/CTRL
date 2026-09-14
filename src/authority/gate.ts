import {
  RecoveryOpportunity,
  Score,
  AllocationDecision,
  AuthorityCheck,
  AuthorityVerdict,
} from '../types/index.js';
import {
  db,
  insertAuthorityCheck,
  clearAuthorityChecksForOpportunity,
  updateOpportunityStatus,
  getAllOpportunities,
  getScoreByOpportunityId,
  getAllocationDecisionByOpportunityId,
} from '../db/database.js';
import { runMarketAllocation } from '../market/allocator.js';
import { scoreOpportunity } from '../economics/scorer.js';

// Multi-Level Kill Switch State
let isGlobalKillSwitchActive = false;
const tenantKillSwitches = new Map<string, boolean>();
const providerKillSwitches = new Map<string, boolean>();

export function isKillSwitchActive(tenantId?: string, provider?: string): boolean {
  if (isGlobalKillSwitchActive) return true;
  if (tenantId && tenantKillSwitches.get(tenantId) === true) return true;
  if (provider && providerKillSwitches.get(provider) === true) return true;
  return false;
}

export function setKillSwitch(enabled: boolean): boolean {
  isGlobalKillSwitchActive = Boolean(enabled);
  return isGlobalKillSwitchActive;
}

export function setTenantKillSwitch(tenantId: string, enabled: boolean): boolean {
  tenantKillSwitches.set(tenantId, Boolean(enabled));
  return Boolean(enabled);
}

export function setProviderKillSwitch(provider: string, enabled: boolean): boolean {
  providerKillSwitches.set(provider, Boolean(enabled));
  return Boolean(enabled);
}

export function resetAllKillSwitches(): void {
  isGlobalKillSwitchActive = false;
  tenantKillSwitches.clear();
  providerKillSwitches.clear();
}

export interface AuthorityEvaluationResult {
  opportunity_id: string;
  verdict: AuthorityVerdict;
  checks: AuthorityCheck[];
  summary_reason: string;
}

import { AuthorityRuleRegistry } from './rule_registry.js';

/**
 * Runs deterministic compliance checks on an opportunity using the extensible Rule Engine (Open/Closed Principle)
 */
export function evaluateOpportunity(
  opp: RecoveryOpportunity,
  decision?: AllocationDecision,
  score?: Score
): AuthorityEvaluationResult {
  const effectiveScore = score || getScoreByOpportunityId(opp.id) || scoreOpportunity(opp);
  const effectiveDecision = decision || getAllocationDecisionByOpportunityId(opp.id) || {
    opportunity_id: opp.id,
    decision: 'WAIT',
    rank_in_batch: 999,
    shadow_price_paise_at_decision: 0,
    reason: 'Unallocated opportunity pending market allocation run',
  };

  // Evaluate modular rules via AuthorityRuleRegistry
  const ruleResult = AuthorityRuleRegistry.getInstance().evaluate({
    opportunity: opp,
    score: effectiveScore,
    decision: effectiveDecision,
    tenantId: opp.tenant_id,
  });

  // Persist all check records to SQLite (durable audit trail)
  clearAuthorityChecksForOpportunity(opp.id);
  for (const check of ruleResult.checks) {
    insertAuthorityCheck(check);
  }

  // Update opportunity status according to rule engine recommendation
  updateOpportunityStatus(opp.id, ruleResult.suggestedStatus);

  return {
    opportunity_id: opp.id,
    verdict: ruleResult.verdict,
    checks: ruleResult.checks,
    summary_reason: ruleResult.summaryReason,
  };
}

export interface AuthorityPipelineResult {
  kill_switch_active: boolean;
  total_evaluated: number;
  authorized_count: number;
  blocked_count: number;
  abstained_count: number;
  deferred_count: number;
  results: AuthorityEvaluationResult[];
}

/**
 * Runs full two-stage pipeline: Recovery Market Allocation followed by Action Authority Gate
 */
export function runAuthorityPipeline(options: { capacity?: number; tenantId?: string; environment?: 'test' | 'live' } = {}): AuthorityPipelineResult {
  // 1. Run Market Allocation scoped to tenant & environment
  runMarketAllocation(options);

  let env = options.environment;
  if (!env && options.tenantId) {
    try {
      const stmt = db.prepare('SELECT environment FROM tenants WHERE id = ? LIMIT 1;');
      const row = stmt.get(options.tenantId) as { environment?: 'test' | 'live' } | undefined;
      if (row?.environment) env = row.environment;
    } catch { /* fallthrough */ }
  }

  const rawOpps = getAllOpportunities(options.tenantId, env);
  const allOpps = rawOpps.filter(
    (opp) => opp.status === 'allocated' || opp.status === 'pending' || opp.status === 'scored'
  );
  const results: AuthorityEvaluationResult[] = [];

  let authorized_count = 0;
  let blocked_count = 0;
  let abstained_count = 0;
  let deferred_count = 0;

  for (const opp of allOpps) {
    let score = getScoreByOpportunityId(opp.id);
    if (!score) score = scoreOpportunity(opp);

    let decision = getAllocationDecisionByOpportunityId(opp.id);
    if (!decision) {
      decision = {
        opportunity_id: opp.id,
        decision: 'WAIT',
        rank_in_batch: 999,
        shadow_price_paise_at_decision: 0,
        reason: 'Unallocated evaluation',
      };
    }

    const evalResult = evaluateOpportunity(opp, decision, score);
    results.push(evalResult);

    if (evalResult.verdict === 'AUTHORIZED') authorized_count++;
    else if (evalResult.verdict === 'BLOCKED') blocked_count++;
    else if (evalResult.verdict === 'ABSTAIN') abstained_count++;
    else if (evalResult.verdict === 'WAIT') deferred_count++;
  }

  return {
    kill_switch_active: isKillSwitchActive(options.tenantId),
    total_evaluated: allOpps.length,
    authorized_count,
    blocked_count,
    abstained_count,
    deferred_count,
    results,
  };
}
