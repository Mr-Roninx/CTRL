import { RecoveryOpportunity, Score } from '../../types/index.js';
import { runMarketAllocation } from '../../market/allocator.js';
import { ComplianceCopilot } from '../specialists/compliance_copilot.js';
import { getAllOpportunities, getAllScores } from '../../db/database.js';

export type StrategicGoalType =
  | 'MAXIMIZE_RECOVERED_REVENUE'
  | 'MINIMIZE_CUSTOMER_CHURN'
  | 'DOWNTIME_RESILIENCE'
  | 'VIP_ACCOUNTS_PRESERVATION';

export interface DecomposedTask {
  task_id: string;
  stage_name: string;
  description: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'SKIPPED';
  output_summary?: string;
}

export interface GoalExecutionPlan {
  goal_id: string;
  goal_type: StrategicGoalType;
  capacity_limit: number;
  tasks: DecomposedTask[];
  target_opportunity_ids: string[];
  estimated_recovery_paise: number;
  created_at: string;
}

export class AutonomousGoalDecomposer {
  /**
   * Decomposes a merchant strategic goal into an actionable multi-stage plan.
   */
  public static decomposeGoal(
    goalType: StrategicGoalType = 'MAXIMIZE_RECOVERED_REVENUE',
    capacity: number = 5
  ): GoalExecutionPlan {
    const goalId = `goal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const pendingOpps = getAllOpportunities().filter((o) => o.status === 'pending');
    const scores = getAllScores();
    const scoreMap = new Map<string, Score>();
    for (const s of scores) {
      scoreMap.set(s.opportunity_id, s);
    }

    const tasks: DecomposedTask[] = [
      {
        task_id: `${goalId}_task_1`,
        stage_name: 'OPPORTUNITY_DISCOVERY',
        description: `Scan and rank ${pendingOpps.length} pending opportunities by expected incremental value (IVEN).`,
        status: 'PENDING',
      },
      {
        task_id: `${goalId}_task_2`,
        stage_name: 'REGULATORY_COMPLIANCE_FILTER',
        description: 'Verify RBI contact caps, DND windows, and hard decline vetoes before allocation.',
        status: 'PENDING',
      },
      {
        task_id: `${goalId}_task_3`,
        stage_name: 'RECOVERY_MARKET_ALLOCATION',
        description: `Execute greedy allocation under strict capacity limit of ${capacity} payment links.`,
        status: 'PENDING',
      },
      {
        task_id: `${goalId}_task_4`,
        stage_name: 'DISPATCH_ACTION_AUTHORITY',
        description: 'Dispatch authorized payment links and outreach communications.',
        status: 'PENDING',
      },
      {
        task_id: `${goalId}_task_5`,
        stage_name: 'DEFER_UNALLOCATED_OPPORTUNITIES',
        description: 'Preserve capacity budget by queuing deferred items for subsequent execution cycle.',
        status: 'PENDING',
      },
    ];

    // Filter compliant candidates
    const compliantOpps = pendingOpps.filter((opp) => {
      const comp = ComplianceCopilot.checkPreExecutionCompliance(opp);
      return comp.can_proceed;
    });

    // Estimate recovery value
    const estimatedValue = compliantOpps.slice(0, capacity).reduce((sum, o) => {
      const s = scoreMap.get(o.id);
      return sum + (s?.expected_incremental_value_paise || Math.round(o.amount_paise * 0.35));
    }, 0);

    return {
      goal_id: goalId,
      goal_type: goalType,
      capacity_limit: capacity,
      tasks,
      target_opportunity_ids: compliantOpps.slice(0, capacity).map((o) => o.id),
      estimated_recovery_paise: estimatedValue,
      created_at: new Date().toISOString(),
    };
  }
}
