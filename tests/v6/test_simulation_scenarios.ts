process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseAdapter } from '../../src/db/adapter.js';
import { MigrationRunner } from '../../src/db/migrations/runner.js';
import { ScenarioRunner } from '../../src/simulation/scenario_runner.js';

describe('V6 Phase 12: Simulation Scenarios & Counterfactual Lift Evaluation', () => {
  before(async () => {
    const db = DatabaseAdapter.getInstance();
    await MigrationRunner.migrateUp(db);
  });

  const runner = new ScenarioRunner('tenant_sim_eval_01');

  it('executes BALANCED_BATCH scenario through full two-stage pipeline', async () => {
    const result = await runner.runScenario('BALANCED_BATCH', { count: 10, capacity: 5 });

    assert.equal(result.scenario_type, 'BALANCED_BATCH');
    assert.equal(result.total_opportunities, 10);
    assert.equal(result.capacity_limit, 5);
    assert.ok(result.allocated_count <= 5);
    assert.ok(result.total_at_risk_paise > 0);
  });

  it('executes CAPACITY_STRESS scenario exposing marginal shadow price under binding capacity', async () => {
    const result = await runner.runScenario('CAPACITY_STRESS', { count: 20, capacity: 5 });

    assert.equal(result.scenario_type, 'CAPACITY_STRESS');
    assert.equal(result.total_opportunities, 20);
    assert.equal(result.capacity_limit, 5);
    assert.equal(result.allocated_count, 5);
    assert.equal(result.deferred_count, 15);
    assert.ok(result.shadow_price_paise > 0, 'Shadow price must be exposed when capacity binds');
  });

  it('executes HARD_DECLINE_WAVE scenario verifying 100% compliance veto rate', async () => {
    const result = await runner.runScenario('HARD_DECLINE_WAVE', { count: 8, capacity: 5 });

    assert.equal(result.scenario_type, 'HARD_DECLINE_WAVE');
    assert.equal(result.total_opportunities, 8);
    assert.equal(result.allocated_count, 0, 'Zero hard declines may be allocated');
    assert.equal(result.blocked_count, 8, '100% of hard declines must be vetoed as BLOCKED');
  });

  it('executes COUNTERFACTUAL_A_B scenario and labels incremental lift as model-estimated', async () => {
    const result = await runner.runScenario('COUNTERFACTUAL_A_B', { count: 15, capacity: 10 });

    assert.ok(result.counterfactual_lift !== undefined);
    assert.ok(result.counterfactual_lift.intervention_arm_recovery_rate > result.counterfactual_lift.control_arm_natural_rate);
    assert.ok(result.counterfactual_lift.incremental_lift > 0);
    assert.equal(result.counterfactual_lift.is_model_estimated, true, 'INVARIANT: Rates must be labeled as model-estimated');
  });
});
