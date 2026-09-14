export type AgentState =
  | 'IDLE'
  | 'TRIGGERED'
  | 'OBSERVE'
  | 'INVESTIGATE'
  | 'DIAGNOSE'
  | 'HYPOTHESIZE'
  | 'PLAN'
  | 'VALIDATE_PLAN'
  | 'PROPOSE'
  | 'WAIT_AUTHORITY'
  | 'EXECUTE'
  | 'WAIT'
  | 'WAKE'
  | 'OBSERVE_OUTCOME'
  | 'PLAN_INVALIDATED'
  | 'REPLAN'
  | 'LEARN'
  | 'MEMORY_UPDATE'
  | 'COMPLETE'
  | 'ABORTED'
  | 'HUMAN_REVIEW';

export type GoalType =
  | 'RECOVER_PAYMENT'
  | 'CALIBRATE_STRATEGY'
  | 'INVESTIGATE_FAILURE'
  | 'EXPLAIN_DECISION'
  | 'CUSTOMER_OUTREACH';

export type ToolPermission =
  | 'READ'
  | 'ANALYZE'
  | 'PROPOSE'
  | 'APPROVE'
  | 'EXECUTE'
  | 'FINANCIAL_WRITE';

export type MemoryType = 'working' | 'episodic' | 'semantic';

export type SpecialistAgentName =
  | 'PerceptionAgent'
  | 'StrategyAgent'
  | 'OutreachAgent'
  | 'ComplianceCopilot'
  | 'MerchantCopilot'
  | 'PortfolioAgent'
  | 'AgentOrchestrator';

export interface AgentBudgetConfig {
  max_llm_calls: number;
  max_tool_calls: number;
  max_replans: number;
  max_steps: number;
  max_wall_clock_ms: number;
}

export const DEFAULT_AGENT_BUDGET: AgentBudgetConfig = {
  max_llm_calls: 8,
  max_tool_calls: 20,
  max_replans: 3,
  max_steps: 40,
  max_wall_clock_ms: 30000,
};

export interface AgentMissionGoal {
  type: GoalType;
  opportunity_id?: string;
  desired_outcome?: string;
  economic_constraints?: {
    max_cost_paise?: number;
    min_confidence?: 'low' | 'medium' | 'high';
  };
  policy_constraints?: {
    max_attempts?: number;
    respect_kill_switch?: boolean;
  };
  deadline?: string;
  max_mission_duration_ms?: number;
}

export interface AgentRunRecord {
  id: string;
  mission_id: string;
  opportunity_id: string | null;
  goal_type: GoalType;
  status: 'running' | 'completed' | 'aborted' | 'human_review';
  start_time: string;
  end_time: string | null;
  total_steps: number;
  llm_calls: number;
  tool_calls: number;
  replan_count: number;
  total_tokens: number;
  latency_ms: number;
  termination_reason: string | null;
  created_at: string;
}

export interface AgentStateRecord {
  id?: number;
  run_id: string;
  state: AgentState;
  previous_state: AgentState | null;
  trigger: string;
  metadata: string | null;
  timestamp: string;
}

export interface AgentStepRecord {
  id?: number;
  run_id: string;
  step_number: number;
  state: AgentState;
  observation: string | null;
  thought: string | null;
  action_type: string | null;
  action_payload: string | null;
  tool_name: string | null;
  tool_input: string | null;
  tool_output: string | null;
  timestamp: string;
}

export interface AgentToolCallRecord {
  id: string;
  run_id: string;
  tool_name: string;
  agent_name: SpecialistAgentName;
  input_payload: string;
  input_hash: string;
  output_payload: string;
  output_hash: string;
  status: 'SUCCESS' | 'DENIED' | 'FAILED' | 'TIMEOUT';
  latency_ms: number;
  error_message: string | null;
  permission_level: ToolPermission;
  created_at: string;
}

export interface PlanValidityAssumption {
  id: string;
  parameter: string;
  condition: string;
  expected_value: unknown;
  current_value?: unknown;
  is_valid: boolean;
}

export interface AgentPlanRecord {
  id: string;
  run_id: string;
  plan_version: number;
  goal: string;
  steps: string[];
  validity_assumptions: PlanValidityAssumption[];
  candidate_actions: string[];
  preferred_action: string;
  status: 'ACTIVE' | 'INVALIDATED' | 'EXECUTED' | 'SUPERSEDED';
  invalidation_reason: string | null;
  created_at: string;
}

export interface AgentHypothesisRecord {
  id: string;
  run_id: string;
  failure_category: string;
  root_cause_hypothesis: string;
  confidence: number;
  supporting_evidence: string[];
  created_at: string;
}

export interface AgentProposalRecord {
  id: string;
  run_id: string;
  opportunity_id: string;
  proposal_type: 'INTERVENTION' | 'RETRY_DELAY' | 'PARAMETER_UPDATE' | 'OUTREACH';
  payload: Record<string, unknown>;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED';
  review_notes: string | null;
  created_at: string;
}

export interface SemanticSignal {
  name:
    | 'transient_failure'
    | 'customer_liquidity'
    | 'fatigue'
    | 'gateway_instability'
    | 'settlement_ambiguity'
    | 'alternate_method_relevance'
    | 'urgency'
    | 'relationship_risk';
  value: number; // 0.0 to 1.0
  confidence: number; // 0.0 to 1.0
  evidence_reference: string;
  timestamp: string;
  source: string;
}

export interface AgentMemoryItem {
  id: string;
  memory_type: MemoryType;
  run_id: string | null;
  opportunity_id: string | null;
  failure_type: string | null;
  context_summary: string;
  action_taken: string | null;
  predicted_outcome: string | null;
  actual_outcome: string | null;
  prediction_error: number | null;
  semantic_key: string | null;
  semantic_value: string | null;
  confidence: number;
  provenance: string;
  created_at: string;
}

export interface AgentOutcomeRecord {
  id: string;
  run_id: string;
  opportunity_id: string;
  predicted_recovery_prob: number;
  actual_recovered: boolean;
  prediction_error: number;
  actual_revenue_paise: number;
  operational_cost_paise: number;
  net_gain_paise: number;
  customer_response: string | null;
  evaluated_at: string;
}

export interface AgentAuthorityCheckRecord {
  id?: number;
  run_id: string;
  tool_name: string;
  agent_name: SpecialistAgentName;
  check_name: string;
  passed: boolean;
  reason: string;
  timestamp: string;
}

export interface LLMInvocationRecord {
  id: string;
  run_id: string;
  model: string;
  provider: string;
  prompt_hash: string;
  prompt_preview: string;
  completion_hash: string;
  completion_preview: string;
  reasoning_preview: string | null;
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  error: string | null;
  created_at: string;
}

export interface OutreachDraftRecord {
  id: string;
  run_id: string;
  opportunity_id: string;
  channel: 'SMS' | 'WHATSAPP' | 'EMAIL';
  recipient: string;
  subject: string | null;
  body: string;
  compliance_footer: string;
  status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
  review_feedback: string | null;
  created_at: string;
}

export interface PerceptionAnnotationRecord {
  id: string;
  opportunity_id: string;
  failure_intent: string;
  customer_urgency_score: number;
  merchant_risk_score: number;
  semantic_notes: string;
  confidence: number;
  created_at: string;
}

// =========================================================================
// v5.1 Step 1: Portfolio Intelligence Types
// =========================================================================

export type ProposedAction = 'ACT' | 'WAIT' | 'INVESTIGATE';

export interface OpportunityPriority {
  opportunity_id: string;
  iven_paise: number;
  time_urgency: number;
  fatigue_risk: number;
  gateway_confidence: number;
  expiry_risk: number;
  priority_score: number;
  proposed_action: ProposedAction;
  rationale: string;
}

export interface PortfolioProposal {
  id: string;
  timestamp: string;
  total_scanned: number;
  priorities: OpportunityPriority[];
  capacity_available: number;
  top_k_recommendations: string[];
  portfolio_summary: string;
}

export type ConfidenceDimension = 'MODEL_CONFIDENCE' | 'DATA_CONFIDENCE' | 'ECONOMIC_CONFIDENCE';

export interface UncertaintyAssessment {
  opportunity_id: string;
  model_confidence: number;
  data_confidence: number;
  economic_confidence: number;
  composite_confidence: number;
  recommendation: 'PROCEED' | 'INVESTIGATE' | 'HUMAN_REVIEW' | 'ABSTAIN';
  missing_signals: string[];
  rationale: string;
}

export interface InformationValueResult {
  opportunity_id: string;
  current_iven_paise: number;
  gateway_health: number;
  investigation_cost_paise: number;
  expected_value_of_information_paise: number;
  recommended_action: ProposedAction;
  rationale: string;
}

export interface PlanMonitorResult {
  plan_id: string;
  run_id: string;
  is_still_valid: boolean;
  violated_assumptions: string[];
  elapsed_ms: number;
  recommendation: 'CONTINUE' | 'REPLAN' | 'ABORT';
  checked_at: string;
}

// =========================================================================
// v5.1 Steps 4 & 5: Concurrency & Replay Types
// =========================================================================

export interface ConcurrencyPoolConfig {
  max_concurrent_missions: number;
  mission_timeout_ms: number;
  rate_limit_per_minute: number;
}

export interface BatchMissionSummary {
  batch_id: string;
  total_submitted: number;
  completed_count: number;
  aborted_count: number;
  failed_count: number;
  total_tokens_consumed: number;
  total_steps_executed: number;
  total_latency_ms: number;
  average_latency_ms: number;
  max_concurrency_reached: number;
  results: Array<{
    opportunity_id: string;
    run_id: string;
    status: 'completed' | 'aborted' | 'human_review' | 'failed';
    final_decision: 'ACT' | 'WAIT' | 'ABSTAIN';
    authority_verdict: string;
    latency_ms: number;
  }>;
}

export interface MissionFingerprint {
  run_id: string;
  opportunity_id: string;
  fingerprint_sha256: string;
  state_sequence: string[];
  tool_call_hashes: string[];
  proposal_hashes: string[];
  authority_verdicts: string[];
  generated_at: string;
}

export interface ReplayVerificationResult {
  original_run_id: string;
  replay_run_id: string;
  is_match: boolean;
  original_fingerprint: string;
  replay_fingerprint: string;
  divergence_detected: boolean;
  divergence_stage: string | null;
  divergence_details: string | null;
  verified_at: string;
}

