export type OpportunitySource = 'real' | 'synthetic';

export type DeclineType = 'hard' | 'soft' | 'unknown';

export type OpportunityStatus =
  | 'pending'
  | 'scored'
  | 'allocated'
  | 'authorized'
  | 'deferred'
  | 'blocked'
  | 'abstained'
  | 'executing'
  | 'recovered'
  | 'not_recovered';

export type ConfidenceLevel = 'low' | 'medium' | 'high';

export type DecisionType = 'ACT' | 'WAIT' | 'ABSTAIN';

export type AuthorityVerdict = 'AUTHORIZED' | 'BLOCKED' | 'ABSTAIN' | 'WAIT';

export type LedgerEventType =
  | 'webhook_received'
  | 'reconciled'
  | 'recovered'
  | 'not_recovered';

export interface Customer {
  id: string;
  trust_score: number;
  created_at: string;
  updated_at: string;
}

export interface RecoveryOpportunity {
  id: string;
  source: OpportunitySource;
  amount_paise: number;
  currency: string;
  reason_code: string;
  decline_type: DeclineType;
  attempt_count: number;
  customer_id: string;
  customer_trust_score: number;
  created_at: string;
  status: OpportunityStatus;
  tenant_id: string;
  environment: 'test' | 'live';
  razorpay_event_id?: string | null;
  raw_payload_ref?: string | null;
}

export type IVENBand = 'STRONG' | 'MODERATE' | 'WEAK' | 'NEGATIVE';

export interface Score {
  opportunity_id: string;
  tenant_id?: string;
  natural_recovery_prob: number;
  intervention_recovery_prob: number;
  incremental_prob: number;
  operational_cost_paise: number;
  fatigue_cost_paise: number;
  expected_incremental_value_paise: number;
  confidence: ConfidenceLevel;
  iven_band?: IVENBand;
  probability_disclaimer?: string;
  probability_source?: 'STATIC' | 'CALIBRATED';
}

export interface AllocationDecision {
  opportunity_id: string;
  decision: DecisionType;
  rank_in_batch: number;
  shadow_price_paise_at_decision: number;
  reason: string;
}

export interface AuthorityCheck {
  id?: number;
  opportunity_id: string;
  check_name: string;
  passed: boolean;
  reason: string;
}

export interface ExecutionRecord {
  opportunity_id: string;
  razorpay_payment_link_id: string;
  link_url: string;
  status: string;
  idempotency_key: string;
  created_at: string;
}

export interface LedgerEntry {
  id: string;
  opportunity_id: string;
  event_type: LedgerEventType;
  amount_paise: number;
  timestamp: string;
  raw_payload_ref: string | null;
}
