import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CausalAnalysisEngine } from '../../src/truth/causal_analysis_engine.js';
import { runAllCausalExperiments } from '../../scripts/run_causal_experiments.js';

describe('CTRL v5.1 — Causal Statistics Engine & Integrity Tests', () => {
  describe('1. Mathematical Calculations & Strict Zero-Variance Handling', () => {
    it('Case A: Constant positive difference (diff = [1,1,1,1,1]) -> d_z is UNDEFINED_ZERO_VARIANCE', () => {
      const obs = [
        { seed_id: 1, control_val: 1, treatment_val: 2 },
        { seed_id: 2, control_val: 2, treatment_val: 3 },
        { seed_id: 3, control_val: 3, treatment_val: 4 },
        { seed_id: 4, control_val: 4, treatment_val: 5 },
        { seed_id: 5, control_val: 5, treatment_val: 6 },
      ];

      const stats = CausalAnalysisEngine.computePairedStatistics({
        experiment_id: 'TEST_CONST_DIFF_A',
        component: 'Synthetic Test',
        hypothesis: 'Constant delta of +1.0 across all seeds',
        metric_name: 'Synthetic Unit',
        metric_unit: 'units',
        higher_is_better: true,
        control_definition: 'Control',
        treatment_definition: 'Treatment',
        observations: obs,
      });

      assert.strictEqual(stats.sample_size, 5);
      assert.strictEqual(stats.paired_difference.mean, 1.0);
      assert.strictEqual(stats.paired_difference.median, 1.0);
      assert.strictEqual(stats.paired_difference.std, 0.0);
      assert.strictEqual(stats.paired_difference.standard_error, 0.0);
      assert.strictEqual(stats.classification, 'POSITIVE_EFFECT');
      assert.strictEqual(stats.effect_size.value, null);
      assert.strictEqual(stats.effect_size.status, 'UNDEFINED_ZERO_VARIANCE');
      assert.strictEqual(stats.effect_size.is_defined, false);
      assert.strictEqual(stats.confidence_interval_95.status, 'DEGENERATE_ZERO_VARIANCE');
      assert.strictEqual(stats.confidence_interval_95.lower, 1.0);
      assert.strictEqual(stats.confidence_interval_95.upper, 1.0);
    });

    it('Case B: Constant negative difference (diff = [-1,-1,-1,-1,-1]) -> d_z is UNDEFINED_ZERO_VARIANCE', () => {
      const obs = [
        { seed_id: 1, control_val: 2, treatment_val: 1 },
        { seed_id: 2, control_val: 3, treatment_val: 2 },
        { seed_id: 3, control_val: 4, treatment_val: 3 },
        { seed_id: 4, control_val: 5, treatment_val: 4 },
        { seed_id: 5, control_val: 6, treatment_val: 5 },
      ];

      const stats = CausalAnalysisEngine.computePairedStatistics({
        experiment_id: 'TEST_CONST_DIFF_B',
        component: 'Synthetic Test',
        hypothesis: 'Constant delta of -1.0 across all seeds',
        metric_name: 'Synthetic Unit',
        metric_unit: 'units',
        higher_is_better: true, // Higher is better, so -1 is NEGATIVE_EFFECT
        control_definition: 'Control',
        treatment_definition: 'Treatment',
        observations: obs,
      });

      assert.strictEqual(stats.paired_difference.mean, -1.0);
      assert.strictEqual(stats.paired_difference.std, 0.0);
      assert.strictEqual(stats.classification, 'NEGATIVE_EFFECT');
      assert.strictEqual(stats.effect_size.value, null);
      assert.strictEqual(stats.effect_size.status, 'UNDEFINED_ZERO_VARIANCE');
      assert.strictEqual(stats.confidence_interval_95.status, 'DEGENERATE_ZERO_VARIANCE');
    });

    it('Case C: Zero difference (diff = [0,0,0,0,0]) -> NO_EFFECT classification', () => {
      const obs = [
        { seed_id: 1, control_val: 50, treatment_val: 50 },
        { seed_id: 2, control_val: 60, treatment_val: 60 },
        { seed_id: 3, control_val: 70, treatment_val: 70 },
        { seed_id: 4, control_val: 80, treatment_val: 80 },
        { seed_id: 5, control_val: 90, treatment_val: 90 },
      ];

      const stats = CausalAnalysisEngine.computePairedStatistics({
        experiment_id: 'TEST_ZERO_DIFF_C',
        component: 'No-op Filter',
        hypothesis: 'No difference between groups',
        metric_name: 'Output',
        metric_unit: 'units',
        higher_is_better: true,
        control_definition: 'Control',
        treatment_definition: 'Treatment',
        observations: obs,
      });

      assert.strictEqual(stats.paired_difference.mean, 0.0);
      assert.strictEqual(stats.effect_size.value, null);
      assert.strictEqual(stats.effect_size.status, 'UNDEFINED_ZERO_VARIANCE');
      assert.strictEqual(stats.classification, 'NO_EFFECT');
    });

    it('Case D: Non-zero variance (diff = [1,2,3,4,5]) -> d_z is DEFINED normally', () => {
      const obs = [
        { seed_id: 1, control_val: 10, treatment_val: 11 },
        { seed_id: 2, control_val: 10, treatment_val: 12 },
        { seed_id: 3, control_val: 10, treatment_val: 13 },
        { seed_id: 4, control_val: 10, treatment_val: 14 },
        { seed_id: 5, control_val: 10, treatment_val: 15 },
      ];

      const stats = CausalAnalysisEngine.computePairedStatistics({
        experiment_id: 'TEST_NORMAL_DIFF_D',
        component: 'Graded Lift',
        hypothesis: 'Differences [1,2,3,4,5]',
        metric_name: 'Score',
        metric_unit: 'points',
        higher_is_better: true,
        control_definition: 'Control',
        treatment_definition: 'Treatment',
        observations: obs,
      });

      assert.strictEqual(stats.paired_difference.mean, 3.0);
      assert.strictEqual(stats.paired_difference.median, 3.0);
      assert.strictEqual(Number(stats.paired_difference.std.toFixed(4)), 1.5811);
      assert.strictEqual(stats.effect_size.value, 1.897);
      assert.strictEqual(stats.effect_size.status, 'DEFINED');
      assert.strictEqual(stats.effect_size.is_defined, true);
      assert.strictEqual(stats.confidence_interval_95.status, 'DEFINED');
      assert.strictEqual(stats.classification, 'POSITIVE_EFFECT');
    });

    it('Inverted metric (lower is better, e.g. latency or error)', () => {
      const obs = [
        { seed_id: 1, control_val: 100, treatment_val: 60 },
        { seed_id: 2, control_val: 110, treatment_val: 70 },
        { seed_id: 3, control_val: 120, treatment_val: 80 },
        { seed_id: 4, control_val: 130, treatment_val: 90 },
        { seed_id: 5, control_val: 140, treatment_val: 100 },
      ];

      const stats = CausalAnalysisEngine.computePairedStatistics({
        experiment_id: 'TEST_INVERTED_METRIC',
        component: 'Latency Reducer',
        hypothesis: 'Treatment reduces latency by 40ms',
        metric_name: 'Latency',
        metric_unit: 'ms',
        higher_is_better: false, // Lower latency is better!
        control_definition: 'Sequential',
        treatment_definition: 'Concurrent',
        observations: obs,
      });

      assert.strictEqual(stats.paired_difference.mean, -40.0);
      assert.strictEqual(stats.classification, 'POSITIVE_EFFECT'); // Reduction in latency is POSITIVE
      assert.strictEqual(stats.percent_change, -33.33);
    });

    it('Rejects sample size N < 2', () => {
      assert.throws(() => {
        CausalAnalysisEngine.computePairedStatistics({
          experiment_id: 'TEST_UNDERSIZED',
          component: 'Invalid N',
          hypothesis: 'Should throw',
          metric_name: 'Val',
          metric_unit: 'u',
          higher_is_better: true,
          control_definition: 'C',
          treatment_definition: 'T',
          observations: [{ seed_id: 1, control_val: 10, treatment_val: 20 }],
        });
      }, /at least N=2/);
    });
  });

  describe('2. Benchmark Reproducibility & Integrity Across Runs', () => {
    it('should produce identical raw observations and statistical summaries on repeated execution', async () => {
      const runA = await runAllCausalExperiments();
      const runB = await runAllCausalExperiments();

      assert.strictEqual(runA.total_experiments_conducted, runB.total_experiments_conducted);
      assert.strictEqual(runA.configuration_hash, runB.configuration_hash);

      for (const [expId, expA] of Object.entries(runA.experiments)) {
        const expB = runB.experiments[expId];
        assert.ok(expB, `Experiment ${expId} missing in Run B`);

        // Exact equality on summary metrics
        assert.strictEqual(expA.statistics.paired_difference.mean, expB.statistics.paired_difference.mean);
        assert.strictEqual(expA.statistics.effect_size.value, expB.statistics.effect_size.value);
        assert.strictEqual(expA.statistics.effect_size.status, expB.statistics.effect_size.status);
        assert.strictEqual(expA.statistics.classification, expB.statistics.classification);
        assert.strictEqual(expA.statistics.experiment_fingerprint, expB.statistics.experiment_fingerprint);

        // Exact equality on raw per-seed observations
        assert.deepStrictEqual(expA.statistics.observations, expB.statistics.observations);
      }
    });

    it('should verify that all summary statistics match direct recomputations from stored raw observations', async () => {
      const report = await runAllCausalExperiments();

      for (const [expId, exp] of Object.entries(report.experiments)) {
        const raw = exp.statistics.observations;
        const n = raw.length;
        assert.strictEqual(n, 5, `Expected N=5 observations for ${expId}`);

        // Independently calculate mean difference
        const manualMeanDiff = raw.reduce((sum, o) => sum + (o.treatment_val - o.control_val), 0) / n;
        assert.strictEqual(
          Number(manualMeanDiff.toFixed(4)),
          exp.statistics.paired_difference.mean,
          `Mean diff mismatch in ${expId}`
        );

        // Independently calculate control and treatment means
        const manualMeanControl = raw.reduce((sum, o) => sum + o.control_val, 0) / n;
        const manualMeanTreatment = raw.reduce((sum, o) => sum + o.treatment_val, 0) / n;
        assert.strictEqual(
          Number(manualMeanControl.toFixed(4)),
          exp.statistics.control.mean,
          `Control mean mismatch in ${expId}`
        );
        assert.strictEqual(
          Number(manualMeanTreatment.toFixed(4)),
          exp.statistics.treatment.mean,
          `Treatment mean mismatch in ${expId}`
        );
      }
    });
  });
});
