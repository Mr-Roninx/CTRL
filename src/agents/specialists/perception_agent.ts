import { RecoveryOpportunity } from '../../types/index.js';
import { AgentToolRegistry } from '../tool_registry.js';
import { PerceptionAnnotationRecord } from '../types.js';
import { getPerceptionAnnotationByOpportunityId, insertPerceptionAnnotation } from '../../db/database.js';

export interface FailureReasonDiagnosis {
  category: 'INSUFFICIENT_FUNDS' | 'NETWORK_LATENCY' | 'SECURITY_STOP' | 'USER_ABORT' | 'CARD_EXPIRED' | 'LIMIT_EXCEEDED' | 'TECHNICAL_GLITCH';
  root_cause: string;
  customer_friendly_explanation: string;
  recovery_recommendation: string;
  recommended_channel: 'UPI' | 'CARD' | 'NETBANKING' | 'ALTERNATE_METHOD' | 'NONE';
  urgency_score: number;
  risk_score: number;
  confidence: number;
  is_hard_decline: boolean;
  temporal_context?: {
    is_salary_window: boolean;
    is_maintenance_window: boolean;
  };
}

export class PerceptionAgent {
  /**
   * Translates bank-specific decline codes into standardized semantic failure modes.
   */
  public static translateBankDeclineCode(rawCode: string): {
    normalized_reason: string;
    is_hard: boolean;
    category: 'INSUFFICIENT_FUNDS' | 'NETWORK_LATENCY' | 'SECURITY_STOP' | 'USER_ABORT' | 'UNKNOWN';
  } {
    const code = (rawCode || '').toUpperCase().trim();

    // HDFC bank decline maps
    if (code === 'DECLINE_05' || code === 'DECLINE_51' || code === 'ERR_BAL_51' || code === 'INSUFFICIENT_FUNDS') {
      return { normalized_reason: 'INSUFFICIENT_FUNDS', is_hard: false, category: 'INSUFFICIENT_FUNDS' };
    }
    if (code === 'DECLINE_91' || code === 'ERR_AUTH_99' || code === 'GATEWAY_TIMEOUT' || code === 'NETWORK_ERROR') {
      return { normalized_reason: 'GATEWAY_ERROR', is_hard: false, category: 'NETWORK_LATENCY' };
    }
    if (code === 'ERR_CARD_43' || code === 'STOLEN_CARD' || code === 'LOST_CARD') {
      return { normalized_reason: 'STOLEN_CARD', is_hard: true, category: 'SECURITY_STOP' };
    }
    if (code === 'CARD_EXPIRED' || code === 'EXPIRED_CARD') {
      return { normalized_reason: 'CARD_EXPIRED', is_hard: false, category: 'UNKNOWN' };
    }
    if (code === 'USER_CANCELLED' || code === 'OTP_EXPIRED') {
      return { normalized_reason: 'USER_DROPPED', is_hard: false, category: 'USER_ABORT' };
    }

    return { normalized_reason: code || 'UNKNOWN_ERROR', is_hard: false, category: 'UNKNOWN' };
  }

  /**
   * Performs deep reasoning analysis on the failure reason, determining
   * root cause, category, customer explanation, and recommended recovery path.
   */
  public static diagnoseFailureReason(
    opportunity: RecoveryOpportunity,
    rawErrorDescription?: string
  ): FailureReasonDiagnosis {
    const reason = (opportunity.reason_code || '').toUpperCase().trim();
    let rawDesc = (rawErrorDescription || '').toLowerCase().trim();
    
    if (!rawDesc && opportunity.raw_payload_ref) {
      try {
        const parsed = JSON.parse(opportunity.raw_payload_ref);
        rawDesc = (parsed.error_reason || parsed.error_description || parsed.error_code || '').toLowerCase();
      } catch {}
    }

    const temporal = this.extractTemporalSignals(opportunity.created_at);
    const combined = `${reason} ${rawDesc}`.toLowerCase();

    // 1. Hard Declines / Security Stops
    const isHardDecline =
      opportunity.decline_type === 'hard' ||
      combined.includes('stolen') ||
      combined.includes('lost_card') ||
      combined.includes('pickup') ||
      combined.includes('restricted') ||
      combined.includes('fraud') ||
      combined.includes('account_blocked') ||
      combined.includes('account_frozen') ||
      combined.includes('npci_xb');

    if (isHardDecline) {
      const diag: FailureReasonDiagnosis = {
        category: 'SECURITY_STOP',
        root_cause: 'Issuer security block or reported lost/stolen card restriction. Automatic retry prohibited by banking policy.',
        customer_friendly_explanation: 'The transaction was stopped by the card issuing bank for account protection. No funds were debited.',
        recovery_recommendation: 'Do not re-attempt with this card. Advise customer to contact their issuing bank or use another verified payment method.',
        recommended_channel: 'NONE',
        urgency_score: 0.05,
        risk_score: 0.99,
        confidence: 0.98,
        is_hard_decline: true,
        temporal_context: temporal,
      };
      this.persistDiagnosisAnnotation(opportunity.id, diag);
      return diag;
    }

    // 2. Bank Network Latency / 3DS Gateway Timeout
    if (
      combined.includes('timeout') ||
      combined.includes('network') ||
      combined.includes('gateway_error') ||
      combined.includes('npci_u30') ||
      combined.includes('npci_u69') ||
      combined.includes('temporarily_unavailable') ||
      combined.includes('bank_network_timeout')
    ) {
      const diag: FailureReasonDiagnosis = {
        category: 'NETWORK_LATENCY',
        root_cause: temporal.is_maintenance_window
          ? 'NPCI/Banking settlement maintenance window switch latency. Issuing bank did not respond to 3DS challenge.'
          : 'Bank gateway communication timeout during 3D Secure / OTP authorization challenge.',
        customer_friendly_explanation: 'Your bank authorization server experienced a temporary network timeout during 3D Secure verification.',
        recovery_recommendation: 'Safe to retry immediately using UPI (Google Pay, PhonePe) or an alternate bank card.',
        recommended_channel: 'UPI',
        urgency_score: 0.85,
        risk_score: 0.08,
        confidence: 0.94,
        is_hard_decline: false,
        temporal_context: temporal,
      };
      this.persistDiagnosisAnnotation(opportunity.id, diag);
      return diag;
    }

    // 3. Insufficient Funds / Liquidity
    if (
      combined.includes('insufficient') ||
      combined.includes('err_bal_51') ||
      combined.includes('decline_51') ||
      combined.includes('balance')
    ) {
      const diag: FailureReasonDiagnosis = {
        category: 'INSUFFICIENT_FUNDS',
        root_cause: 'Account balance insufficient or debit limit exceeded on the selected payment instrument.',
        customer_friendly_explanation: 'The payment could not proceed due to account balance or transaction limit restrictions at your bank.',
        recovery_recommendation: 'Hold order and provide a 1-click repay link to complete payment when convenient, or use another card/UPI account.',
        recommended_channel: 'ALTERNATE_METHOD',
        urgency_score: 0.65,
        risk_score: 0.15,
        confidence: 0.90,
        is_hard_decline: false,
        temporal_context: temporal,
      };
      this.persistDiagnosisAnnotation(opportunity.id, diag);
      return diag;
    }

    // 4. Card Expired / Inactive
    if (combined.includes('expired') || combined.includes('card_expired') || combined.includes('card_inactive')) {
      const diag: FailureReasonDiagnosis = {
        category: 'CARD_EXPIRED',
        root_cause: 'Card expiry date passed or card has been marked inactive by card network.',
        customer_friendly_explanation: 'The card entered has expired or is currently marked inactive by your card issuer.',
        recovery_recommendation: 'Prompt customer to complete payment using an active debit/credit card or instant UPI.',
        recommended_channel: 'CARD',
        urgency_score: 0.70,
        risk_score: 0.10,
        confidence: 0.95,
        is_hard_decline: false,
        temporal_context: temporal,
      };
      this.persistDiagnosisAnnotation(opportunity.id, diag);
      return diag;
    }

    // 5. User Aborted / Dismissed / OTP Timeout
    if (
      combined.includes('user_dropped') ||
      combined.includes('cancelled') ||
      combined.includes('user_cancelled') ||
      combined.includes('otp_timeout') ||
      combined.includes('otp_expired')
    ) {
      const diag: FailureReasonDiagnosis = {
        category: 'USER_ABORT',
        root_cause: 'Customer closed the checkout window or OTP session expired before entering verification code.',
        customer_friendly_explanation: 'The checkout window was closed before the transaction could be confirmed. No amount was charged.',
        recovery_recommendation: 'Send quick 1-click resume link to restore the order without re-entering checkout details.',
        recommended_channel: 'UPI',
        urgency_score: 0.75,
        risk_score: 0.05,
        confidence: 0.92,
        is_hard_decline: false,
        temporal_context: temporal,
      };
      this.persistDiagnosisAnnotation(opportunity.id, diag);
      return diag;
    }

    // 6. Transaction Limit Exceeded
    if (combined.includes('limit_exceeded') || combined.includes('transaction_limit') || combined.includes('limit')) {
      const diag: FailureReasonDiagnosis = {
        category: 'LIMIT_EXCEEDED',
        root_cause: 'Daily or per-transaction online banking limit exceeded for this payment method.',
        customer_friendly_explanation: 'This transaction exceeds your bank account or card single-transaction spending limit.',
        recovery_recommendation: 'Suggest completing via UPI or NetBanking rail which may have independent transaction allowances.',
        recommended_channel: 'NETBANKING',
        urgency_score: 0.60,
        risk_score: 0.12,
        confidence: 0.88,
        is_hard_decline: false,
        temporal_context: temporal,
      };
      this.persistDiagnosisAnnotation(opportunity.id, diag);
      return diag;
    }

    // 7. General Technical Glitch / Fallback
    const diag: FailureReasonDiagnosis = {
      category: 'TECHNICAL_GLITCH',
      root_cause: 'Bank switch authorization anomaly or transient gateway communication error.',
      customer_friendly_explanation: 'The bank was unable to complete payment authorization at this moment.',
      recovery_recommendation: 'Provide a verified Razorpay payment link to retry securely with UPI or alternate cards.',
      recommended_channel: 'UPI',
      urgency_score: 0.60,
      risk_score: 0.20,
      confidence: 0.75,
      is_hard_decline: false,
      temporal_context: temporal,
    };
    this.persistDiagnosisAnnotation(opportunity.id, diag);
    return diag;
  }

  /**
   * Persists perception diagnostic record to database.
   */
  private static persistDiagnosisAnnotation(opportunityId: string, diag: FailureReasonDiagnosis): void {
    try {
      insertPerceptionAnnotation({
        id: `annot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        opportunity_id: opportunityId,
        failure_intent: diag.root_cause,
        customer_urgency_score: diag.urgency_score,
        merchant_risk_score: diag.risk_score,
        semantic_notes: `[Category: ${diag.category}] [Explanation: ${diag.customer_friendly_explanation}] [Recommendation: ${diag.recovery_recommendation}]`,
        confidence: diag.confidence,
        created_at: new Date().toISOString(),
      });
    } catch {}
  }

  /**
   * Extracts temporal features: salary window, banking maintenance hours.
   */
  public static extractTemporalSignals(timestamp?: string): {
    is_salary_window: boolean;
    is_maintenance_window: boolean;
    liquidity_multiplier: number;
  } {
    const date = timestamp ? new Date(timestamp) : new Date();
    // Indian Standard Time (UTC+5.5)
    const istTime = new Date(date.getTime() + 5.5 * 3600 * 1000);
    const day = istTime.getUTCDate();
    const hour = istTime.getUTCHours();
    const minute = istTime.getUTCMinutes();

    // Indian salary cycle: 28th to 5th of month
    const isSalaryWindow = day >= 28 || day <= 5;

    // Banking settlement & NPCI maintenance hours: 11:30 PM to 2:30 AM IST
    const isMaintenance = (hour === 23 && minute >= 30) || hour === 0 || hour === 1 || (hour === 2 && minute <= 30);

    return {
      is_salary_window: isSalaryWindow,
      is_maintenance_window: isMaintenance,
      liquidity_multiplier: isSalaryWindow ? 1.25 : 0.90,
    };
  }

  public static async analyzeOpportunity(params: {
    runId: string;
    opportunity: RecoveryOpportunity;
  }): Promise<PerceptionAnnotationRecord> {
    const existing = getPerceptionAnnotationByOpportunityId(params.opportunity.id);
    if (existing) return existing;

    const bankTranslation = this.translateBankDeclineCode(params.opportunity.reason_code);
    const temporal = this.extractTemporalSignals(params.opportunity.created_at);
    const isHard = params.opportunity.decline_type === 'hard' || bankTranslation.is_hard;

    // Call bounded tools to inspect context
    await AgentToolRegistry.executeTool({
      toolId: 'get_payment_attempts',
      runId: params.runId,
      agentName: 'PerceptionAgent',
      inputPayload: { opportunity_id: params.opportunity.id },
    });

    let failureIntent = 'Temporary liquidity deficit';
    let urgencyScore = 0.6;
    let riskScore = 0.2;
    let confidence = 0.85;

    if (isHard) {
      failureIntent = 'Reported stolen card, issuer security block, or account freeze';
      urgencyScore = 0.05;
      riskScore = 0.98;
      confidence = 0.98;
    } else if (bankTranslation.category === 'NETWORK_LATENCY' || temporal.is_maintenance_window) {
      failureIntent = temporal.is_maintenance_window
        ? 'NPCI/Banking maintenance window congestion — high spontaneous recovery'
        : 'Bank gateway switch latency / network congestion';
      urgencyScore = 0.85;
      riskScore = 0.10;
      confidence = 0.92;
    } else if (params.opportunity.attempt_count >= 3) {
      failureIntent = 'Persistent payment decline, customer contact fatigue elevated';
      urgencyScore = 0.30;
      riskScore = 0.70;
      confidence = 0.80;
    } else if (temporal.is_salary_window) {
      failureIntent = 'Payday window liquidity active — elevated conversion propensity';
      urgencyScore = 0.75;
      riskScore = 0.15;
      confidence = 0.88;
    }

    const notes = `Perception Agent: [Normalized: ${bankTranslation.normalized_reason}] [Category: ${bankTranslation.category}] [SalaryWindow: ${temporal.is_salary_window}] [Maintenance: ${temporal.is_maintenance_window}]. Attempt: ${params.opportunity.attempt_count}.`;

    const toolRes = await AgentToolRegistry.executeTool({
      toolId: 'create_perception_annotation',
      runId: params.runId,
      agentName: 'PerceptionAgent',
      inputPayload: {
        opportunity_id: params.opportunity.id,
        failure_intent: failureIntent,
        customer_urgency_score: urgencyScore,
        merchant_risk_score: riskScore,
        semantic_notes: notes,
        confidence,
      },
    });

    return {
      id: toolRes.data?.id || `annot_${params.opportunity.id}`,
      opportunity_id: params.opportunity.id,
      failure_intent: failureIntent,
      customer_urgency_score: urgencyScore,
      merchant_risk_score: riskScore,
      semantic_notes: notes,
      confidence,
      created_at: new Date().toISOString(),
    };
  }
}

