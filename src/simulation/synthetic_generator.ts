import crypto from 'node:crypto';
import { RecoveryOpportunity } from '../types/index.js';
import { CanonicalPaymentEventSchema } from '../security/schemas.js';

export interface SyntheticGeneratorOptions {
  seed?: number;
  tenantId?: string;
  defaultCurrency?: string;
}

export interface SyntheticBatchConfig {
  count: number;
  distribution?: {
    insufficient_funds?: number;
    expired_card?: number;
    gateway_timeout?: number;
    generic_decline?: number;
    hard_decline?: number;
  };
  minAmountPaise?: number;
  maxAmountPaise?: number;
}

export class SyntheticDataGenerator {
  private tenantId: string;
  private currency: string;

  constructor(options: SyntheticGeneratorOptions = {}) {
    this.tenantId = options.tenantId || 'tenant_synth_default';
    this.currency = options.defaultCurrency || 'INR';
  }

  /**
   * Generates a single canonical synthetic payment failure event.
   */
  public generateFailureEvent(overrides: Record<string, any> = {}): any {
    const timestamp = overrides.timestamp || overrides.occurred_at || new Date().toISOString();
    const eventId = overrides.event_id || `evt_synth_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const paymentId = overrides.payment_id || `pay_synth_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const orderId = overrides.order_id || `ord_synth_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const customerId = overrides.customer_reference || overrides.customer_id || `cust_synth_${crypto.randomBytes(3).toString('hex')}@example.com`;

    const failureReasons = [
      { code: 'bad_request_payment_card_expired', desc: 'The card has expired.', declineType: 'soft' as const },
      { code: 'payment_failed_insufficient_funds', desc: 'Insufficient funds in account.', declineType: 'soft' as const },
      { code: 'bank_gateway_timeout', desc: 'Issuer bank did not respond within timeout.', declineType: 'soft' as const },
      { code: 'generic_decline', desc: 'Transaction declined by customer bank.', declineType: 'soft' as const },
      { code: 'card_reported_lost_or_stolen', desc: 'Card reported stolen or fraudulent.', declineType: 'hard' as const },
    ];

    const defaultReason = failureReasons[0]!;
    const selectedReason = failureReasons[Math.floor(Math.random() * failureReasons.length)] ?? defaultReason;
    const amountPaise = overrides.amount_paise || Math.floor(Math.random() * (500000 - 50000) + 50000); // ₹500 to ₹5000

    const rawEvent = {
      event_id: eventId,
      tenant_id: overrides.tenant_id || this.tenantId,
      source: 'SYNTHETIC_SIMULATION' as const,
      provider: overrides.provider || 'razorpay',
      environment: overrides.environment || 'test',
      payment_id: paymentId,
      order_id: orderId,
      amount_paise: amountPaise,
      currency: overrides.currency || this.currency,
      status: 'failed' as const,
      failure_code: overrides.failure_code || overrides.error_code || selectedReason.code,
      failure_description: overrides.failure_description || overrides.error_description || selectedReason.desc,
      failure_type: overrides.failure_type || overrides.decline_type || selectedReason.declineType,
      attempt_number: overrides.attempt_number || overrides.attempt_count || 1,
      customer_reference: customerId,
      customer_email: customerId.includes('@') ? customerId : 'customer@example.com',
      customer_phone: '+919876543210',
      occurred_at: timestamp,
      received_at: timestamp,
      correlation_id: overrides.correlation_id || `corr_synth_${Date.now()}`,
      metadata: {
        simulation_batch: true,
        generated_at: timestamp,
        ...(overrides.metadata || {}),
      },
    };

    // Validate strictly against Zod Canonical schema
    return CanonicalPaymentEventSchema.parse(rawEvent);
  }

  /**
   * Generates a batch of synthetic opportunities.
   */
  public generateOpportunityBatch(config: SyntheticBatchConfig): RecoveryOpportunity[] {
    const opps: RecoveryOpportunity[] = [];

    for (let i = 0; i < config.count; i++) {
      const min = config.minAmountPaise || 50000;
      const max = config.maxAmountPaise || 1000000;
      const amount = Math.floor(Math.random() * (max - min) + min);

      const evt = this.generateFailureEvent({
        amount_paise: amount,
        attempt_number: Math.floor(Math.random() * 2) + 1, // Attempt 1 or 2
      });

      opps.push({
        id: `opp_${evt.payment_id}`,
        source: 'synthetic',
        amount_paise: evt.amount_paise,
        currency: evt.currency,
        reason_code: evt.failure_code || 'generic_decline',
        decline_type: evt.failure_type || 'soft',
        attempt_count: evt.attempt_number,
        customer_id: evt.customer_reference,
        customer_trust_score: Math.floor(Math.random() * 50) + 50, // 50-99
        created_at: evt.occurred_at,
        status: 'pending',
        tenant_id: 'tenant_system_default',
        environment: 'test',
      });
    }

    return opps;
  }
}
