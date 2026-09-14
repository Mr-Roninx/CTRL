import { DatabaseSync } from 'node:sqlite';
import { AllocationDecision } from '../../types/index.js';

export interface PacingBanditLogRecord {
  id: string;
  tenant_id: string;
  time_window: string;
  pacing_arm: string;
  lambda_applied: number;
  spent_paise: number;
  budget_paise: number;
  reward: number;
  created_at: string;
}

export class AllocationRepository {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  public getByOpportunityId(oppId: string): AllocationDecision | undefined {
    const stmt = this.db.prepare('SELECT * FROM allocation_decisions WHERE opportunity_id = ?');
    return stmt.get(oppId) as unknown as AllocationDecision | undefined;
  }

  public upsert(decision: AllocationDecision): void {
    const stmt = this.db.prepare(`
      INSERT INTO allocation_decisions (
        opportunity_id, decision, rank_in_batch, shadow_price_paise_at_decision, reason
      ) VALUES (
        ?, ?, ?, ?, ?
      )
      ON CONFLICT(opportunity_id) DO UPDATE SET
        decision = excluded.decision,
        rank_in_batch = excluded.rank_in_batch,
        shadow_price_paise_at_decision = excluded.shadow_price_paise_at_decision,
        reason = excluded.reason
    `);

    stmt.run(
      decision.opportunity_id,
      decision.decision,
      decision.rank_in_batch,
      decision.shadow_price_paise_at_decision,
      decision.reason
    );
  }

  public getAll(tenantId?: string): AllocationDecision[] {
    if (tenantId) {
      const stmt = this.db.prepare(`
        SELECT ad.* FROM allocation_decisions ad
        JOIN recovery_opportunities ro ON ad.opportunity_id = ro.id
        WHERE ro.tenant_id = ? OR ro.merchant_id = ?
        ORDER BY ad.rank_in_batch ASC
      `);
      return stmt.all(tenantId, tenantId) as unknown as AllocationDecision[];
    }
    const stmt = this.db.prepare('SELECT * FROM allocation_decisions ORDER BY rank_in_batch ASC');
    return stmt.all() as unknown as AllocationDecision[];
  }

  public logPacingBandit(log: PacingBanditLogRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO pacing_bandit_logs (
        id, tenant_id, time_window, pacing_arm, lambda_applied,
        spent_paise, budget_paise, reward, created_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `);
    stmt.run(
      log.id,
      log.tenant_id,
      log.time_window,
      log.pacing_arm,
      log.lambda_applied,
      log.spent_paise,
      log.budget_paise,
      log.reward,
      log.created_at
    );
  }

  public getPacingBanditLogs(tenantId: string = 'tenant_system_default', limit: number = 50): PacingBanditLogRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM pacing_bandit_logs
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    return stmt.all(tenantId, limit) as unknown as PacingBanditLogRecord[];
  }
}
