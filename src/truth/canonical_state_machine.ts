/**
 * Canonical Payment & Recovery Lifecycle State Machine
 * 
 * Invariant Hierarchy:
 * PROVIDER TRUTH > RECONCILIATION > LOCAL FINANCIAL STATE
 * 
 * Strict Progression:
 * OPPORTUNITY_CREATED -> ECONOMICALLY_ELIGIBLE -> MARKET_ALLOCATED -> AUTHORITY_APPROVED
 *  -> EXECUTION_STARTED -> PROVIDER_OBJECT_CREATED -> PAYMENT_PENDING
 *  -> [PAID -> RECOVERED] OR [NOT_PAID -> FAILED / EXPIRED / PENDING]
 */

export type CanonicalPaymentState =
  | 'PENDING'
  | 'SCORED'
  | 'ALLOCATED'
  | 'AUTHORIZED'
  | 'DEFERRED'
  | 'BLOCKED'
  | 'ABSTAINED'
  | 'EXECUTING'
  | 'PROVIDER_OBJECT_CREATED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_CONFIRMED'
  | 'RECOVERED'
  | 'FAILED'
  | 'NOT_RECOVERED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'ABORTED'
  | 'MISMATCH'
  | 'UNKNOWN';

export type RazorpayLinkStatus =
  | 'created'
  | 'issued'
  | 'partially_paid'
  | 'paid'
  | 'captured'
  | 'cancelled'
  | 'expired'
  | 'failed'
  | string;

export interface RazorpayStateMappingResult {
  canonical_state: CanonicalPaymentState;
  is_terminal: boolean;
  is_settled: boolean;
  requires_reconciliation: boolean;
  rationale: string;
}

export class CanonicalStateMachine {
  /**
   * Maps raw Razorpay status and amount paid to the canonical state.
   * INVARIANT: LINK_CREATED != RECOVERED.
   * Only status='paid'/'captured' with amount_paid > 0 maps to PAYMENT_CONFIRMED / RECOVERED.
   */
  public static mapRazorpayStatusToCanonicalState(params: {
    status: RazorpayLinkStatus;
    amount_paise: number;
    amount_paid_paise: number;
  }): RazorpayStateMappingResult {
    const rawStatus = (params.status || 'unknown').toLowerCase();
    const amount = Number(params.amount_paise) || 0;
    const amountPaid = Number(params.amount_paid_paise) || 0;

    // 1. Confirmed Paid
    if ((rawStatus === 'paid' || rawStatus === 'captured') && amountPaid > 0) {
      if (amount > 0 && amountPaid < amount) {
        return {
          canonical_state: 'MISMATCH',
          is_terminal: false,
          is_settled: false,
          requires_reconciliation: true,
          rationale: `Partial payment detected (Paid: ₹${(amountPaid / 100).toFixed(2)} vs Total: ₹${(amount / 100).toFixed(2)}). Quarantined as MISMATCH.`,
        };
      }
      return {
        canonical_state: 'PAYMENT_CONFIRMED',
        is_terminal: true,
        is_settled: true,
        requires_reconciliation: true,
        rationale: `Provider confirmed successful payment settlement (Status: '${rawStatus}', Paid: ₹${(amountPaid / 100).toFixed(2)}).`,
      };
    }

    if (rawStatus === 'partially_paid' && amountPaid > 0) {
      return {
        canonical_state: 'MISMATCH',
        is_terminal: false,
        is_settled: false,
        requires_reconciliation: true,
        rationale: `Partial payment detected (Paid: ₹${(amountPaid / 100).toFixed(2)} vs Total: ₹${(amount / 100).toFixed(2)}). Quarantined as MISMATCH.`,
      };
    }

    // 2. Created / Issued / Payment Pending / Simulated Fallback
    if (rawStatus === 'created' || rawStatus === 'issued' || rawStatus === 'simulated' || (rawStatus === 'partially_paid' && amountPaid === 0)) {
      return {
        canonical_state: 'PROVIDER_OBJECT_CREATED',
        is_terminal: false,
        is_settled: false,
        requires_reconciliation: false,
        rationale: `Payment link created in provider system (Status: '${rawStatus}', Paid: ₹0.00). Invariant: LINK_CREATED != RECOVERED.`,
      };
    }

    // 3. Expired / Cancelled
    if (rawStatus === 'expired') {
      return {
        canonical_state: 'EXPIRED',
        is_terminal: true,
        is_settled: false,
        requires_reconciliation: true,
        rationale: 'Payment link expired without payment.',
      };
    }
    if (rawStatus === 'cancelled') {
      return {
        canonical_state: 'CANCELLED',
        is_terminal: true,
        is_settled: false,
        requires_reconciliation: true,
        rationale: 'Payment link was cancelled by merchant/system.',
      };
    }

    // 4. Failed
    if (rawStatus === 'failed') {
      return {
        canonical_state: 'FAILED',
        is_terminal: true,
        is_settled: false,
        requires_reconciliation: true,
        rationale: 'Payment link execution failed at provider.',
      };
    }

    // 5. Unknown / Quarantined
    return {
      canonical_state: 'UNKNOWN',
      is_terminal: false,
      is_settled: false,
      requires_reconciliation: true,
      rationale: `Unrecognized or ambiguous provider status: '${rawStatus}'. Quarantined as UNKNOWN.`,
    };
  }

  /**
   * Validates if a state transition is legal in the canonical lifecycle.
   */
  public static isValidTransition(from: CanonicalPaymentState, to: CanonicalPaymentState): boolean {
    if (from === to) return true;

    const allowedTransitions: Record<CanonicalPaymentState, CanonicalPaymentState[]> = {
      PENDING: ['SCORED', 'ABSTAINED', 'DEFERRED', 'BLOCKED'],
      SCORED: ['ALLOCATED', 'DEFERRED', 'ABSTAINED', 'BLOCKED'],
      ALLOCATED: ['AUTHORIZED', 'DEFERRED', 'BLOCKED'],
      AUTHORIZED: ['EXECUTING', 'BLOCKED', 'ABORTED'],
      DEFERRED: ['SCORED', 'ALLOCATED', 'AUTHORIZED'], // Re-evaluation
      BLOCKED: ['ABORTED'],
      ABSTAINED: ['SCORED', 'DEFERRED'],
      EXECUTING: ['PROVIDER_OBJECT_CREATED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'RECOVERED', 'FAILED', 'NOT_RECOVERED', 'EXPIRED', 'CANCELLED', 'MISMATCH', 'UNKNOWN', 'ABORTED'],
      PROVIDER_OBJECT_CREATED: ['PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'RECOVERED', 'FAILED', 'NOT_RECOVERED', 'EXPIRED', 'CANCELLED', 'MISMATCH', 'UNKNOWN'],
      PAYMENT_PENDING: ['PAYMENT_CONFIRMED', 'RECOVERED', 'FAILED', 'NOT_RECOVERED', 'EXPIRED', 'CANCELLED', 'MISMATCH', 'UNKNOWN'],
      PAYMENT_CONFIRMED: ['RECOVERED'],
      RECOVERED: [], // Terminal
      FAILED: ['PAYMENT_CONFIRMED', 'RECOVERED'], // Out-of-order later settlement allowed if fresh valid provider evidence arrives
      NOT_RECOVERED: ['PAYMENT_CONFIRMED', 'RECOVERED'],
      EXPIRED: [],
      CANCELLED: [],
      ABORTED: [],
      MISMATCH: ['RECOVERED', 'FAILED', 'NOT_RECOVERED'],
      UNKNOWN: ['PAYMENT_CONFIRMED', 'RECOVERED', 'FAILED', 'NOT_RECOVERED', 'EXPIRED', 'CANCELLED'],
    };

    const allowed = allowedTransitions[from] || [];
    return allowed.includes(to);
  }
}
