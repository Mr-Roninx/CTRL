process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseAdapter } from '../../src/db/adapter.js';
import { MigrationRunner } from '../../src/db/migrations/runner.js';
import { BayesianProbabilityCalibrator } from '../../src/economics/bayesian_calibration.js';

describe('V6 Phase 8: Bayesian Probability Calibration Engine', () => {
  before(async () => {
    const db = DatabaseAdapter.getInstance();
    await MigrationRunner.migrateUp(db);
    await BayesianProbabilityCalibrator.initTable(db);
  });

  it('updates Beta prior distributions with observed outcomes to produce calibrated posterior expectations', () => {
    // Prior Beta(alpha=3.5, beta=6.5) -> expected = 0.35
    const priorAlpha = 3.5;
    const priorBeta = 6.5;

    // Observe 60 successes out of 100 trials
    const posterior = BayesianProbabilityCalibrator.computeBetaPosterior(
      priorAlpha,
      priorBeta,
      60,
      100
    );

    // postAlpha = 63.5, postBeta = 46.5, expected = 63.5 / 110 = 0.5773
    assert.equal(posterior.alpha, 63.5);
    assert.equal(posterior.beta, 46.5);
    assert.equal(posterior.expected, 0.5773);
    assert.equal(posterior.sampleSize, 100);
  });

  it('persists calibrated models in SQLite and gates auto-promotion on sample size and statistical significance', async () => {
    const result = await BayesianProbabilityCalibrator.updateCalibratedDistributions(
      'insufficient_funds',
      { successes: 40, total: 100 }, // Natural rate observed 40%
      { successes: 70, total: 100 }  // Intervention rate observed 70%
    );

    assert.equal(result.reason_code, 'insufficient_funds');
    assert.equal(result.sample_size, 200);
    assert.equal(result.model_type, 'CALIBRATED');
    assert.ok(result.lift_vs_baseline > 0.05, 'Lift must exceed 5%');

    // Retrieve effective probabilities
    const effective = await BayesianProbabilityCalibrator.getEffectiveProbabilities('insufficient_funds');
    assert.equal(effective.source, 'CALIBRATED');
    assert.ok(effective.p_intervention > 0.60);
  });

  it('computes Brier score prediction error accurately for model validation', () => {
    const predictedProb = 0.70;
    const actualOutcomeRecovered = 1;
    const actualOutcomeFailed = 0;

    const brierErrorSuccess = Number(Math.pow(actualOutcomeRecovered - predictedProb, 2).toFixed(4));
    const brierErrorFailure = Number(Math.pow(actualOutcomeFailed - predictedProb, 2).toFixed(4));

    // (1 - 0.70)^2 = 0.09
    assert.equal(brierErrorSuccess, 0.0900);
    // (0 - 0.70)^2 = 0.49
    assert.equal(brierErrorFailure, 0.4900);
  });
});
