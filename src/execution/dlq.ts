import { DatabaseAdapter } from '../db/adapter.js';

export interface DLQJobRecord {
  id?: number;
  opportunity_id: string;
  failure_count: number;
  last_error: string;
  next_retry_at: string | null;
  status: 'PENDING_RETRY' | 'DEAD_LETTER' | 'RESOLVED';
  created_at: string;
  updated_at?: string;
}

// Backward-compatible alias
export type ExecutionFailureRecord = DLQJobRecord;

export class ExecutionDLQ {
  // Exponential backoff intervals in minutes: 5m, 15m, 60m (1h), 240m (4h)
  private static retryIntervalsMin = [5, 15, 60, 240];

  public static async initTable(db?: DatabaseAdapter): Promise<void> {
    const adapter = db || DatabaseAdapter.getInstance();
    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS dlq_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        opportunity_id TEXT NOT NULL,
        failure_count INTEGER NOT NULL DEFAULT 1,
        last_error TEXT NOT NULL,
        next_retry_at TEXT,
        status TEXT NOT NULL CHECK(status IN ('PENDING_RETRY', 'DEAD_LETTER', 'RESOLVED')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (opportunity_id) REFERENCES recovery_opportunities(id) ON DELETE CASCADE
      );
    `);

    // Legacy table alias support
    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS execution_failures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        opportunity_id TEXT NOT NULL,
        failure_count INTEGER NOT NULL DEFAULT 1,
        last_error TEXT NOT NULL,
        next_retry_at TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (opportunity_id) REFERENCES recovery_opportunities(id) ON DELETE CASCADE
      );
    `);
  }

  public static async recordExecutionFailure(opportunityId: string, error: string): Promise<DLQJobRecord> {
    const adapter = DatabaseAdapter.getInstance();
    await this.initTable(adapter);

    const existing = await adapter.query<DLQJobRecord>(
      'SELECT * FROM dlq_jobs WHERE opportunity_id = ? ORDER BY id DESC LIMIT 1;',
      [opportunityId]
    );

    const prevCount = existing[0]?.failure_count ?? 0;
    const newCount = prevCount + 1;
    const now = new Date().toISOString();

    let nextRetryAt: string | null = null;
    let status: 'PENDING_RETRY' | 'DEAD_LETTER' = 'PENDING_RETRY';

    if (newCount <= this.retryIntervalsMin.length) {
      const delayMin = this.retryIntervalsMin[newCount - 1] ?? 1;
      nextRetryAt = new Date(Date.now() + delayMin * 60 * 1000).toISOString();
      console.warn(`📥 ExecutionDLQ: Opportunity ${opportunityId} scheduled for retry #${newCount} in ${delayMin}m (${nextRetryAt})`);
    } else {
      status = 'DEAD_LETTER';
      console.error(`🚨 ExecutionDLQ: Opportunity ${opportunityId} dead-lettered after ${newCount} attempts. Routing to HITL review.`);

      // Automatically forward permanently failed dead-lettered opportunities to HITL queue and mark blocked
      try {
        const { HITLManager } = await import('../agents/hitl/hitl_manager.js');
        const { getOpportunityById, updateOpportunityStatus, db } = await import('../db/database.js');
        const opp = getOpportunityById(opportunityId);
        if (opp) {
          updateOpportunityStatus(opportunityId, 'blocked');
          db.prepare('UPDATE recovery_opportunities SET attempt_count = ? WHERE id = ?').run(newCount, opportunityId);
          HITLManager.createRequest({
            opportunity: opp,
            proposedAction: 'ACT',
            reason: 'EXECUTION_DLQ_EXHAUSTED',
            explanation: `Execution exhausted ${newCount} retries. Final error: ${error.slice(0, 200)}`,
          });
        }
      } catch (hitlErr: any) {
        console.warn('⚠️ Could not forward DLQ failure to HITL manager:', hitlErr?.message);
      }
    }

    // Resolve or supersede any prior pending records for this opportunity to prevent infinite replay loops
    await adapter.execute(
      `UPDATE dlq_jobs SET status = 'SUPERSEDED', updated_at = ? WHERE opportunity_id = ? AND status = 'PENDING_RETRY';`,
      [now, opportunityId]
    ).catch(() => {});

    await adapter.execute(
      `INSERT INTO dlq_jobs (opportunity_id, failure_count, last_error, next_retry_at, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [opportunityId, newCount, error, nextRetryAt, status, now, now]
    );

    // Keep legacy table synchronized
    await adapter.execute(
      `INSERT INTO execution_failures (opportunity_id, failure_count, last_error, next_retry_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?);`,
      [opportunityId, newCount, error, nextRetryAt, status === 'DEAD_LETTER' ? 'PERMANENTLY_FAILED' : 'PENDING_RETRY', now]
    ).catch(() => {});

    return {
      opportunity_id: opportunityId,
      failure_count: newCount,
      last_error: error,
      next_retry_at: nextRetryAt,
      status,
      created_at: now,
      updated_at: now,
    };
  }

  public static async markRetrySuccess(opportunityId: string): Promise<void> {
    const adapter = DatabaseAdapter.getInstance();
    await this.initTable(adapter);
    const now = new Date().toISOString();

    await adapter.execute(
      `UPDATE dlq_jobs SET status = 'RESOLVED', updated_at = ? WHERE opportunity_id = ? AND status = 'PENDING_RETRY';`,
      [now, opportunityId]
    );
  }

  public static async getPendingRetries(): Promise<DLQJobRecord[]> {
    const adapter = DatabaseAdapter.getInstance();
    await this.initTable(adapter);

    const now = new Date().toISOString();
    return adapter.query<DLQJobRecord>(
      `SELECT * FROM dlq_jobs WHERE status = 'PENDING_RETRY' AND next_retry_at <= ? ORDER BY next_retry_at ASC;`,
      [now]
    );
  }

  /**
   * Sweeps DLQ and replays due retries idempotently.
   */
  public static async replayPendingRetries(limit: number = 10): Promise<{ replayed: number; errors: number }> {
    const pending = await this.getPendingRetries();
    const batch = pending.slice(0, limit);
    let replayed = 0;
    let errors = 0;

    for (const job of batch) {
      try {
        const { executeOpportunity } = await import('./executor.js');
        const res = await executeOpportunity(job.opportunity_id);
        if (res.success) {
          await this.markRetrySuccess(job.opportunity_id);
          replayed++;
        } else {
          await this.recordExecutionFailure(job.opportunity_id, res.error || 'Retry execution failed');
          errors++;
        }
      } catch (err: any) {
        await this.recordExecutionFailure(job.opportunity_id, err?.message || 'Unexpected retry crash');
        errors++;
      }
    }

    return { replayed, errors };
  }
}

export const replayPendingRetries = (limit?: number) => ExecutionDLQ.replayPendingRetries(limit);
