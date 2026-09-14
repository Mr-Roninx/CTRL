import crypto from 'node:crypto';
import { RecoveryOpportunity, Score } from '../types/index.js';
import { AgentPlanRecord, PlanValidityAssumption, AgentMissionGoal } from './types.js';
import { insertAgentPlan, getActivePlanByRunId } from '../db/database.js';
import { AgentIntent } from './schema.js';

export interface PlanGenerationResult {
  plan: AgentPlanRecord;
  is_valid: boolean;
  validation_errors: string[];
}

export class AgentPlanner {
  /**
   * Generates a concrete, persisted execution plan by combining deterministic safety candidates and LLM proposals.
   */
  public static createPlan(params: {
    runId: string;
    goal: AgentMissionGoal;
    opportunity: RecoveryOpportunity;
    intent?: AgentIntent;
    score?: Score;
    gatewayHealth?: number;
    capacityAvailable?: number;
    planVersion?: number;
  }): PlanGenerationResult {
    const planId = `plan_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const planVersion = params.planVersion || 1;

    // 1. Establish Feasible Candidate Actions: Mandatory Deterministic Set Union LLM Candidates
    const deterministicCandidates = params.opportunity.decline_type === 'hard'
      ? ['ABSTAIN']
      : ['WAIT', 'SEND_PAYMENT_LINK', 'ABSTAIN'];

    const llmCandidates = params.intent?.candidate_actions || [];
    const candidateSet = Array.from(new Set([...deterministicCandidates, ...llmCandidates]));

    // 2. Select Preferred Action
    let preferred = params.intent?.proposed_plan?.preferred_action || 'SEND_PAYMENT_LINK';
    if (!candidateSet.includes(preferred)) {
      preferred = candidateSet[0] || 'SEND_PAYMENT_LINK';
    }
    // Hard decline override invariant
    if (params.opportunity.decline_type === 'hard') {
      preferred = 'ABSTAIN';
    }

    // 3. Define Validity Assumptions
    const assumptions: PlanValidityAssumption[] = [
      {
        id: 'assump_gateway_health',
        parameter: 'gateway_health',
        condition: '>=',
        expected_value: 0.75,
        current_value: params.gatewayHealth ?? 0.98,
        is_valid: (params.gatewayHealth ?? 0.98) >= 0.75,
      },
      {
        id: 'assump_retry_cap',
        parameter: 'attempt_count',
        condition: '<',
        expected_value: 3,
        current_value: params.opportunity.attempt_count,
        is_valid: params.opportunity.attempt_count < 3,
      },
      {
        id: 'assump_capacity_available',
        parameter: 'capacity_available',
        condition: '>',
        expected_value: 0,
        current_value: params.capacityAvailable ?? 5,
        is_valid: (params.capacityAvailable ?? 5) > 0,
      },
    ];

    // 4. Generate Ordered Execution Steps
    let steps: string[] = [];
    if (preferred === 'ABSTAIN') {
      steps = [
        'Log compliance check results in Action Authority audit table',
        'Set opportunity status to abstained/blocked',
        'Terminate mission with zero financial execution',
      ];
    } else if (preferred === 'WAIT') {
      steps = [
        'Set opportunity status to deferred',
        'Schedule wake condition (gateway check or timer)',
        'Enter persisted WAIT state',
      ];
    } else {
      steps = [
        'Request Economic IVEN calculation with semantic modifiers',
        'Submit opportunity to Recovery Market portfolio allocator',
        'Verify Action Authority 5-step compliance check',
        'If AUTHORIZED, dispatch to isolated execution layer',
        'Await provider webhook settlement or poll status',
        'Reconcile truth and evaluate outcome',
      ];
    }

    const planRecord: AgentPlanRecord = {
      id: planId,
      run_id: params.runId,
      plan_version: planVersion,
      goal: params.goal.desired_outcome || `Recover opportunity ${params.opportunity.id}`,
      steps,
      validity_assumptions: assumptions,
      candidate_actions: candidateSet,
      preferred_action: preferred,
      status: 'ACTIVE',
      invalidation_reason: null,
      created_at: new Date().toISOString(),
    };

    insertAgentPlan(planRecord);

    const invalidAssumptions = assumptions.filter((a) => !a.is_valid);
    return {
      plan: planRecord,
      is_valid: invalidAssumptions.length === 0,
      validation_errors: invalidAssumptions.map((a) => `Assumption '${a.parameter}' failed (${a.current_value} not ${a.condition} ${a.expected_value})`),
    };
  }
}
