import {
  IAuthorityRule,
  AuthorityRuleContext,
  AuthorityRuleResult,
} from './rules/rule_interface.js';
import {
  HardDeclineRule,
  RetryCapRule,
  KillSwitchRule,
  ConfidenceRecheckRule,
  CapacityRecheckRule,
} from './rules/core_rules.js';
import {
  AuthorityCheck,
  AuthorityVerdict,
  OpportunityStatus,
} from '../types/index.js';

export interface RuleEngineEvaluationResult {
  verdict: AuthorityVerdict;
  checks: AuthorityCheck[];
  suggestedStatus: OpportunityStatus;
  summaryReason: string;
}

/**
 * Open/Closed Principle (OCP) - Compliance Rule Registry & Engine
 * Open for extension: new rules can be added dynamically via `registerRule()`.
 * Closed for modification: the execution pipeline and verdict evaluation algorithm remain stable.
 */
export class AuthorityRuleRegistry {
  private static instance: AuthorityRuleRegistry;
  private rules: Map<string, IAuthorityRule> = new Map();

  private constructor() {
    this.registerDefaultRules();
  }

  public static getInstance(): AuthorityRuleRegistry {
    if (!AuthorityRuleRegistry.instance) {
      AuthorityRuleRegistry.instance = new AuthorityRuleRegistry();
    }
    return AuthorityRuleRegistry.instance;
  }

  /**
   * Resets registry to default 5 core rules (useful in testing)
   */
  public resetToDefaults(): void {
    this.rules.clear();
    this.registerDefaultRules();
  }

  private registerDefaultRules(): void {
    this.registerRule(new KillSwitchRule());       // Priority 5
    this.registerRule(new HardDeclineRule());      // Priority 10
    this.registerRule(new RetryCapRule());         // Priority 20
    this.registerRule(new ConfidenceRecheckRule());// Priority 30
    this.registerRule(new CapacityRecheckRule());  // Priority 40
  }

  /**
   * Dynamically register a new compliance rule without modifying core engine logic.
   */
  public registerRule(rule: IAuthorityRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * Remove a rule by ID
   */
  public unregisterRule(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  /**
   * Get all currently active rules sorted by ascending priority
   */
  public getActiveRules(): IAuthorityRule[] {
    return Array.from(this.rules.values()).sort((a, b) => a.priority - b.priority);
  }

  /**
   * Evaluates all registered rules against the provided opportunity context.
   */
  public evaluate(context: AuthorityRuleContext): RuleEngineEvaluationResult {
    const sortedRules = this.getActiveRules();
    const checks: AuthorityCheck[] = [];

    let highestSeverityVerdict: AuthorityVerdict = 'AUTHORIZED';
    let targetStatus: OpportunityStatus = 'authorized';
    let summaryReason = 'all deterministic compliance checks passed';

    for (const rule of sortedRules) {
      const result: AuthorityRuleResult = rule.evaluate(context);

      checks.push({
        opportunity_id: context.opportunity.id,
        check_name: rule.id,
        passed: result.passed,
        reason: result.reason,
      });

      if (!result.passed) {
        // Hierarchy of failure severity: BLOCKED > ABSTAIN > WAIT
        if (result.suggestedVerdictOnFailure === 'BLOCKED') {
          highestSeverityVerdict = 'BLOCKED';
          targetStatus = result.suggestedStatusOnFailure;
          summaryReason = result.reason;
          if (rule.isBlocking) {
            // Immediate short-circuit for high-priority security blocks if desired,
            // or continue to record full audit checks. Here we continue to complete the durable audit trail.
          }
        } else if (result.suggestedVerdictOnFailure === 'ABSTAIN' && highestSeverityVerdict !== 'BLOCKED') {
          highestSeverityVerdict = 'ABSTAIN';
          targetStatus = result.suggestedStatusOnFailure;
          summaryReason = result.reason;
        } else if (result.suggestedVerdictOnFailure === 'WAIT' && highestSeverityVerdict === 'AUTHORIZED') {
          highestSeverityVerdict = 'WAIT';
          targetStatus = result.suggestedStatusOnFailure;
          summaryReason = result.reason;
        }
      }
    }

    return {
      verdict: highestSeverityVerdict,
      checks,
      suggestedStatus: targetStatus,
      summaryReason,
    };
  }
}
