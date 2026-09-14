import { DatabaseAdapter } from '../db/adapter.js';

export const STATIC_PROBABILITY_TABLE: Record<string, { natural_recovery_prob: number; intervention_recovery_prob: number }> = {
  insufficient_funds: { natural_recovery_prob: 0.35, intervention_recovery_prob: 0.55 },
  expired_card: { natural_recovery_prob: 0.05, intervention_recovery_prob: 0.60 },
  generic_decline: { natural_recovery_prob: 0.25, intervention_recovery_prob: 0.45 },
  network_error: { natural_recovery_prob: 0.45, intervention_recovery_prob: 0.75 },
  bank_gateway_timeout: { natural_recovery_prob: 0.60, intervention_recovery_prob: 0.70 },
  hard_decline: { natural_recovery_prob: 0.02, intervention_recovery_prob: 0.02 },
  default: { natural_recovery_prob: 0.15, intervention_recovery_prob: 0.35 },
};

export interface BetaDistribution {
  alpha: number;
  beta: number;
  expected: number;
  sampleSize: number;
}

export interface CalibratedModelRecord {
  reason_code: string;
  p_natural_mean: number;
  p_interv_mean: number;
  sample_size: number;
  model_type: 'STATIC' | 'CALIBRATED';
  status: 'ACTIVE' | 'CANDIDATE';
  lift_vs_baseline: number;
  p_value: number;
  updated_at: string;
}

export interface BayesianPriorRecord {
  id: string;
  tenant_id: string;
  reason_code: string;
  alpha_natural: number;
  beta_natural: number;
  alpha_interv: number;
  beta_interv: number;
  sample_size: number;
  updated_at: string;
}

export class BayesianProbabilityCalibrator {
  public static async initTable(db?: DatabaseAdapter): Promise<void> {
    const adapter = db || DatabaseAdapter.getInstance();
    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS probability_models (
        reason_code TEXT PRIMARY KEY,
        p_natural_mean REAL NOT NULL,
        p_interv_mean REAL NOT NULL,
        sample_size INTEGER NOT NULL,
        model_type TEXT NOT NULL CHECK(model_type IN ('STATIC', 'CALIBRATED')),
        status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'CANDIDATE')),
        lift_vs_baseline REAL NOT NULL DEFAULT 0.0,
        p_value REAL NOT NULL DEFAULT 1.0,
        updated_at TEXT NOT NULL
      );
    `);

    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS bayesian_priors (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default',
        reason_code TEXT NOT NULL,
        alpha_natural REAL NOT NULL,
        beta_natural REAL NOT NULL,
        alpha_interv REAL NOT NULL,
        beta_interv REAL NOT NULL,
        sample_size INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        UNIQUE(tenant_id, reason_code)
      );
    `);
  }

  /**
   * Persists updated Beta parameters to bayesian_priors table.
   */
  public static async persistPrior(
    tenantId: string,
    reasonCode: string,
    alphaNatural: number,
    betaNatural: number,
    alphaInterv: number,
    betaInterv: number,
    sampleSize: number
  ): Promise<void> {
    const adapter = DatabaseAdapter.getInstance();
    await this.initTable(adapter);
    const now = new Date().toISOString();
    const id = `prior_${tenantId}_${reasonCode}`;

    await adapter.execute(
      `INSERT INTO bayesian_priors (id, tenant_id, reason_code, alpha_natural, beta_natural, alpha_interv, beta_interv, sample_size, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, reason_code) DO UPDATE SET
         alpha_natural = excluded.alpha_natural,
         beta_natural = excluded.beta_natural,
         alpha_interv = excluded.alpha_interv,
         beta_interv = excluded.beta_interv,
         sample_size = excluded.sample_size,
         updated_at = excluded.updated_at;`,
      [id, tenantId, reasonCode, alphaNatural, betaNatural, alphaInterv, betaInterv, sampleSize, now]
    );
  }

  /**
   * Loads persisted priors from database into hot cache.
   */
  public static async loadPriorsFromDatabase(tenantId: string = 'tenant_system_default'): Promise<void> {
    const adapter = DatabaseAdapter.getInstance();
    await this.initTable(adapter);

    const rows = await adapter.query<BayesianPriorRecord>(
      'SELECT * FROM bayesian_priors WHERE tenant_id = ?;',
      [tenantId]
    );

    for (const row of rows) {
      const pNatMean = row.alpha_natural / (row.alpha_natural + row.beta_natural);
      const pIntMean = row.alpha_interv / (row.alpha_interv + row.beta_interv);
      this.cache.set(row.reason_code, {
        reason_code: row.reason_code,
        p_natural_mean: Number(pNatMean.toFixed(4)),
        p_interv_mean: Number(pIntMean.toFixed(4)),
        sample_size: row.sample_size,
        model_type: row.sample_size >= 100 ? 'CALIBRATED' : 'STATIC',
        status: 'ACTIVE',
        lift_vs_baseline: 0,
        p_value: 0.05,
        updated_at: row.updated_at,
      });
    }
  }

  /**
   * Computes Bayesian posterior mean from Beta(alpha, beta) prior and observed data.
   */
  public static computeBetaPosterior(
    priorAlpha: number,
    priorBeta: number,
    successes: number,
    total: number
  ): BetaDistribution {
    const postAlpha = priorAlpha + successes;
    const postBeta = priorBeta + (total - successes);
    const expected = postAlpha / (postAlpha + postBeta);
    return {
      alpha: postAlpha,
      beta: postBeta,
      expected: Number(expected.toFixed(4)),
      sampleSize: total,
    };
  }

  /**
   * Evaluates A/B test lift and auto-promotes model if lift > 5% and p < 0.05.
   */
  public static evaluateModelPromotion(
    staticProb: number,
    calibratedProb: number,
    sampleSize: number
  ): { lift: number; pValue: number; shouldPromote: boolean } {
    if (sampleSize < 100) {
      return { lift: 0, pValue: 1.0, shouldPromote: false };
    }

    const lift = (calibratedProb - staticProb) / staticProb;
    // Standard Z-test approximation for proportion comparison
    const se = Math.sqrt((staticProb * (1 - staticProb)) / sampleSize);
    const zScore = se > 0 ? (calibratedProb - staticProb) / se : 0;
    // Two-tailed p-value approximation
    const pValue = zScore > 0 ? Math.max(0.001, 1 - 0.5 * (1 + Math.tanh(zScore * 0.797884))) : 1.0;

    const shouldPromote = lift > 0.05 && pValue < 0.05;
    return {
      lift: Number(lift.toFixed(4)),
      pValue: Number(pValue.toFixed(4)),
      shouldPromote,
    };
  }

  private static cache: Map<string, CalibratedModelRecord> = new Map();
  private static observationsCache: Map<string, { natSucc: number; natTot: number; intSucc: number; intTot: number }> = new Map();

  /**
   * Pre-populates cache from memory or records
   */
  public static preloadCache(records: CalibratedModelRecord[] = []): void {
    for (const r of records) {
      this.cache.set(r.reason_code, r);
    }
  }

  /**
   * Fast synchronous accessor for scoring pipelines.
   * Reads from hot in-memory cache with fallback to static table.
   */
  public static getEffectiveProbabilitiesSync(
    reasonCode: string,
    declineType?: string
  ): { p_natural: number; p_intervention: number; source: 'STATIC' | 'CALIBRATED'; credible_interval_95: [number, number] } {
    const normReason = (reasonCode || '').toLowerCase();

    // Invariant: Hard declines always near zero
    if (declineType === 'hard') {
      return {
        p_natural: 0.02,
        p_intervention: 0.02,
        source: 'STATIC',
        credible_interval_95: [0.01, 0.03],
      };
    }

    const cached = this.cache.get(normReason);
    if (cached && cached.sample_size >= 100 && cached.model_type === 'CALIBRATED') {
      // Calculate 95% Credible Interval using Beta variance approximation: mean ± 1.96 * sqrt(p*(1-p)/N)
      const p = cached.p_interv_mean;
      const se = Math.sqrt((p * (1 - p)) / cached.sample_size);
      const lower = Math.max(0.001, Number((p - 1.96 * se).toFixed(4)));
      const upper = Math.min(0.999, Number((p + 1.96 * se).toFixed(4)));

      return {
        p_natural: cached.p_natural_mean,
        p_intervention: cached.p_interv_mean,
        source: 'CALIBRATED',
        credible_interval_95: [lower, upper],
      };
    }

    // Static fallback lookup
    let staticBase = STATIC_PROBABILITY_TABLE[normReason];
    if (!staticBase) {
      if (normReason.includes('insufficient_funds')) staticBase = STATIC_PROBABILITY_TABLE['insufficient_funds'];
      else if (normReason.includes('expired_card') || normReason.includes('card_expired')) staticBase = STATIC_PROBABILITY_TABLE['expired_card'];
      else if (normReason.includes('bank_gateway_timeout') || normReason.includes('gateway_timeout')) staticBase = STATIC_PROBABILITY_TABLE['bank_gateway_timeout'];
      else if (normReason.includes('timeout') || normReason.includes('network')) staticBase = STATIC_PROBABILITY_TABLE['network_error'];
      else if (normReason.includes('generic_decline') || normReason.includes('do_not_honor')) staticBase = STATIC_PROBABILITY_TABLE['generic_decline'];
      else staticBase = STATIC_PROBABILITY_TABLE['default'];
    }
    const resolvedBase = staticBase ?? STATIC_PROBABILITY_TABLE['default']!;

    return {
      p_natural: resolvedBase.natural_recovery_prob,
      p_intervention: resolvedBase.intervention_recovery_prob,
      source: 'STATIC',
      credible_interval_95: [
        Math.max(0.01, Number((resolvedBase.intervention_recovery_prob - 0.10).toFixed(2))),
        Math.min(0.99, Number((resolvedBase.intervention_recovery_prob + 0.10).toFixed(2)))
      ],
    };
  }

  /**
   * Records a live recovery observation and updates posterior distributions in memory and database.
   */
  public static async recordRealtimeObservation(
    reasonCode: string,
    isRecovered: boolean,
    wasIntervention: boolean,
    tenantId: string = 'tenant_system_default'
  ): Promise<void> {
    const normReason = (reasonCode || 'generic_decline').toLowerCase();
    const cacheKey = `${tenantId}:${normReason}`;
    if (!this.observationsCache.has(cacheKey)) {
      this.observationsCache.set(cacheKey, { natSucc: 0, natTot: 0, intSucc: 0, intTot: 0 });
    }
    const obs = this.observationsCache.get(cacheKey)!;

    if (wasIntervention) {
      obs.intTot += 1;
      if (isRecovered) obs.intSucc += 1;
    } else {
      obs.natTot += 1;
      if (isRecovered) obs.natSucc += 1;
    }

    // Periodically update calibrated distributions
    if (obs.intTot + obs.natTot >= 5) {
      try {
        const updated = await this.updateCalibratedDistributions(
          normReason,
          { successes: obs.natSucc, total: obs.natTot },
          { successes: obs.intSucc, total: obs.intTot },
          tenantId
        );
        this.cache.set(normReason, updated);
      } catch (err) {
        console.warn(`⚠️ [BayesianCalibrator] Error persisting observation for ${normReason}:`, (err as any)?.message);
      }
    }
  }

  /**
   * Retrieves effective probability distribution for a decline code.
   * If calibrated model has < 100 observations, falls back to static baseline.
   */
  public static async getEffectiveProbabilities(
    reasonCode: string
  ): Promise<{ p_natural: number; p_intervention: number; source: 'STATIC' | 'CALIBRATED' }> {
    const adapter = DatabaseAdapter.getInstance();
    await this.initTable(adapter);

    const records = await adapter.query<CalibratedModelRecord>(
      `SELECT * FROM probability_models WHERE reason_code = ? AND status = 'ACTIVE' LIMIT 1;`,
      [reasonCode]
    );

    const firstRecord = records[0];
    if (firstRecord && firstRecord.sample_size >= 100 && firstRecord.model_type === 'CALIBRATED') {
      this.cache.set(reasonCode, firstRecord);
      return {
        p_natural: firstRecord.p_natural_mean,
        p_intervention: firstRecord.p_interv_mean,
        source: 'CALIBRATED',
      };
    }

    // Static fallback baseline
    const staticBase = STATIC_PROBABILITY_TABLE[reasonCode] ?? STATIC_PROBABILITY_TABLE['default']!;
    return {
      p_natural: staticBase.natural_recovery_prob,
      p_intervention: staticBase.intervention_recovery_prob,
      source: 'STATIC',
    };
  }

  /**
   * Updates probability models from observed dataset.
   */
  public static async updateCalibratedDistributions(
    reasonCode: string,
    naturalObservations: { successes: number; total: number },
    intervObservations: { successes: number; total: number },
    tenantId: string = 'tenant_system_default'
  ): Promise<CalibratedModelRecord> {
    const adapter = DatabaseAdapter.getInstance();
    await this.initTable(adapter);

    const staticBase = STATIC_PROBABILITY_TABLE[reasonCode] ?? STATIC_PROBABILITY_TABLE['default']!;
    const priorNatAlpha = staticBase.natural_recovery_prob * 10;
    const priorNatBeta = 10 - priorNatAlpha;

    const priorIntAlpha = staticBase.intervention_recovery_prob * 10;
    const priorIntBeta = 10 - priorIntAlpha;

    const postNat = this.computeBetaPosterior(
      priorNatAlpha,
      priorNatBeta,
      naturalObservations.successes,
      naturalObservations.total
    );
    const postInt = this.computeBetaPosterior(
      priorIntAlpha,
      priorIntBeta,
      intervObservations.successes,
      intervObservations.total
    );

    const totalObs = naturalObservations.total + intervObservations.total;
    const { lift, pValue, shouldPromote } = this.evaluateModelPromotion(
      staticBase.intervention_recovery_prob,
      postInt.expected,
      intervObservations.total
    );

    const modelType = totalObs >= 100 ? 'CALIBRATED' : 'STATIC';
    const status = shouldPromote || totalObs < 100 ? 'ACTIVE' : 'CANDIDATE';

    await adapter.execute(
      `INSERT INTO probability_models (reason_code, p_natural_mean, p_interv_mean, sample_size, model_type, status, lift_vs_baseline, p_value, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(reason_code) DO UPDATE SET
         p_natural_mean = excluded.p_natural_mean,
         p_interv_mean = excluded.p_interv_mean,
         sample_size = excluded.sample_size,
         model_type = excluded.model_type,
         status = excluded.status,
         lift_vs_baseline = excluded.lift_vs_baseline,
         p_value = excluded.p_value,
         updated_at = excluded.updated_at;`,
      [
        reasonCode,
        postNat.expected,
        postInt.expected,
        totalObs,
        modelType,
        status,
        lift,
        pValue,
        new Date().toISOString(),
      ]
    );

    // Persist to bayesian_priors table
    await this.persistPrior(
      tenantId,
      reasonCode,
      postNat.alpha,
      postNat.beta,
      postInt.alpha,
      postInt.beta,
      totalObs
    );

    return {
      reason_code: reasonCode,
      p_natural_mean: postNat.expected,
      p_interv_mean: postInt.expected,
      sample_size: totalObs,
      model_type: modelType,
      status,
      lift_vs_baseline: lift,
      p_value: pValue,
      updated_at: new Date().toISOString(),
    };
  }
}
