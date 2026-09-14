import { db } from '../db/database.js';

export interface MissionLifecycleSweepResult {
  total_inspected: number;
  active_retained_count: number;
  stale_aborted_count: number;
  details: {
    run_id: string;
    mission_id: string;
    action_taken: 'RETAINED_ACTIVE' | 'ABORTED_STALE';
    inactivity_ms: number;
    reason: string;
  }[];
}

export class MissionLifecycleMonitor {
  /**
   * Sweeps running agent missions and safely transitions stale/orphan missions
   * to ABORTED with a durable audit trail.
   */
  public static sweepStaleMissions(options: {
    inactivityThresholdMs?: number;
    actor?: string;
  } = {}): MissionLifecycleSweepResult {
    const thresholdMs = options.inactivityThresholdMs ?? 5 * 60 * 1000; // 5 minutes
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    const runningRuns = db.prepare(`
      SELECT * FROM agent_runs WHERE status = 'running';
    `).all() as Array<{
      id: string;
      mission_id: string;
      opportunity_id: string | null;
      start_time: string;
      created_at: string;
      total_steps: number;
    }>;

    const details: MissionLifecycleSweepResult['details'] = [];
    let stale_aborted_count = 0;
    let active_retained_count = 0;

    for (const run of runningRuns) {
      const createdTime = new Date(run.created_at || run.start_time).getTime();
      const inactivityMs = now - createdTime;

      // Check if there is a recent step
      const latestStep = db.prepare(`
        SELECT timestamp FROM agent_steps WHERE run_id = ? ORDER BY step_number DESC LIMIT 1;
      `).get(run.id) as { timestamp: string } | undefined;

      const lastActivityTime = latestStep ? new Date(latestStep.timestamp).getTime() : createdTime;
      const actualInactivityMs = now - lastActivityTime;

      // Check if there is a valid persisted wake condition or active wait
      const activeWaitMemory = db.prepare(`
        SELECT context_summary FROM agent_memories
        WHERE run_id = ? AND memory_type = 'working' AND context_summary LIKE '%wake%' LIMIT 1;
      `).get(run.id) as { context_summary: string } | undefined;

      if (activeWaitMemory) {
        active_retained_count++;
        details.push({
          run_id: run.id,
          mission_id: run.mission_id,
          action_taken: 'RETAINED_ACTIVE',
          inactivity_ms: actualInactivityMs,
          reason: `Mission has active persisted wake condition: ${activeWaitMemory.context_summary}`,
        });
        continue;
      }

      if (actualInactivityMs > thresholdMs) {
        // Safe transition to ABORTED with durable reason
        db.prepare(`
          UPDATE agent_runs
          SET status = 'aborted',
              end_time = ?,
              termination_reason = ?
          WHERE id = ?;
        `).run(nowIso, 'stale_orphan_cleanup: inactivity exceeded threshold without active wake condition', run.id);

        stale_aborted_count++;
        details.push({
          run_id: run.id,
          mission_id: run.mission_id,
          action_taken: 'ABORTED_STALE',
          inactivity_ms: actualInactivityMs,
          reason: `Inactivity of ${(actualInactivityMs / 1000).toFixed(0)}s exceeded ${(thresholdMs / 1000).toFixed(0)}s threshold. Safely terminated as ABORTED.`,
        });
      } else {
        active_retained_count++;
        details.push({
          run_id: run.id,
          mission_id: run.mission_id,
          action_taken: 'RETAINED_ACTIVE',
          inactivity_ms: actualInactivityMs,
          reason: `Mission within active window (${(actualInactivityMs / 1000).toFixed(0)}s <= ${(thresholdMs / 1000).toFixed(0)}s).`,
        });
      }
    }

    return {
      total_inspected: runningRuns.length,
      active_retained_count,
      stale_aborted_count,
      details,
    };
  }
}
