export type EvidenceClass =
  | 'CODE_ONLY'
  | 'UNIT_TEST_VERIFIED'
  | 'INTEGRATION_VERIFIED'
  | 'SYNTHETIC_VERIFIED'
  | 'SYNTHETIC'
  | 'RAZORPAY_TEST'
  | 'FIXTURE'
  | 'RAZORPAY_TEST_VERIFIED'
  | 'PROVIDER_VERIFIED'
  | 'PARTIAL'
  | 'UNVERIFIED';

export type ProviderEvidenceState =
  | 'LINK_CREATED'
  | 'PROVIDER_OBJECT_VERIFIED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_CONFIRMED'
  | 'PROVIDER_RECOVERY_VERIFIED'
  | 'PAYMENT_FAILED'
  | 'EXPIRED';

export interface ProviderTruthEvaluation {
  payment_link_id: string;
  provider_status: string;
  amount_paise: number;
  amount_paid_paise: number;
  payment_id: string | null;
  evidence_state: ProviderEvidenceState;
  evidence_class: EvidenceClass;
  payment_confirmed: boolean;
  is_recovered: boolean;
  reconciliation_status: 'CONFIRMED' | 'PENDING' | 'RECONCILIATION_MISMATCH';
  rationale: string;
  verified_at: string;
}

export class ProviderTruthEvaluator {
  /**
   * Evaluates raw provider payload from Razorpay SDK/API to determine exact truth state.
   * INVARIANT: LINK_CREATED != RECOVERED.
   * A recovery is ONLY confirmed if provider status is 'paid'/'captured' AND amount_paid > 0.
   */
  public static evaluate(payload: {
    id: string;
    status?: string;
    amount?: number;
    amount_paid?: number;
    payments?: Array<{ id: string; status: string; amount: number }>;
    source_env?: 'RAZORPAY_TEST' | 'SYNTHETIC' | 'FIXTURE';
  }): ProviderTruthEvaluation {
    const status = (payload.status || 'unknown').toLowerCase();
    const amount = payload.amount || 0;
    const amountPaid = payload.amount_paid || 0;
    const sourceEnv = payload.source_env || 'RAZORPAY_TEST';
    const now = new Date().toISOString();

    const paymentId = payload.payments?.[0]?.id ?? null;

    // Case 1: Provider confirms payment completed with non-zero amount paid
    if ((status === 'paid' || status === 'captured') && amountPaid > 0) {
      return {
        payment_link_id: payload.id,
        provider_status: status,
        amount_paise: amount,
        amount_paid_paise: amountPaid,
        payment_id: paymentId,
        evidence_state: 'PROVIDER_RECOVERY_VERIFIED',
        evidence_class: sourceEnv === 'RAZORPAY_TEST' ? 'RAZORPAY_TEST_VERIFIED' : sourceEnv,
        payment_confirmed: true,
        is_recovered: true,
        reconciliation_status: 'CONFIRMED',
        rationale: `Provider confirmed successful payment (Status: ${status}, Amount Paid: ₹${(amountPaid / 100).toFixed(2)}).`,
        verified_at: now,
      };
    }

    // Case 2: Link exists and verified in provider system, but payment has not completed yet
    if (status === 'created' || status === 'issued' || status === 'simulated' || (status === 'partially_paid' && amountPaid === 0)) {
      return {
        payment_link_id: payload.id,
        provider_status: status,
        amount_paise: amount,
        amount_paid_paise: amountPaid,
        payment_id: paymentId,
        evidence_state: 'PROVIDER_OBJECT_VERIFIED',
        evidence_class: status === 'simulated' ? 'SYNTHETIC' : (sourceEnv === 'RAZORPAY_TEST' ? 'RAZORPAY_TEST' : sourceEnv),
        payment_confirmed: false,
        is_recovered: false,
        reconciliation_status: 'PENDING',
        rationale: `Provider object queried successfully (Status: ${status}), but payment is NOT confirmed (Amount Paid: ₹${(amountPaid / 100).toFixed(2)}). Invariant: LINK_CREATED != RECOVERED.`,
        verified_at: now,
      };
    }

    // Case 2b: Partial payment detected
    if (status === 'partially_paid' && amountPaid > 0) {
      return {
        payment_link_id: payload.id,
        provider_status: status,
        amount_paise: amount,
        amount_paid_paise: amountPaid,
        payment_id: paymentId,
        evidence_state: 'PROVIDER_OBJECT_VERIFIED',
        evidence_class: 'PARTIAL',
        payment_confirmed: false,
        is_recovered: false,
        reconciliation_status: 'RECONCILIATION_MISMATCH',
        rationale: `Partial payment detected (Paid: ₹${(amountPaid / 100).toFixed(2)} vs Total: ₹${(amount / 100).toFixed(2)}). Quarantined as MISMATCH.`,
        verified_at: now,
      };
    }

    // Case 3: Link expired or cancelled
    if (status === 'expired' || status === 'cancelled') {
      return {
        payment_link_id: payload.id,
        provider_status: status,
        amount_paise: amount,
        amount_paid_paise: amountPaid,
        payment_id: paymentId,
        evidence_state: 'EXPIRED',
        evidence_class: sourceEnv === 'RAZORPAY_TEST' ? 'RAZORPAY_TEST' : sourceEnv,
        payment_confirmed: false,
        is_recovered: false,
        reconciliation_status: 'CONFIRMED',
        rationale: `Provider link expired or cancelled without payment.`,
        verified_at: now,
      };
    }

    // Case 4: Ambiguous or unverified status
    return {
      payment_link_id: payload.id,
      provider_status: status,
      amount_paise: amount,
      amount_paid_paise: amountPaid,
      payment_id: paymentId,
      evidence_state: 'PAYMENT_PENDING',
      evidence_class: 'UNVERIFIED',
      payment_confirmed: false,
      is_recovered: false,
      reconciliation_status: 'PENDING',
      rationale: `Provider status '${status}' does not confirm completed payment.`,
      verified_at: now,
    };
  }
}
