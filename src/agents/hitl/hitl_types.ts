export type HITLDecision = 'APPROVE' | 'REJECT' | 'OVERRIDE' | 'TIMEOUT';

export type HITLTriggerReason =
  | 'HIGH_TICKET_VALUE'
  | 'LOW_CONFIDENCE'
  | 'OUTREACH_REVIEW'
  | 'HARD_DECLINE_REVIEW'
  | 'MERCHANT_POLICY'
  | 'EXECUTION_DLQ_EXHAUSTED';

export type HITLRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'OVERRIDDEN' | 'TIMED_OUT';

export interface HITLRequest {
  id: string;
  opportunity_id: string;
  run_id?: string | null;
  proposed_action: 'ACT' | 'WAIT' | 'ABSTAIN';
  amount_paise: number;
  reason: HITLTriggerReason;
  explanation: string;
  status: HITLRequestStatus;
  operator_id?: string | null;
  operator_feedback?: string | null;
  overridden_action?: 'ACT' | 'WAIT' | 'ABSTAIN' | null;
  timeout_at: string;
  created_at: string;
  resolved_at?: string | null;
}
