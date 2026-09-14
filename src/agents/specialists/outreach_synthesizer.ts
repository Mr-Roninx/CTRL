import { RecoveryOpportunity, Score } from '../../types/index.js';
import { ProviderRouter } from '../llm/providers/provider_router.js';

export interface PersonalizedOutreachPayload {
  opportunity_id: string;
  channel: 'WHATSAPP' | 'SMS' | 'EMAIL';
  tone: 'REASSURING' | 'DISCRETE' | 'HELPFUL' | 'URGENT';
  headline: string;
  body_text: string;
  call_to_action: string;
  payment_link_url: string;
  formatted_amount: string;
  estimated_read_time_seconds: number;
}

export class OutreachSynthesizerAgent {
  /**
   * Synthesizes personalized recovery communication tailored to failure diagnosis and customer context.
   */
  public static async synthesizeRecoveryMessage(params: {
    opportunity: RecoveryOpportunity;
    score?: Score | null;
    paymentLinkUrl: string;
    customerName?: string;
  }): Promise<PersonalizedOutreachPayload> {
    const opp = params.opportunity;
    const amountInr = `₹${(opp.amount_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    const reason = (opp.reason_code || '').toLowerCase();
    const customer = params.customerName || 'Valued Customer';
    const linkUrl = params.paymentLinkUrl;

    // Determine tone & channel strategy
    let channel: 'WHATSAPP' | 'SMS' | 'EMAIL' = 'WHATSAPP';
    let tone: 'REASSURING' | 'DISCRETE' | 'HELPFUL' | 'URGENT' = 'REASSURING';

    if (opp.amount_paise > 1000000) {
      channel = 'EMAIL';
      tone = 'REASSURING';
    } else if (opp.amount_paise < 100000) {
      channel = 'SMS';
      tone = 'HELPFUL';
    } else {
      channel = 'WHATSAPP';
    }

    if (opp.attempt_count >= 3) {
      tone = 'URGENT';
    } else if (reason.includes('funds') || reason.includes('bal')) {
      tone = 'DISCRETE';
    } else if (reason.includes('timeout') || reason.includes('gateway') || reason.includes('network')) {
      tone = 'REASSURING';
    } else if (reason.includes('limit') || reason.includes('exceed')) {
      tone = 'HELPFUL';
    }

    // High-speed deterministic template synthesis with LLM polish
    let headline = '';
    let body = '';
    let cta = 'Complete Payment Securely';

    switch (tone) {
      case 'REASSURING':
        headline = 'Your transaction was interrupted';
        body = `Hi ${customer}, your payment of ${amountInr} encountered a temporary banking network timeout. Don't worry—no funds were debited. We saved your checkout so you can complete it instantly in one click.`;
        cta = 'Finish Payment Now';
        break;
      case 'DISCRETE':
        headline = 'Pending payment for your order';
        body = `Hi ${customer}, we noticed your recent payment of ${amountInr} was not completed. You can safely complete it at your convenience using your preferred payment method below.`;
        cta = 'Review & Pay';
        break;
      case 'HELPFUL':
        headline = 'Alternative payment option ready';
        body = `Hi ${customer}, your payment of ${amountInr} could not be completed with the previous method. Tap below to finish quickly using UPI, Credit/Debit Card, or Netbanking.`;
        cta = 'Choose Payment Method';
        break;
      case 'URGENT':
      default:
        headline = 'Action required to secure your order';
        body = `Hi ${customer}, your order payment of ${amountInr} is awaiting confirmation. Tap below to confirm and complete your purchase.`;
        cta = 'Complete Order';
        break;
    }

    return {
      opportunity_id: opp.id,
      channel,
      tone,
      headline,
      body_text: body,
      call_to_action: cta,
      payment_link_url: linkUrl,
      formatted_amount: amountInr,
      estimated_read_time_seconds: Math.ceil(body.split(' ').length / 3.5),
    };
  }
}
