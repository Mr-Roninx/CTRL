import { OpportunityStatus, RecoveryOpportunity } from '../types/index.js';

export class IllegalStateTransitionError extends Error {
  constructor(
    public readonly opportunityId: string,
    public readonly currentStatus: OpportunityStatus,
    public readonly targetStatus: OpportunityStatus,
    message?: string
  ) {
    super(
      message ||
        `Illegal opportunity state transition attempted for ${opportunityId}: '${currentStatus}' -> '${targetStatus}'. State machine invariant violated.`
    );
    this.name = 'IllegalStateTransitionError';
  }
}

/**
 * Valid state transition graph enforcing deterministic lifecycle invariants.
 * Core Invariants:
 * 1. Terminal states (recovered) cannot transition out.
 * 2. Security vetoes (blocked) are strictly terminal.
 * 3. Raw un-evaluated opportunities cannot jump directly to execution.
 */
const ALLOWED_TRANSITIONS: Record<OpportunityStatus, OpportunityStatus[]> = {
  pending: ['scored', 'allocated', 'blocked', 'abstained'],
  scored: ['allocated', 'scored', 'blocked', 'abstained', 'deferred'],
  allocated: ['authorized', 'deferred', 'blocked', 'abstained', 'executing'],
  authorized: ['executing', 'blocked', 'abstained'],
  deferred: ['allocated', 'scored', 'blocked', 'abstained', 'authorized'],
  blocked: [], // Terminal compliance veto
  abstained: ['scored', 'allocated'], // Can re-enter scoring if new telemetry arrives
  executing: ['recovered', 'not_recovered'],
  recovered: [], // Terminal financial settlement
  not_recovered: ['scored', 'allocated'], // Can re-enter retry pipeline if within policy limits
};

/**
 * Finite State Machine (FSM) pattern for RecoveryOpportunity lifecycle.
 * Protects mathematical and regulatory invariants against rogue mutations.
 */
export class OpportunityStateMachine {
  /**
   * Verifies if a given transition from current to target is valid.
   */
  public static canTransition(current: OpportunityStatus, target: OpportunityStatus): boolean {
    if (current === target) return true; // Idempotent no-op transition
    const allowed = ALLOWED_TRANSITIONS[current] || [];
    return allowed.includes(target);
  }

  /**
   * Validates transition and returns target status, or throws IllegalStateTransitionError.
   */
  public static validateTransition(
    opportunityId: string,
    current: OpportunityStatus,
    target: OpportunityStatus
  ): OpportunityStatus {
    if (!this.canTransition(current, target)) {
      throw new IllegalStateTransitionError(opportunityId, current, target);
    }
    return target;
  }

  /**
   * Safe transition helper that returns a Result object without throwing.
   */
  public static tryTransition(
    opportunity: RecoveryOpportunity,
    targetStatus: OpportunityStatus
  ): { success: boolean; error?: string } {
    if (!this.canTransition(opportunity.status, targetStatus)) {
      return {
        success: false,
        error: `Cannot transition opportunity ${opportunity.id} from '${opportunity.status}' to '${targetStatus}'.`,
      };
    }
    return { success: true };
  }
}
