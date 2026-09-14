import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import { 
  BayesianProbabilityCalibrator
} from '../../src/economics/bayesian_calibration.js';
import { classifyIVENBand, scoreOpportunity } from '../../src/economics/scorer.js';
import { ThompsonSamplingBandit } from '../../src/economics/bandit_policy.js';
import { CausalAttributionEngine, DiffInDiffInput } from '../../src/economics/causal_attribution.js';
import type { RecoveryOpportunity } from '../../src/types/index.js';
import { DatabaseAdapter } from '../../src/db/adapter.js';
import { upsertCustomer, insertOpportunity } from '../../src/db/database.js';

describe('Phase 7: Enhanced Economic Engine Verification', () => {
  const testTenantId = `tenant_econ_test_${Date.now()}`;

  before(async () => {
    // Ensure tables exist and insert test tenant
    await BayesianProbabilityCalibrator.initTable();
    const adapter = DatabaseAdapter.getInstance();
    try {
      await adapter.execute(`
        INSERT INTO tenants (id, name, status, created_at, updated_at)
        VALUES (?, 'Economics Test Tenant', 'active', datetime('now'), datetime('now'))
        ON CONFLICT(id) DO NOTHING;
      `, [testTenantId]);
    } catch {
      // Ignored if table doesn't exist or already there
    }
  });

  describe('1. Bayesian Prior Persistence & Calibration', () => {
    test('persists and reloads prior distributions for a tenant', async () => {
      const reasonCode = 'card_network_timeout';
      
      await BayesianProbabilityCalibrator.persistPrior(
        testTenantId,
        reasonCode,
        4.0,   // alphaNatural
        16.0,  // betaNatural (mean 0.20)
        12.0,  // alphaInterv
        8.0,   // betaInterv (mean 0.60)
        40     // sampleSize
      );

      const adapter = DatabaseAdapter.getInstance();
      const rows = await adapter.query<any>(
        'SELECT * FROM bayesian_priors WHERE tenant_id = ? AND reason_code = ?;',
        [testTenantId, reasonCode]
      );

      assert.strictEqual(rows.length, 1, 'Should find persisted prior record');
      assert.strictEqual(rows[0].alpha_natural, 4.0);
      assert.strictEqual(rows[0].beta_natural, 16.0);
      assert.strictEqual(rows[0].alpha_interv, 12.0);
      assert.strictEqual(rows[0].beta_interv, 8.0);
      assert.strictEqual(rows[0].sample_size, 40);

      // Load into cache
      await BayesianProbabilityCalibrator.loadPriorsFromDatabase(testTenantId);
      const prob = BayesianProbabilityCalibrator.getEffectiveProbabilitiesSync(reasonCode);
      assert.ok(prob !== null);
    });

    test('computes posterior beta distribution correctly', () => {
      // Prior Beta(3, 3), 10 trials with 7 successes -> Posterior Beta(10, 6)
      const posterior = BayesianProbabilityCalibrator.computeBetaPosterior(3, 3, 7, 10);
      assert.strictEqual(posterior.alpha, 10);
      assert.strictEqual(posterior.beta, 6);
      assert.strictEqual(posterior.expected, Number((10 / 16).toFixed(4)));
      assert.strictEqual(posterior.sampleSize, 10);
    });

    test('records real-time observation and updates distributions', async () => {
      const reasonCode = 'insufficient_funds';
      
      // Record 5 observations to trigger auto-recalibration
      for (let i = 0; i < 5; i++) {
        await BayesianProbabilityCalibrator.recordRealtimeObservation(
          reasonCode,
          true,
          true,
          testTenantId
        );
      }

      const res = await BayesianProbabilityCalibrator.getEffectiveProbabilities(reasonCode);
      assert.ok(res.p_natural > 0);
      assert.ok(res.p_intervention > 0);
    });
  });

  describe('2. IVEN Band Classification', () => {
    test('classifies IVEN bands correctly across financial thresholds', () => {
      // STRONG: >= ₹150 (15000 paise)
      assert.strictEqual(classifyIVENBand(15000), 'STRONG');
      assert.strictEqual(classifyIVENBand(50000), 'STRONG');

      // MODERATE: >= ₹50 (5000 paise) and < ₹150
      assert.strictEqual(classifyIVENBand(5000), 'MODERATE');
      assert.strictEqual(classifyIVENBand(14999), 'MODERATE');

      // WEAK: > 0 and < ₹50
      assert.strictEqual(classifyIVENBand(1), 'WEAK');
      assert.strictEqual(classifyIVENBand(4999), 'WEAK');

      // NEGATIVE: <= 0
      assert.strictEqual(classifyIVENBand(0), 'NEGATIVE');
      assert.strictEqual(classifyIVENBand(-500), 'NEGATIVE');
    });

    test('attaches iven_band to Score output', () => {
      const oppId = `opp_econ_band_${Date.now()}`;
      const custId = `cust_econ_band_${Date.now()}`;

      const opp: RecoveryOpportunity = {
        id: oppId,
        source: 'synthetic',
        amount_paise: 150000, // ₹1,500
        currency: 'INR',
        reason_code: 'insufficient_funds',
        decline_type: 'soft',
        attempt_count: 1,
        customer_id: custId,
        customer_trust_score: 0.85,
        created_at: new Date().toISOString(),
        status: 'pending',
        tenant_id: testTenantId,
      };

      const now = new Date().toISOString();
      upsertCustomer({
        id: custId,
        trust_score: 0.85,
        created_at: now,
        updated_at: now,
      });
      insertOpportunity(opp);

      const score = scoreOpportunity(opp);
      assert.ok(score.iven_band, 'Score must include iven_band property');
      assert.ok(['STRONG', 'MODERATE', 'WEAK', 'NEGATIVE'].includes(score.iven_band));
    });
  });

  describe('3. Contextual Thompson Sampling Bandit', () => {
    const bandit = ThompsonSamplingBandit.getInstance();

    test('enforces hard decline zero incremental probability invariant', () => {
      const hardOpp: RecoveryOpportunity = {
        id: 'opp_hard_test',
        source: 'real',
        amount_paise: 500000,
        currency: 'INR',
        reason_code: 'stolen_card_pickup',
        decline_type: 'hard',
        attempt_count: 1,
        customer_id: 'cust_hard_1',
        customer_trust_score: 0.1,
        created_at: new Date().toISOString(),
        status: 'pending',
      };

      const sample = bandit.sampleProbabilities(hardOpp, testTenantId);
      assert.strictEqual(sample.is_hard_veto, true, 'Hard decline must trigger hard veto');
      assert.strictEqual(sample.p_incremental, 0.0, 'Incremental probability must be 0.0 on hard decline');
    });

    test('samples positive incremental probabilities on soft declines and updates rewards', () => {
      const softOpp: RecoveryOpportunity = {
        id: 'opp_soft_test',
        source: 'synthetic',
        amount_paise: 250000, // MID tier
        currency: 'INR',
        reason_code: 'card_network_timeout',
        decline_type: 'soft',
        attempt_count: 1,
        customer_id: 'cust_soft_1',
        customer_trust_score: 0.9,
        created_at: new Date().toISOString(),
        status: 'pending',
      };

      const sample = bandit.sampleProbabilities(softOpp, testTenantId);
      assert.strictEqual(sample.is_hard_veto, false);
      assert.ok(sample.p_intervention > 0 && sample.p_intervention < 1);
      assert.ok(sample.p_natural > 0 && sample.p_natural < 1);

      // Update reward
      const arm = bandit.updateReward({
        tenantId: testTenantId,
        contextKey: sample.context_key,
        isRecovered: true,
        isIntervention: true,
      });

      assert.ok(arm.pull_count >= 1);
      assert.ok(arm.alpha_interv > 3.0);
    });
  });

  describe('4. Causal Attribution Engine (Difference-in-Differences)', () => {
    test('computes positive Average Treatment Effect on the Treated (ATT) with significance', () => {
      const input: DiffInDiffInput = {
        // Pre-intervention baseline: both groups recover ~20%
        treatedPre: { recovered: 20, total: 100 },
        controlPre: { recovered: 21, total: 100 },
        // Post-intervention: treated jumps to 55%, control stays at 22%
        treatedPost: { recovered: 55, total: 100 },
        controlPost: { recovered: 22, total: 100 },
      };

      const result = CausalAttributionEngine.computeDiffInDiff(input);

      // Delta treated = 0.55 - 0.20 = 0.35
      // Delta control = 0.22 - 0.21 = 0.01
      // ATT = 0.35 - 0.01 = 0.34
      assert.strictEqual(result.parallel_trends_passed, true);
      assert.ok(result.att > 0.30, `Expected ATT ~0.34, got ${result.att}`);
      assert.strictEqual(result.classification, 'STATISTICALLY_SIGNIFICANT_LIFT');
      assert.strictEqual(result.is_significant, true);
      assert.ok(result.p_value < 0.05, `Expected p-value < 0.05, got ${result.p_value}`);
      assert.ok(result.causal_lift_pct > 100, 'Expected >100% causal lift over control post');
    });

    test('flags parallel trends violation when pre-treatment baseline diverged significantly', () => {
      const input: DiffInDiffInput = {
        // Pre baseline diverges by 25% (0.45 vs 0.20)
        treatedPre: { recovered: 45, total: 100 },
        controlPre: { recovered: 20, total: 100 },
        treatedPost: { recovered: 60, total: 100 },
        controlPost: { recovered: 25, total: 100 },
      };

      const result = CausalAttributionEngine.computeDiffInDiff(input);
      assert.strictEqual(result.parallel_trends_passed, false);
      assert.strictEqual(result.classification, 'PARALLEL_TRENDS_VIOLATION');
      assert.ok(result.interpretation.includes('violates parallel trends'));
    });

    test('evaluates synthetic holdout lift from an opportunity batch', () => {
      const now = Date.now();
      const cutoff = new Date(now - 10000).toISOString();

      const opps: RecoveryOpportunity[] = [
        // Pre-cutoff treated
        { id: '1', source: 'synthetic', amount_paise: 100000, currency: 'INR', reason_code: 'network_timeout', decline_type: 'soft', attempt_count: 1, customer_id: 'c1', customer_trust_score: 0.8, created_at: new Date(now - 20000).toISOString(), status: 'recovered' },
        { id: '2', source: 'synthetic', amount_paise: 100000, currency: 'INR', reason_code: 'network_timeout', decline_type: 'soft', attempt_count: 1, customer_id: 'c2', customer_trust_score: 0.8, created_at: new Date(now - 20000).toISOString(), status: 'executing' },
        // Pre-cutoff control
        { id: '3', source: 'synthetic', amount_paise: 100000, currency: 'INR', reason_code: 'network_timeout', decline_type: 'soft', attempt_count: 1, customer_id: 'c3', customer_trust_score: 0.8, created_at: new Date(now - 20000).toISOString(), status: 'abstained' },
        // Post-cutoff treated
        { id: '4', source: 'synthetic', amount_paise: 100000, currency: 'INR', reason_code: 'network_timeout', decline_type: 'soft', attempt_count: 1, customer_id: 'c4', customer_trust_score: 0.8, created_at: new Date(now - 5000).toISOString(), status: 'recovered' },
        { id: '5', source: 'synthetic', amount_paise: 100000, currency: 'INR', reason_code: 'network_timeout', decline_type: 'soft', attempt_count: 1, customer_id: 'c5', customer_trust_score: 0.8, created_at: new Date(now - 5000).toISOString(), status: 'recovered' },
        // Post-cutoff control
        { id: '6', source: 'synthetic', amount_paise: 100000, currency: 'INR', reason_code: 'network_timeout', decline_type: 'soft', attempt_count: 1, customer_id: 'c6', customer_trust_score: 0.8, created_at: new Date(now - 5000).toISOString(), status: 'abstained' },
      ];

      const res = CausalAttributionEngine.evaluateSyntheticHoldoutLift(opps, cutoff);
      assert.ok(res !== null);
      assert.strictEqual(typeof res.att, 'number');
      assert.strictEqual(typeof res.parallel_trends_passed, 'boolean');
    });
  });
});
