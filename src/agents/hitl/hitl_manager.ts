import crypto from 'node:crypto';
import { RecoveryOpportunity } from '../../types/index.js';
import {
  HITLRequest,
  HITLDecision,
  HITLTriggerReason,
  HITLRequestStatus,
} from './hitl_types.js';

/**
 * HITLManager — Human-In-The-Loop Approval & Review Controller
 * Intercepts high-stakes actions, manages approval queues, and enforces deterministic timeouts.
 */
export class HITLManager {
  private static requests: Map<string, HITLRequest> = new Map();
  private static HIGH_VALUE_THRESHOLD_PAISE = 2500000; // ₹25,000
  private static DEFAULT_SLA_MINUTES = 30;

  /**
   * Determine whether an opportunity triggers mandatory operator review.
   */
  public static shouldRequireReview(
    opp: RecoveryOpportunity,
    confidence: number = 0.8
  ): { requires_review: boolean; reason?: HITLTriggerReason; explanation?: string } {
    if (opp.amount_paise >= this.HIGH_VALUE_THRESHOLD_PAISE) {
      return {
        requires_review: true,
        reason: 'HIGH_TICKET_VALUE',
        explanation: `Transaction amount ₹${(opp.amount_paise / 100).toFixed(2)} exceeds high-value threshold (₹25,000). Operator sign-off required.`,
      };
    }

    if (confidence < 0.40 && opp.decline_type !== 'hard') {
      return {
        requires_review: true,
        reason: 'LOW_CONFIDENCE',
        explanation: `Agent confidence score (${(confidence * 100).toFixed(1)}%) is below acceptable threshold (40%). Operator verification required.`,
      };
    }

    return { requires_review: false };
  }

  /**
   * Create and record a new HITL review request.
   */
  public static createRequest(params: {
    opportunity: RecoveryOpportunity;
    runId?: string;
    proposedAction: 'ACT' | 'WAIT' | 'ABSTAIN';
    reason: HITLTriggerReason;
    explanation: string;
    slaMinutes?: number;
  }): HITLRequest {
    const id = `hitl_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const sla = params.slaMinutes || this.DEFAULT_SLA_MINUTES;
    const timeoutAt = new Date(Date.now() + sla * 60 * 1000).toISOString();

    const request: HITLRequest = {
      id,
      opportunity_id: params.opportunity.id,
      run_id: params.runId || null,
      proposed_action: params.proposedAction,
      amount_paise: params.opportunity.amount_paise,
      reason: params.reason,
      explanation: params.explanation,
      status: 'PENDING',
      operator_id: null,
      operator_feedback: null,
      overridden_action: null,
      timeout_at: timeoutAt,
      created_at: new Date().toISOString(),
      resolved_at: null,
    };

    this.requests.set(id, request);
    return request;
  }

  /**
   * Get all pending review requests, automatically pruning timed-out ones.
   */
  public static getPendingRequests(): HITLRequest[] {
    this.checkTimeouts();
    return Array.from(this.requests.values()).filter((r) => r.status === 'PENDING');
  }

  /**
   * Get all requests regardless of status.
   */
  public static getAllRequests(): HITLRequest[] {
    this.checkTimeouts();
    return Array.from(this.requests.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  /**
   * Get request by ID.
   */
  public static getRequestById(id: string): HITLRequest | undefined {
    this.checkTimeouts();
    return this.requests.get(id);
  }

  /**
   * Resolve an approval request with a human decision.
   */
  public static resolveRequest(params: {
    requestId: string;
    decision: HITLDecision;
    operatorId: string;
    feedback?: string;
    overriddenAction?: 'ACT' | 'WAIT' | 'ABSTAIN';
  }): { success: boolean; request?: HITLRequest; error?: string } {
    const req = this.requests.get(params.requestId);
    if (!req) {
      return { success: false, error: `HITL Request '${params.requestId}' not found.` };
    }

    if (req.status !== 'PENDING') {
      return { success: false, error: `HITL Request is already resolved with status '${req.status}'.` };
    }

    let nextStatus: HITLRequestStatus = 'APPROVED';
    if (params.decision === 'REJECT') {
      nextStatus = 'REJECTED';
    } else if (params.decision === 'OVERRIDE') {
      nextStatus = 'OVERRIDDEN';
    } else if (params.decision === 'TIMEOUT') {
      nextStatus = 'TIMED_OUT';
    }

    req.status = nextStatus;
    req.operator_id = params.operatorId;
    req.operator_feedback = params.feedback || null;
    req.overridden_action = params.overriddenAction || null;
    req.resolved_at = new Date().toISOString();

    return { success: true, request: req };
  }

  /**
   * Auto-timeout check: expired pending requests default to TIMED_OUT (safe non-action).
   */
  public static checkTimeouts(): number {
    const now = Date.now();
    let timedOutCount = 0;

    for (const req of this.requests.values()) {
      if (req.status === 'PENDING' && new Date(req.timeout_at).getTime() <= now) {
        req.status = 'TIMED_OUT';
        req.operator_id = 'system_timeout_daemon';
        req.operator_feedback = 'SLA expired without merchant response. Defaulting to safe ABSTAIN.';
        req.resolved_at = new Date().toISOString();
        timedOutCount++;
      }
    }

    return timedOutCount;
  }
}
