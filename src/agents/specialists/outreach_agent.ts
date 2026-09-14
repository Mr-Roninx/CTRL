import { RecoveryOpportunity } from '../../types/index.js';
import { AgentToolRegistry } from '../tool_registry.js';
import { OutreachDraftRecord } from '../types.js';
import { insertOutreachDraft } from '../../db/database.js';
import { FailureReasonDiagnosis } from './perception_agent.js';

export type OutreachTone = 'POLITE_REMINDER' | 'URGENT_ACTION' | 'ASSISTED_SUPPORT';

export interface ReasonTailoredOutreach {
  subject?: string;
  body: string;
  channel: 'SMS' | 'WHATSAPP' | 'EMAIL' | 'CHECKOUT_MODAL';
  paymentLinkUrl: string;
  category: string;
  customerAdvice: string;
}

export class OutreachAgent {
  /**
   * Determine the most effective outreach tone.
   */
  public static determineTone(opp: RecoveryOpportunity): OutreachTone {
    if (opp.attempt_count >= 2) {
      return 'URGENT_ACTION';
    }
    if (opp.reason_code?.includes('NETWORK') || opp.reason_code?.includes('TIMEOUT')) {
      return 'POLITE_REMINDER';
    }
    return 'ASSISTED_SUPPORT';
  }

  /**
   * Generates tailored communication and repay messaging directly addressing
   * the specific failure reason diagnosed by the PerceptionAgent.
   */
  public static generateReasonTailoredMessage(params: {
    opportunity: RecoveryOpportunity;
    diagnosis: FailureReasonDiagnosis;
    paymentLinkUrl: string;
    channel: 'SMS' | 'WHATSAPP' | 'EMAIL' | 'CHECKOUT_MODAL';
    customerName?: string;
    merchantName?: string;
    runId?: string;
  }): ReasonTailoredOutreach {
    const amountInr = `₹${(params.opportunity.amount_paise / 100).toLocaleString('en-IN', {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    })}`;
    const merchant = params.merchantName || 'Our Merchant Store';
    const greeting = params.customerName ? `Hi ${params.customerName},` : 'Hello,';
    const link = params.paymentLinkUrl;
    const cat = params.diagnosis.category;

    let subject: string | undefined = undefined;
    let body = '';
    let advice = params.diagnosis.customer_friendly_explanation;

    if (cat === 'NETWORK_LATENCY') {
      advice = 'Bank switch experienced a momentary timeout during 3D Secure verification. No amount was deducted.';
      if (params.channel === 'WHATSAPP') {
        body = [
          `🔔 *Payment On Hold — Bank Timeout*`,
          ``,
          `${greeting}`,
          `Your payment of *${amountInr}* for *${merchant}* was interrupted due to a temporary network timeout at your bank.`,
          ``,
          `Your order has been *placed on hold* so your items remain reserved. You can complete your transaction securely via UPI (Google Pay, PhonePe, Paytm) or Card:`,
          ``,
          `👉 *Complete Payment Securely:*`,
          `${link}`,
          ``,
          `_Issued via Razorpay Secure Gateway. If you already completed this, you may ignore this notice._`,
        ].join('\n');
      } else if (params.channel === 'EMAIL') {
        subject = `Payment Interrupted: Re-attempt your transaction of ${amountInr}`;
        body = `Dear Customer,\n\nWe noticed your transaction of ${amountInr} for order ${params.opportunity.id} was interrupted by a temporary bank gateway timeout during OTP verification. No funds were charged.\n\nYour order is held for you. Click below to complete your payment with 1-click:\n\n${link}\n\nOur support team is available if you need any assistance.`;
      } else if (params.channel === 'CHECKOUT_MODAL') {
        body = `Bank Gateway Timeout: The issuing bank took too long to confirm 3DS verification. Your order is reserved. Tap below to complete with UPI or an alternate card.`;
      } else {
        // SMS
        body = `Order on hold: Payment of ${amountInr} at ${merchant} timed out at bank. Complete securely via Razorpay: ${link}`;
      }
    } else if (cat === 'INSUFFICIENT_FUNDS') {
      advice = 'Payment declined due to account balance or transaction limit restrictions. Safe to retry with alternate account.';
      if (params.channel === 'WHATSAPP') {
        body = [
          `🔔 *Order Reserved — Payment On Hold*`,
          ``,
          `${greeting}`,
          `Your payment of *${amountInr}* for *${merchant}* could not be processed due to account balance or limit restrictions at your bank.`,
          ``,
          `We have put your order *on hold* for you. You can complete payment whenever convenient using an alternate account, UPI, or card:`,
          ``,
          `👉 *Pay ${amountInr} securely:*`,
          `${link}`,
          ``,
          `_Issued via Razorpay Secure Gateway._`,
        ].join('\n');
      } else if (params.channel === 'EMAIL') {
        subject = `Order On Hold: Complete your payment of ${amountInr}`;
        body = `Dear Customer,\n\nYour payment of ${amountInr} for order ${params.opportunity.id} could not be processed due to account balance or card limit restrictions. Your order has been placed on hold.\n\nYou can safely complete checkout using an alternate account or card here:\n\n${link}\n\nThank you for shopping with ${merchant}.`;
      } else if (params.channel === 'CHECKOUT_MODAL') {
        body = `Order Held: Bank declined due to card limits or balance. Complete securely using alternate UPI or card.`;
      } else {
        body = `Order held: Payment of ${amountInr} at ${merchant} declined by bank. Complete securely with another card/UPI: ${link}`;
      }
    } else if (cat === 'CARD_EXPIRED') {
      advice = 'The card entered has expired or is inactive. Use an active card or UPI to finish payment.';
      if (params.channel === 'WHATSAPP') {
        body = [
          `🔔 *Payment On Hold — Card Expired*`,
          ``,
          `${greeting}`,
          `Your card used for payment of *${amountInr}* at *${merchant}* was reported as expired or inactive by your bank.`,
          ``,
          `Your order is on hold. Please use an active debit/credit card or instant UPI to finish checkout:`,
          ``,
          `👉 *Complete Payment with Active Method:*`,
          `${link}`,
        ].join('\n');
      } else if (params.channel === 'EMAIL') {
        subject = `Action Required: Card expired for order payment of ${amountInr}`;
        body = `Hello,\n\nThe card used for your recent purchase of ${amountInr} was reported as expired or inactive by your card issuer. Your order is reserved on hold.\n\nPlease complete your payment using an active card or UPI here:\n\n${link}`;
      } else if (params.channel === 'CHECKOUT_MODAL') {
        body = `Card Expired: The card used has expired. Tap below to complete checkout with an active card or instant UPI.`;
      } else {
        body = `Card expired for payment of ${amountInr} at ${merchant}. Complete using active card or UPI: ${link}`;
      }
    } else if (cat === 'USER_ABORT') {
      advice = 'Checkout window was closed before completion. 1-click restore available.';
      if (params.channel === 'WHATSAPP') {
        body = [
          `👋 *Your Cart is Saved!*`,
          ``,
          `${greeting}`,
          `We noticed your checkout session for *${amountInr}* at *${merchant}* was interrupted before completion. No funds were charged.`,
          ``,
          `Your cart is saved on hold. Tap here to resume and complete your order with 1-click:`,
          ``,
          `👉 *Resume Order:*`,
          `${link}`,
        ].join('\n');
      } else if (params.channel === 'EMAIL') {
        subject = `Resume your checkout at ${merchant} (${amountInr})`;
        body = `Hello,\n\nYour checkout session of ${amountInr} was interrupted before payment could be confirmed. No money was deducted.\n\nYou can resume your purchase with 1-click here:\n\n${link}`;
      } else if (params.channel === 'CHECKOUT_MODAL') {
        body = `Checkout interrupted: Your order is saved. Tap below to finish your payment.`;
      } else {
        body = `Your cart of ${amountInr} at ${merchant} is saved! Resume your checkout here: ${link}`;
      }
    } else {
      // TECHNICAL_GLITCH / LIMIT_EXCEEDED / General
      advice = params.diagnosis.customer_friendly_explanation;
      if (params.channel === 'WHATSAPP') {
        body = [
          `🔔 *Payment Incomplete Notification*`,
          ``,
          `${greeting}`,
          `Your payment of *${amountInr}* for *${merchant}* could not be processed due to ${params.diagnosis.customer_friendly_explanation.toLowerCase()}`,
          ``,
          `Your order has been held for you. Complete your transaction securely via UPI, NetBanking, or Card:`,
          ``,
          `👉 *Pay ${amountInr} Securely:*`,
          `${link}`,
        ].join('\n');
      } else if (params.channel === 'EMAIL') {
        subject = `Complete your payment of ${amountInr} for order ${params.opportunity.id}`;
        body = `Hello,\n\nYour recent payment of ${amountInr} was interrupted (${params.diagnosis.customer_friendly_explanation}).\n\nYour order is on hold. You can safely complete it using our verified link:\n\n${link}`;
      } else if (params.channel === 'CHECKOUT_MODAL') {
        body = `${params.diagnosis.customer_friendly_explanation} Tap below to complete with UPI or an alternate card.`;
      } else {
        body = `Payment of ${amountInr} for ref ${params.opportunity.id.slice(0, 8)} held. Complete securely: ${link}`;
      }
    }

    // Persist outreach draft record
    try {
      insertOutreachDraft({
        id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        run_id: params.runId || `run_direct_${params.opportunity.id}`,
        opportunity_id: params.opportunity.id,
        channel: params.channel === 'CHECKOUT_MODAL' ? 'WHATSAPP' : params.channel,
        recipient: params.opportunity.customer_id,
        subject: subject || null,
        body,
        compliance_footer: 'CTRL Autonomous Recovery • RBI Compliant • Razorpay Secure',
        status: 'APPROVED',
        review_feedback: `Tailored copy for ${cat}: ${advice}`,
        created_at: new Date().toISOString(),
      });
    } catch {}

    return {
      subject,
      body,
      channel: params.channel,
      paymentLinkUrl: link,
      category: cat,
      customerAdvice: advice,
    };
  }

  public static async draftCustomerCommunication(params: {
    runId: string;
    opportunity: RecoveryOpportunity;
    channel: 'SMS' | 'WHATSAPP' | 'EMAIL';
    paymentLinkUrl?: string;
    tone?: OutreachTone;
  }): Promise<OutreachDraftRecord> {
    const amountInr = `₹${(params.opportunity.amount_paise / 100).toFixed(2)}`;
    const link = params.paymentLinkUrl || `https://rzp.io/i/${params.opportunity.id}`;
    const tone = params.tone || this.determineTone(params.opportunity);

    let subject: string | undefined = undefined;
    let body = '';

    if (params.channel === 'EMAIL') {
      if (tone === 'URGENT_ACTION') {
        subject = `Action Required: Final attempt to complete your payment of ${amountInr}`;
        body = `Dear Customer,\n\nYour transaction of ${amountInr} for order ${params.opportunity.id} could not be processed. This is your active retry link to avoid order cancellation:\n\n${link}\n\nOur team is available if you need further assistance.`;
      } else {
        subject = `Complete your payment of ${amountInr} for order ${params.opportunity.id}`;
        body = `Hello,\n\nWe noticed your recent payment of ${amountInr} was interrupted. You can safely complete it using our verified secure link:\n\n${link}\n\nIf you have already paid or have questions, please feel free to reply.`;
      }
    } else if (params.channel === 'WHATSAPP') {
      if (tone === 'URGENT_ACTION') {
        body = `⚠️ *Payment Pending*: Your transaction of ${amountInr} is on hold. Complete it now to secure your order: ${link}`;
      } else {
        body = `👋 Hi! Your payment of ${amountInr} was interrupted. Tap here to retry safely via Razorpay: ${link}`;
      }
    } else {
      // SMS
      if (tone === 'URGENT_ACTION') {
        body = `URGENT: Order ${params.opportunity.id.slice(0, 8)} pending payment of ${amountInr}. Pay securely: ${link}`;
      } else {
        body = `Payment of ${amountInr} for ref ${params.opportunity.id.slice(0, 8)} interrupted. Complete securely: ${link}`;
      }
    }

    const complianceFooter = 'CTRL Autonomous Recovery • RBI Compliant • Reply STOP to opt out • Merchant Support';

    const toolRes = await AgentToolRegistry.executeTool({
      toolId: 'create_outreach_draft',
      runId: params.runId,
      agentName: 'OutreachAgent',
      inputPayload: {
        run_id: params.runId,
        opportunity_id: params.opportunity.id,
        channel: params.channel,
        recipient: params.opportunity.customer_id,
        subject,
        body,
        compliance_footer: complianceFooter,
      },
    });

    return {
      id: (toolRes as any).proposal_id || (toolRes.data as any)?.proposal_id || `draft_${Date.now()}`,
      run_id: params.runId,
      opportunity_id: params.opportunity.id,
      channel: params.channel,
      recipient: params.opportunity.customer_id,
      subject: subject || null,
      body,
      compliance_footer: complianceFooter,
      status: 'PENDING_REVIEW',
      review_feedback: null,
      created_at: new Date().toISOString(),
    };
  }
}

