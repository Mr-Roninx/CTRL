process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DualMirrorBudgetPacer } from '../../src/market/capacity_policy.js';
import { AntiBlastEngine } from '../../src/economics/anti_blast_engine.js';
import { RecoveryOpportunity } from '../../src/types/index.js';

describe('V6 Enterprise: Online Lagrangian Dual Budget Pacer & Anti-Blast Savings Engine', () => {
  it('DualMirrorBudgetPacer dynamically updates dual multiplier lambda and filters sub-hurdle IVEN', () => {
    const merchantId = 'merchant_enterprise_test';
    const state = DualMirrorBudgetPacer.getPacingState(merchantId, 100000); // ₹1,000 daily budget

    assert.equal(state.lambda, 1.0, 'Baseline lambda starts at 1.0');

    // Simulate high spend burst
    const updatedLambda = DualMirrorBudgetPacer.updateDualMultiplier(merchantId, 80000);
    assert.ok(updatedLambda >= 1.0, 'Lambda should shade upwards when expenditure exceeds hourly trajectory');

    // Check hurdle clearing
    const hurdleHigh = DualMirrorBudgetPacer.shouldAllocate(merchantId, 1500, 400);
    assert.equal(hurdleHigh.clears_hurdle, true, 'High-IVEN opportunity (₹15.00) clears the hurdle');

    const hurdleLow = DualMirrorBudgetPacer.shouldAllocate(merchantId, 50, 400);
    assert.equal(hurdleLow.clears_hurdle, false, 'Sub-hurdle opportunity fails the Lagrangian shadow price check');
  });

  it('AntiBlastEngine computes exact savings and records prevented interventions', async () => {
    const opp: RecoveryOpportunity = {
      id: `opp_blast_${Date.now()}`,
      source: 'real',
      amount_paise: 250000,
      currency: 'INR',
      reason_code: 'card_reported_lost_or_stolen',
      decline_type: 'hard',
      attempt_count: 1,
      customer_id: 'cust_blast_01',
      customer_trust_score: 10,
      created_at: new Date().toISOString(),
      status: 'blocked',
      tenant_id: 'tenant_enterprise_test',
      environment: 'test',
    };

    const savings = AntiBlastEngine.calculateSavings(opp, 'Hard decline fraud filter');
    // ₹0.85 (85p) messaging + ₹4.00 (400p) provider + ₹50.00 (5000p) goodwill = 5485 paise
    assert.equal(savings.messaging_saved, 85);
    assert.equal(savings.provider_saved, 400);
    assert.equal(savings.goodwill_saved, 5000);
    assert.equal(savings.total_saved, 5485);

    const record = await AntiBlastEngine.recordPreventedIntervention(opp, 'Hard decline fraud filter');
    assert.equal(record.total_capital_saved_paise, 5485);
    assert.equal(record.opportunity_id, opp.id);

    const summary = await AntiBlastEngine.getAntiBlastSummary();
    assert.ok(summary.total_prevented >= 1);
    assert.ok(summary.total_capital_saved_paise >= 5485);
  });

  it('Synthetic Holdout Engine deterministically partitions ~5% of traffic', () => {
    let holdoutCount = 0;
    const totalSamples = 1000;

    for (let i = 0; i < totalSamples; i++) {
      if (AntiBlastEngine.isSyntheticHoldout(`opp_sample_${i}`)) {
        holdoutCount++;
      }
    }

    // Expected ~5% (between 3% and 7% across 1,000 samples)
    const ratio = holdoutCount / totalSamples;
    assert.ok(ratio >= 0.03 && ratio <= 0.07, `Holdout ratio ${ratio} should be close to 5%`);
  });
});
