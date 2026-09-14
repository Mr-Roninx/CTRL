import { DeclineType, RecoveryOpportunity } from '../types/index.js';
import { getOrCreateCustomer, countPriorAttempts } from '../db/database.js';

/**
 * Perception taxonomy definitions
 * 
 * hard: irreversible issuer blocks (stolen, lost, pickup, restricted)
 * soft: recoverable conditions (insufficient funds, expired card renewal, timeout, generic bank retry, do not honor)
 * unknown: unrecognized codes (must not crash the pipeline)
 */
export const HARD_DECLINE_PATTERNS = [
  'stolen_card',
  'lost_card',
  'pickup_card',
  'pick_up_card',
  'restricted_card',
  'card_stolen_lost',
  'card_stolen',
  'card_lost',
  'card_pickup',
  'card_restricted',
  'bad_request_payment_card_stolen_or_lost',
  'bad_request_payment_card_pick_up',
  'bad_request_payment_card_restricted',
  // NPCI / Indian Banking Hard Declines
  'invalid_vpa',
  'vpa_not_found',
  'account_blocked',
  'account_frozen',
  'npci_xb',
];

export const SOFT_DECLINE_PATTERNS = [
  'insufficient_funds',
  'expired_card',
  'card_expired',
  'generic_decline',
  'do_not_honor',
  'bank_gateway_timeout',
  'gateway_timeout',
  'network_timeout',
  'bank_network_timeout',
  'gateway_error',
  'payment_authentication_failed',
  'transaction_not_permitted',
  'limit_exceeded',
  'otp_timeout',
  'card_inactive',
  'temporarily_unavailable',
  'bad_request_payment_insufficient_funds',
  'bad_request_payment_card_expired',
  'bad_request_payment_declined_by_bank',
  'bad_request_payment_do_not_honor',
  'bad_request_payment_authentication_failed',
  // NPCI / Indian Banking Soft Declines (UPI & Netbanking)
  'npci_u30',
  'transaction_limit_exceeded',
  'npci_u69',
  'collect_request_expired',
  'npci_za',
  'payment_cancelled_by_user',
  'invalid_mpin',
  'npci_zm',
  'npci_zh',
  'user_dropped',
];

/**
 * Classifies error code and reason into deterministic decline_type
 */
export function classifyDeclineTaxonomy(errorCode?: string | null, errorReason?: string | null): DeclineType {
  const code = (errorCode || '').trim().toLowerCase();
  const reason = (errorReason || '').trim().toLowerCase();
  const combined = `${code} ${reason}`.trim();

  if (!combined) {
    return 'unknown';
  }

  // 1. Check Hard Declines
  for (const pattern of HARD_DECLINE_PATTERNS) {
    if (code.includes(pattern) || reason.includes(pattern)) {
      return 'hard';
    }
  }

  // 2. Check Soft Declines
  for (const pattern of SOFT_DECLINE_PATTERNS) {
    if (code.includes(pattern) || reason.includes(pattern)) {
      return 'soft';
    }
  }

  // Check general timeout/bank/funds keywords for soft
  if (
    combined.includes('insufficient') ||
    combined.includes('timeout') ||
    combined.includes('network') ||
    combined.includes('expired') ||
    combined.includes('do_not_honor') ||
    combined.includes('honor') ||
    combined.includes('authentication') ||
    combined.includes('temporary')
  ) {
    return 'soft';
  }

  // 3. Fallback: Unknown without throwing
  return 'unknown';
}

export interface RawPaymentPayload {
  id?: string;
  amount?: number | string;
  currency?: string;
  error_code?: string;
  error_reason?: string;
  error_source?: string;
  error_step?: string;
  error_description?: string;
  customer_id?: string;
  email?: string;
  contact?: string;
  attempts?: number;
  order_id?: string;
  notes?: Record<string, any>;
  [key: string]: any;
}

/**
 * Normalizes raw payment webhook entity into standardized fields
 */
export function normalizeOpportunity(
  paymentEntity: RawPaymentPayload,
  eventId?: string | null,
  options: { source?: 'real' | 'synthetic'; tenantId?: string; environment?: 'test' | 'live' } = {}
): RecoveryOpportunity {
  const paymentId = paymentEntity.id || `pay_${Date.now()}`;
  const amountPaise = Number(paymentEntity.amount) || 0;
  const currency = paymentEntity.currency || 'INR';

  const errorCode = paymentEntity.error_code || 'UNKNOWN_ERROR';
  const errorReason = paymentEntity.error_reason || paymentEntity.error_description || 'Payment failed';
  const errorSource = paymentEntity.error_source || 'gateway';
  const errorStep = paymentEntity.error_step || 'payment_authorization';

  // 1. Deterministic Taxonomy Classification
  const declineType = classifyDeclineTaxonomy(errorCode, errorReason);

  // 2. Customer Profile & Trust Score (default 0.65 for new/unseen)
  const customerId =
    paymentEntity.customer_id ||
    paymentEntity.email ||
    paymentEntity.contact ||
    `cust_${paymentId.slice(-8)}`;

  const customer = getOrCreateCustomer(customerId, 0.65);

  // 3. Attempt Count Calculation
  let attemptCount = Number(paymentEntity.attempts);
  if (!attemptCount || isNaN(attemptCount) || attemptCount < 1) {
    // Count prior recorded opportunities for this customer or order/payment reference
    const priorCount = countPriorAttempts(customerId, paymentEntity.order_id || paymentId);
    attemptCount = priorCount + 1;
  }

  const now = new Date().toISOString();

  // NOTE: This 'real' label is only as trustworthy as who has access to the webhook secret in .env — it is not cryptographic proof of Razorpay origin.
  const source = options.source || 'real';

  return {
    id: paymentId,
    source,
    amount_paise: amountPaise,
    currency,
    reason_code: errorCode,
    decline_type: declineType,
    attempt_count: attemptCount,
    customer_id: customer.id,
    customer_trust_score: customer.trust_score,
    created_at: now,
    status: 'pending',
    tenant_id: options.tenantId || 'tenant_default',
    environment: options.environment || 'test',
    razorpay_event_id: eventId || null,
    raw_payload_ref: JSON.stringify({
      error_source: errorSource,
      error_step: errorStep,
      error_reason: errorReason,
      error_code: errorCode,
      order_id: paymentEntity.order_id,
      email: paymentEntity.email,
      contact: paymentEntity.contact,
      notes: paymentEntity.notes,
    }),
  };
}
