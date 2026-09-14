import {
  getActivePlanByRunId,
  updateAgentPlanStatus,
} from '../db/database.js';
import { AgentPlanRecord, PlanValidityAssumption } from './types.js';
import { AgentStateMachine } from './state_machine.js';
import { MissionBudgetTracker } from './budget.js';
import { AgentPlanner } from './planner.js';
import { RecoveryOpportunity, Score } from '../types/index.js';
import { AgentMemoryStore } from './memory.js';
import { AgentTelemetry } from './telemetry.js';

export interface PlanValidationCheck {
  is_valid: boolean;
  active_plan?: AgentPlanRecord;
  failed_assumptions: {
    assumption_id: string;
    parameter: string;
    condition: string;
    expected: any;
    actual: any;
    reason: string;
  }[];
}

export interface ReplanResult {
  replanned: boolean;
  old_plan_id?: string;
  new_plan?: AgentPlanRecord;
  replan_count: number;
  invalidation_reason?: string;
  error?: string;
}

export class AgentReplanEngine {
  /**
   * Evaluates all assumptions of the active plan against current state.
   */
  public static validateActivePlan(params: {
    runId: string;
    currentGatewayHealth?: number;
    currentAttemptCount?: number;
    currentCapacityAvailable?: number;
  }): PlanValidationCheck {
    const activePlan = getActivePlanByRunId(params.runId);
    if (!activePlan) {
      return { is_valid: false, failed_assumptions: [{ assumption_id: 'none', parameter: 'active_plan', condition: 'exists', expected: true, actual: false, reason: 'No active plan found' }] };
    }

    const failedAssumptions: PlanValidationCheck['failed_assumptions'] = [];

    for (const assumption of activePlan.validity_assumptions) {
      const expNum = typeof assumption.expected_value === 'number' ? assumption.expected_value : (Number(assumption.expected_value) || 0);
      if (assumption.parameter === 'gateway_health' && params.currentGatewayHealth !== undefined) {
        if (params.currentGatewayHealth < expNum) {
          failedAssumptions.push({
            assumption_id: assumption.id,
            parameter: assumption.parameter,
            condition: assumption.condition,
            expected: assumption.expected_value,
            actual: params.currentGatewayHealth,
            reason: `Gateway health degraded to ${params.currentGatewayHealth} (expected >= ${assumption.expected_value})`,
          });
        }
      }

      if (assumption.parameter === 'attempt_count' && params.currentAttemptCount !== undefined) {
        if (params.currentAttemptCount >= expNum) {
          failedAssumptions.push({
            assumption_id: assumption.id,
            parameter: assumption.parameter,
            condition: assumption.condition,
            expected: assumption.expected_value,
            actual: params.currentAttemptCount,
            reason: `Attempt count hit retry cap (${params.currentAttemptCount} >= ${assumption.expected_value})`,
          });
        }
      }

      if (assumption.parameter === 'capacity_available' && params.currentCapacityAvailable !== undefined) {
        if (params.currentCapacityAvailable <= 0) {
          failedAssumptions.push({
            assumption_id: assumption.id,
            parameter: assumption.parameter,
            condition: assumption.condition,
            expected: assumption.expected_value,
            actual: params.currentCapacityAvailable,
            reason: 'Portfolio recovery market capacity is fully exhausted',
          });
        }
      }
    }

    return {
      is_valid: failedAssumptions.length === 0,
      active_plan: activePlan,
      failed_assumptions: failedAssumptions,
    };
  }

  /**
   * Executes replanning flow when active plan is invalidated.
   */
  public static executeReplan(params: {
    runId: string;
    stateMachine: AgentStateMachine;
    budgetTracker: MissionBudgetTracker;
    opportunity: RecoveryOpportunity;
    score?: Score;
    currentGatewayHealth?: number;
    currentCapacityAvailable?: number;
    invalidationReason: string;
  }): ReplanResult {
    // 1. Check budget for replanning
    const budgetCheck = params.budgetTracker.recordReplan();
    if (budgetCheck.exceeded) {
      params.stateMachine.transition('ABORTED', 'REPLAN_BUDGET_EXCEEDED', {
        reason: budgetCheck.message,
      });
      return {
        replanned: false,
        replan_count: params.budgetTracker.getUsage().replans,
        error: budgetCheck.message,
      };
    }

    // 2. Transition through PLAN_INVALIDATED -> REPLAN -> PLAN
    params.stateMachine.transition('PLAN_INVALIDATED', 'ASSUMPTIONS_BROKEN', {
      invalidation_reason: params.invalidationReason,
    });

    const activePlan = getActivePlanByRunId(params.runId);
    if (activePlan) {
      updateAgentPlanStatus(activePlan.id, 'INVALIDATED', params.invalidationReason);
    }

    params.stateMachine.transition('REPLAN', 'TRIGGER_REPLAN_ENGINE', {
      replan_number: params.budgetTracker.getUsage().replans,
    });

    params.stateMachine.transition('PLAN', 'NEW_PLAN_CREATION');

    // 3. Create revised plan version N+1
    const newVersion = (activePlan?.plan_version || 1) + 1;
    const planResult = AgentPlanner.createPlan({
      runId: params.runId,
      goal: { type: 'RECOVER_PAYMENT', desired_outcome: `Replanned recovery for ${params.opportunity.id}` },
      opportunity: params.opportunity,
      score: params.score,
      gatewayHealth: params.currentGatewayHealth,
      capacityAvailable: params.currentCapacityAvailable,
      planVersion: newVersion,
    });

    AgentMemoryStore.addWorkingMemory({
      runId: params.runId,
      opportunityId: params.opportunity.id,
      summary: `Replanned mission (v${newVersion}): ${params.invalidationReason} -> Preferred action: ${planResult.plan.preferred_action}`,
      provenance: 'AgentReplanEngine',
      semanticKey: 'replan_record',
      semanticValue: JSON.stringify({ oldPlanId: activePlan?.id, newPlanId: planResult.plan.id }),
    });

    AgentTelemetry.logStep({
      runId: params.runId,
      stepNumber: 101 + newVersion,
      state: 'PLAN',
      observation: `Plan v${activePlan?.plan_version || 1} invalidated: ${params.invalidationReason}`,
      thought: `Constructed revised Plan v${newVersion} with preferred action '${planResult.plan.preferred_action}'.`,
      actionType: 'PLAN_CREATED',
      actionPayload: { plan_id: planResult.plan.id, version: newVersion },
    });

    return {
      replanned: true,
      old_plan_id: activePlan?.id,
      new_plan: planResult.plan,
      replan_count: params.budgetTracker.getUsage().replans,
      invalidation_reason: params.invalidationReason,
    };
  }
}
