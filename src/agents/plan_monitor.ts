import { AgentPlanRecord, PlanValidityAssumption, PlanMonitorResult } from './types.js';
import { getActivePlanByRunId, getOpportunityById } from '../db/database.js';

/**
 * CTRL v5.1 — Plan Monitor
 *
 * Continuously evaluates active plan assumptions against current environment.
 * Returns plan validity status and triggers REPLAN when assumptions fail.
 *
 * Monitors:
 *   - gateway health
 *   - elapsed time vs plan expiry
 *   - opportunity status changes
 *   - capacity availability
 *   - assumption validity
 *
 * The Plan Monitor is advisory — it recommends CONTINUE, REPLAN, or ABORT.
 * The Replan Engine makes the actual replanning decision.
 */
export class PlanMonitor {

  // Maximum plan age before considered stale (ms)
  private static readonly MAX_PLAN_AGE_MS = 300_000; // 5 minutes

  // Maximum time a plan can be in ACTIVE state without re-evaluation (ms)
  private static readonly REEVAL_INTERVAL_MS = 60_000; // 1 minute

  /**
   * Check an active plan against current environment conditions.
   */
  public static check(params: {
    plan: AgentPlanRecord;
    currentGatewayHealth: number;
    currentCapacityAvailable: number;
    currentOpportunityStatus?: string;
  }): PlanMonitorResult {
    const now = new Date();
    const planCreatedAt = new Date(params.plan.created_at);
    const elapsedMs = now.getTime() - planCreatedAt.getTime();
    const violatedAssumptions: string[] = [];

    // -----------------------------------------------------------------------
    // Check each validity assumption
    // -----------------------------------------------------------------------
    for (const assumption of params.plan.validity_assumptions) {
      const currentValue = this.getCurrentValue(assumption, params);
      const expectedNum = typeof assumption.expected_value === 'number' ? assumption.expected_value : Number(assumption.expected_value) || 0;
      const isNowValid = this.evaluateCondition(
        currentValue,
        assumption.condition,
        expectedNum
      );

      if (!isNowValid) {
        violatedAssumptions.push(
          `${assumption.parameter}: expected ${assumption.condition} ${assumption.expected_value}, got ${currentValue}`
        );
      }
    }

    // -----------------------------------------------------------------------
    // Check plan staleness
    // -----------------------------------------------------------------------
    if (elapsedMs > this.MAX_PLAN_AGE_MS) {
      violatedAssumptions.push(
        `plan_age: ${(elapsedMs / 1000).toFixed(0)}s exceeds maximum ${(this.MAX_PLAN_AGE_MS / 1000).toFixed(0)}s`
      );
    }

    // -----------------------------------------------------------------------
    // Check opportunity status consistency
    // -----------------------------------------------------------------------
    if (params.currentOpportunityStatus &&
        ['recovered', 'blocked', 'not_recovered'].includes(params.currentOpportunityStatus)) {
      violatedAssumptions.push(
        `opportunity_status: '${params.currentOpportunityStatus}' is terminal — plan no longer applicable`
      );
    }

    // -----------------------------------------------------------------------
    // Determine recommendation
    // -----------------------------------------------------------------------
    let recommendation: PlanMonitorResult['recommendation'];
    if (violatedAssumptions.length === 0) {
      recommendation = 'CONTINUE';
    } else if (params.currentOpportunityStatus &&
               ['recovered', 'blocked', 'not_recovered'].includes(params.currentOpportunityStatus)) {
      recommendation = 'ABORT';
    } else {
      recommendation = 'REPLAN';
    }

    return {
      plan_id: params.plan.id,
      run_id: params.plan.run_id,
      is_still_valid: violatedAssumptions.length === 0,
      violated_assumptions: violatedAssumptions,
      elapsed_ms: elapsedMs,
      recommendation,
      checked_at: now.toISOString(),
    };
  }

  /**
   * Resolve the current value for a given assumption parameter.
   */
  private static getCurrentValue(
    assumption: PlanValidityAssumption,
    params: {
      currentGatewayHealth: number;
      currentCapacityAvailable: number;
      currentOpportunityStatus?: string;
    }
  ): number {
    switch (assumption.parameter) {
      case 'gateway_health':
        return params.currentGatewayHealth;
      case 'capacity_available':
        return params.currentCapacityAvailable;
      case 'attempt_count':
        return typeof assumption.current_value === 'number' ? assumption.current_value : (Number(assumption.current_value) || 0);
      default:
        return typeof assumption.current_value === 'number' ? assumption.current_value : (Number(assumption.current_value) || 0);
    }
  }

  /**
   * Evaluate a comparison condition.
   */
  private static evaluateCondition(current: number, condition: string, expected: number): boolean {
    switch (condition) {
      case '>=': return current >= expected;
      case '>':  return current > expected;
      case '<=': return current <= expected;
      case '<':  return current < expected;
      case '==': return current === expected;
      case '!=': return current !== expected;
      default:   return true;
    }
  }
}
