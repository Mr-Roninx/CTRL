import { DatabaseSync } from 'node:sqlite';
import { Score } from '../../types/index.js';

export interface ProbabilityModelRecord {
  reason_code: string;
  tenant_id: string;
  p_natural_mean: number;
  p_interv_mean: number;
  sample_size: number;
  model_type: 'STATIC' | 'CALIBRATED';
  status: 'ACTIVE' | 'CANDIDATE';
  lift_vs_baseline: number;
  p_value: number;
  updated_at: string;
}

export interface BanditArmRecord {
  id: string;
  tenant_id: string;
  context_key: string;
  alpha_interv: number;
  beta_interv: number;
  alpha_nat: number;
  beta_nat: number;
  pull_count: number;
  reward_sum: number;
  updated_at: string;
}

export class ScoreRepository {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  public getByOpportunityId(opportunityId: string): Score | undefined {
    const stmt = this.db.prepare('SELECT * FROM scores WHERE opportunity_id = ?');
    return stmt.get(opportunityId) as unknown as Score | undefined;
  }

  public upsert(score: Score): void {
    const stmt = this.db.prepare(`
      INSERT INTO scores (
        opportunity_id, natural_recovery_prob, intervention_recovery_prob, incremental_prob,
        operational_cost_paise, fatigue_cost_paise, expected_incremental_value_paise, confidence
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?, ?
      )
      ON CONFLICT(opportunity_id) DO UPDATE SET
        natural_recovery_prob = excluded.natural_recovery_prob,
        intervention_recovery_prob = excluded.intervention_recovery_prob,
        incremental_prob = excluded.incremental_prob,
        operational_cost_paise = excluded.operational_cost_paise,
        fatigue_cost_paise = excluded.fatigue_cost_paise,
        expected_incremental_value_paise = excluded.expected_incremental_value_paise,
        confidence = excluded.confidence
    `);

    stmt.run(
      score.opportunity_id,
      score.natural_recovery_prob,
      score.intervention_recovery_prob,
      score.incremental_prob,
      score.operational_cost_paise,
      score.fatigue_cost_paise,
      score.expected_incremental_value_paise,
      score.confidence
    );
  }

  public getAll(tenantId?: string): (Score & { opportunity_id: string })[] {
    if (tenantId) {
      const stmt = this.db.prepare(`
        SELECT s.* FROM scores s
        JOIN recovery_opportunities ro ON s.opportunity_id = ro.id
        WHERE ro.tenant_id = ? OR ro.merchant_id = ?
      `);
      return stmt.all(tenantId, tenantId) as unknown as (Score & { opportunity_id: string })[];
    }
    const stmt = this.db.prepare('SELECT * FROM scores');
    return stmt.all() as unknown as (Score & { opportunity_id: string })[];
  }

  public getProbabilityModel(reasonCode: string, tenantId: string = 'tenant_system_default'): ProbabilityModelRecord | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM probability_models 
      WHERE reason_code = ? AND (tenant_id = ? OR tenant_id = 'tenant_system_default')
      ORDER BY CASE WHEN tenant_id = ? THEN 1 ELSE 2 END
      LIMIT 1
    `);
    return stmt.get(reasonCode, tenantId, tenantId) as unknown as ProbabilityModelRecord | undefined;
  }

  public upsertProbabilityModel(model: ProbabilityModelRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO probability_models (
        reason_code, tenant_id, p_natural_mean, p_interv_mean, sample_size,
        model_type, status, lift_vs_baseline, p_value, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
      ON CONFLICT(reason_code) DO UPDATE SET
        tenant_id = excluded.tenant_id,
        p_natural_mean = excluded.p_natural_mean,
        p_interv_mean = excluded.p_interv_mean,
        sample_size = excluded.sample_size,
        model_type = excluded.model_type,
        status = excluded.status,
        lift_vs_baseline = excluded.lift_vs_baseline,
        p_value = excluded.p_value,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      model.reason_code,
      model.tenant_id,
      model.p_natural_mean,
      model.p_interv_mean,
      model.sample_size,
      model.model_type,
      model.status,
      model.lift_vs_baseline,
      model.p_value,
      model.updated_at
    );
  }

  public getBanditArm(contextKey: string, tenantId: string = 'tenant_system_default'): BanditArmRecord | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM bandit_arms 
      WHERE context_key = ? AND tenant_id = ?
      LIMIT 1
    `);
    return stmt.get(contextKey, tenantId) as unknown as BanditArmRecord | undefined;
  }

  public upsertBanditArm(arm: BanditArmRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO bandit_arms (
        id, tenant_id, context_key, alpha_interv, beta_interv,
        alpha_nat, beta_nat, pull_count, reward_sum, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
      ON CONFLICT(tenant_id, context_key) DO UPDATE SET
        alpha_interv = excluded.alpha_interv,
        beta_interv = excluded.beta_interv,
        alpha_nat = excluded.alpha_nat,
        beta_nat = excluded.beta_nat,
        pull_count = excluded.pull_count,
        reward_sum = excluded.reward_sum,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      arm.id,
      arm.tenant_id,
      arm.context_key,
      arm.alpha_interv,
      arm.beta_interv,
      arm.alpha_nat,
      arm.beta_nat,
      arm.pull_count,
      arm.reward_sum,
      arm.updated_at
    );
  }
}
