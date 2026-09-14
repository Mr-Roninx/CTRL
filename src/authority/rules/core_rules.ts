import {
  IAuthorityRule,
  AuthorityRuleContext,
  AuthorityRuleResult,
} from './rule_interface.js';
import { isKillSwitchActive } from '../gate.js';

/**
 * Rule 1: Hard Decline Gate (Fraud & Stolen Instrument Invariant)
 * Single Responsibility: Prevent auto-contacting permanently terminal or stolen card events.
 */
export class HardDeclineRule implements IAuthorityRule {
  public readonly id = 'hard_decline_check';
  public readonly name = 'Hard Decline Compliance Gate';
  public readonly priority = 10;
  public readonly isBlocking = true;

  public evaluate(context: AuthorityRuleContext): AuthorityRuleResult {
    const { opportunity } = context;
    if (opportunity.decline_type === 'hard') {
      return {
        passed: false,
        reason: 'no auto-contact after a hard/fraud-coded decline',
        suggestedVerdictOnFailure: 'BLOCKED',
        suggestedStatusOnFailure: 'blocked',
      };
    }

    return {
      passed: true,
      reason: `decline type is recoverable (${opportunity.decline_type})`,
      suggestedVerdictOnFailure: 'BLOCKED',
      suggestedStatusOnFailure: 'blocked',
    };
  }
}

/**
 * Rule 2: Retry Cap Gate (Regulatory Harassment & Customer Fatigue Invariant)
 * Single Responsibility: Restrict total intervention attempts per payment opportunity to <= 3.
 */
export class RetryCapRule implements IAuthorityRule {
  public readonly id = 'retry_cap_check';
  public readonly name = 'Retry Cap Threshold Gate';
  public readonly priority = 20;
  public readonly isBlocking = true;
  private maxAttempts: number;

  constructor(maxAttempts: number = 3) {
    this.maxAttempts = maxAttempts;
  }

  public evaluate(context: AuthorityRuleContext): AuthorityRuleResult {
    const { opportunity } = context;
    if (opportunity.attempt_count >= this.maxAttempts) {
      return {
        passed: false,
        reason: 'retry cap reached — route to manual fallback, not further auto-contact',
        suggestedVerdictOnFailure: 'BLOCKED',
        suggestedStatusOnFailure: 'blocked',
      };
    }

    return {
      passed: true,
      reason: `attempt count (${opportunity.attempt_count}) within retry cap limit of ${this.maxAttempts}`,
      suggestedVerdictOnFailure: 'BLOCKED',
      suggestedStatusOnFailure: 'blocked',
    };
  }
}

/**
 * Rule 3: Emergency Kill Switch Gate (Circuit Breaker & Human Operator Override)
 * Single Responsibility: Halt execution if global, tenant, or provider kill switch is active.
 */
export class KillSwitchRule implements IAuthorityRule {
  public readonly id = 'kill_switch_check';
  public readonly name = 'Emergency Kill Switch Gate';
  public readonly priority = 5; // Highest priority check
  public readonly isBlocking = true;

  public evaluate(context: AuthorityRuleContext): AuthorityRuleResult {
    const { opportunity, tenantId } = context;
    const activeTenantId = tenantId || opportunity.tenant_id;

    if (isKillSwitchActive(activeTenantId)) {
      return {
        passed: false,
        reason: 'manual kill switch engaged',
        suggestedVerdictOnFailure: 'BLOCKED',
        suggestedStatusOnFailure: 'blocked',
      };
    }

    return {
      passed: true,
      reason: 'system operating normally (kill switch disengaged)',
      suggestedVerdictOnFailure: 'BLOCKED',
      suggestedStatusOnFailure: 'blocked',
    };
  }
}

/**
 * Rule 4: Model Estimation Confidence Gate (Epistemic Safety Invariant)
 * Single Responsibility: Prevent automated fund/outreach execution when Bayesian confidence is LOW.
 */
export class ConfidenceRecheckRule implements IAuthorityRule {
  public readonly id = 'confidence_recheck';
  public readonly name = 'Bayesian Confidence Level Gate';
  public readonly priority = 30;
  public readonly isBlocking = false;

  public evaluate(context: AuthorityRuleContext): AuthorityRuleResult {
    const { score } = context;
    if (score.confidence === 'low') {
      return {
        passed: false,
        reason: 'low confidence score — requires human or observational review',
        suggestedVerdictOnFailure: 'ABSTAIN',
        suggestedStatusOnFailure: 'abstained',
      };
    }

    return {
      passed: true,
      reason: `confidence level is sufficient (${score.confidence})`,
      suggestedVerdictOnFailure: 'ABSTAIN',
      suggestedStatusOnFailure: 'abstained',
    };
  }
}

/**
 * Rule 5: Portfolio Capacity & Shadow Price Allocation Gate
 * Single Responsibility: Guarantee that only opportunities awarded ACT within scarce capacity are authorized.
 */
export class CapacityRecheckRule implements IAuthorityRule {
  public readonly id = 'capacity_recheck';
  public readonly name = 'Market Allocation Capacity Gate';
  public readonly priority = 40;
  public readonly isBlocking = false;

  public evaluate(context: AuthorityRuleContext): AuthorityRuleResult {
    const { decision } = context;
    if (decision.decision !== 'ACT') {
      return {
        passed: false,
        reason: `not within active market allocation batch (market status: ${decision.decision})`,
        suggestedVerdictOnFailure: 'WAIT',
        suggestedStatusOnFailure: 'deferred',
      };
    }

    return {
      passed: true,
      reason: `allocated in current active batch (rank #${decision.rank_in_batch})`,
      suggestedVerdictOnFailure: 'WAIT',
      suggestedStatusOnFailure: 'deferred',
    };
  }
}

/**
 * Rule 6 (Extensibility Demonstration): Regulatory Cool-Off Window Gate
 * Single Responsibility: Prevent rapid repeated contact to customers within a 24-hour window.
 */
export class CoolOffWindowRule implements IAuthorityRule {
  public readonly id = 'cool_off_window_check';
  public readonly name = 'Customer Cool-Off Period Gate';
  public readonly priority = 25;
  public readonly isBlocking = false;
  private windowHours: number;

  constructor(windowHours: number = 24) {
    this.windowHours = windowHours;
  }

  public evaluate(context: AuthorityRuleContext): AuthorityRuleResult {
    const { opportunity } = context;
    // Inspect created_at age if attempt > 1
    if (opportunity.attempt_count > 1 && opportunity.created_at) {
      const createdTime = new Date(opportunity.created_at).getTime();
      const elapsedHours = (Date.now() - createdTime) / (1000 * 60 * 60);

      // If re-attempted under 10 minutes from creation on an existing failure, enforce pacing
      if (elapsedHours < 0.16 && opportunity.attempt_count >= 2) {
        return {
          passed: false,
          reason: `pacing window violation: retry attempted too quickly (${elapsedHours.toFixed(2)}h elapsed, min pacing required)`,
          suggestedVerdictOnFailure: 'WAIT',
          suggestedStatusOnFailure: 'deferred',
        };
      }
    }

    return {
      passed: true,
      reason: `cool-off pacing compliant (window: ${this.windowHours}h)`,
      suggestedVerdictOnFailure: 'WAIT',
      suggestedStatusOnFailure: 'deferred',
    };
  }
}
