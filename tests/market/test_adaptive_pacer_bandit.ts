process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseAdapter } from '../../src/db/adapter.js';
import { MigrationRunner } from '../../src/db/migrations/runner.js';
import {
  DualMirrorBudgetPacer,
  PacingArm,
  PacingTimeWindow,
} from '../../src/market/capacity_policy.js';
import { getRecentPacingBanditLogs } from '../../src/db/database.js';

describe('Reinforcement Learning: Adaptive Lagrangian Capacity Pacer Bandit (Option B)', () => {
  before(async () => {
    const db = DatabaseAdapter.getInstance();
    await MigrationRunner.migrateUp(db);
  });

  beforeEach(() => {
    DualMirrorBudgetPacer.resetForTesting();
  });

  it('correctly maps UTC hours to discrete pacing time windows', () => {
    const night = new Date('2026-09-03T03:00:00Z');
    assert.equal(DualMirrorBudgetPacer.getTimeWindow(night), 'NIGHT_QUIET');

    const morning = new Date('2026-09-03T09:00:00Z');
    assert.equal(DualMirrorBudgetPacer.getTimeWindow(morning), 'MORNING_PEAK');

    const afternoon = new Date('2026-09-03T14:00:00Z');
    assert.equal(DualMirrorBudgetPacer.getTimeWindow(afternoon), 'AFTERNOON_TROUGH');

    const evening = new Date('2026-09-03T20:00:00Z');
    assert.equal(DualMirrorBudgetPacer.getTimeWindow(evening), 'EVENING_SURGE');
  });

  it('selects valid pacing arms via UCB exploration and exploitation', () => {
    const window: PacingTimeWindow = 'MORNING_PEAK';

    // Round-robin initialization
    const arm1 = DualMirrorBudgetPacer.selectPacingArm(window);
    assert.ok(['CONSERVATIVE', 'NEUTRAL', 'AGGRESSIVE'].includes(arm1));

    // Record high reward for AGGRESSIVE arm
    DualMirrorBudgetPacer.recordPacingReward(window, 'AGGRESSIVE', 0.95);
    DualMirrorBudgetPacer.recordPacingReward(window, 'CONSERVATIVE', 0.10);
    DualMirrorBudgetPacer.recordPacingReward(window, 'NEUTRAL', 0.40);

    const chosen = DualMirrorBudgetPacer.selectPacingArm(window);
    assert.ok(['CONSERVATIVE', 'NEUTRAL', 'AGGRESSIVE'].includes(chosen));
  });

  it('dynamically adapts shadow multiplier lambda with decaying step size', () => {
    const merchantId = 'merchant_pacer_test';
    const initialLambda = DualMirrorBudgetPacer.getPacingState(merchantId).lambda;
    assert.equal(initialLambda, 1.0);

    // Simulate heavy overspend: actual spend >> expected hourly burn rate
    // Should cause lambda (hurdle rate) to increase to conserve remaining budget
    for (let i = 0; i < 5; i++) {
      DualMirrorBudgetPacer.updateDualMultiplier(merchantId, 50000); // spend ₹500
    }

    const state = DualMirrorBudgetPacer.getPacingState(merchantId);
    assert.ok(state.lambda > 1.0, `Lambda should increase under overspend, got ${state.lambda}`);
    assert.ok(state.lambda <= 1000.0, 'Lambda must respect maximum ceiling');
    assert.equal(state.update_count, 5);

    // Verify durable audit logging to SQLite
    const logs = getRecentPacingBanditLogs(merchantId, 10);
    assert.ok(logs.length >= 5, `Expected at least 5 audit logs, found ${logs.length}`);
    assert.equal(logs[0].tenant_id, merchantId);
  });

  it('modulates allocation hurdle based on active pacing arm', () => {
    const merchantId = 'merchant_arm_hurdle_test';
    const state = DualMirrorBudgetPacer.getPacingState(merchantId);

    // Test with ₹5.00 cost (500 paise)
    const costPaise = 500;
    const allocation = DualMirrorBudgetPacer.shouldAllocate(merchantId, 600, costPaise);

    assert.equal(typeof allocation.clears_hurdle, 'boolean');
    assert.ok(allocation.shadow_threshold_paise > 0);
    assert.ok(['CONSERVATIVE', 'NEUTRAL', 'AGGRESSIVE'].includes(allocation.active_arm));
  });
});
