import {
  RecoveryOpportunity,
  Score,
  AllocationDecision,
  AuthorityVerdict,
  OpportunityStatus,
} from '../../types/index.js';

export interface AuthorityRuleContext {
  opportunity: RecoveryOpportunity;
  score: Score;
  decision: AllocationDecision;
  tenantId?: string;
}

export interface AuthorityRuleResult {
  passed: boolean;
  reason: string;
  suggestedVerdictOnFailure: AuthorityVerdict;
  suggestedStatusOnFailure: OpportunityStatus;
}

/**
 * Open/Closed Principle (OCP) - Interface for modular compliance rules.
 * Core rules and custom tenant rules implement this contract without modifying the engine.
 */
export interface IAuthorityRule {
  readonly id: string;
  readonly name: string;
  readonly priority: number; // Lower number = evaluated first (e.g. 10 for Hard Decline, 20 for Kill Switch)
  readonly isBlocking: boolean; // If true and failed, immediately halts further execution

  evaluate(context: AuthorityRuleContext): AuthorityRuleResult;
}
