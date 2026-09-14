import { BayesianProbabilityCalibrator } from '../../src/economics/bayesian_calibration.js';
import { CapacityPolicyManager } from '../../src/market/capacity_policy.js';

export async function runBayesianEconomicsTests() {
  console.log('🧪 Running Test: Bayesian Probability Calibration & Capacity Policy...');

  // 1. Beta Distribution Posterior Computation
  // Prior: Beta(1, 9) (prior mean = 0.10)
  // Observations: 20 successes in 100 trials
  const post = BayesianProbabilityCalibrator.computeBetaPosterior(1, 9, 20, 100);
  // Post Alpha = 21, Post Beta = 89, Mean = 21 / 110 = ~0.1909
  if (post.expected < 0.18 || post.expected > 0.20) {
    throw new Error(`Bayesian posterior computation error: expected ~0.19, got ${post.expected}`);
  }

  // 2. A/B Testing Auto-Promotion Logic
  const promo = BayesianProbabilityCalibrator.evaluateModelPromotion(0.10, 0.20, 200);
  if (!promo.shouldPromote || promo.lift <= 0.05 || promo.pValue >= 0.05) {
    throw new Error('A/B test evaluation failed to auto-promote high-lift calibrated model');
  }

  // 3. Fallback when sample size < 100
  const noPromo = BayesianProbabilityCalibrator.evaluateModelPromotion(0.10, 0.20, 50);
  if (noPromo.shouldPromote) {
    throw new Error('Calibrated model was promoted with insufficient sample size (< 100)');
  }

  // 4. Time-Windowed Capacity & 24h Customer Fatigue Check
  const merchantId = `m_${Date.now()}`;
  const customerId = `c_${Date.now()}`;

  // First allocation: allowed
  const check1 = await CapacityPolicyManager.evaluateCapacity(merchantId, customerId, 500, {
    max_links_per_hour: 2,
    max_links_per_customer_per_day: 1,
  });
  if (!check1.allowed) {
    throw new Error('First capacity check was unexpectedly rejected');
  }

  // Record consumption
  await CapacityPolicyManager.recordConsumption(merchantId, customerId, 500);

  // Second allocation for SAME customer: blocked by 24h fatigue
  const checkFatigue = await CapacityPolicyManager.evaluateCapacity(merchantId, customerId, 500, {
    max_links_per_hour: 2,
    max_links_per_customer_per_day: 1,
  });
  if (checkFatigue.allowed || !checkFatigue.reason?.includes('Customer fatigue')) {
    throw new Error('Customer fatigue failed to block second link to same customer within 24h');
  }

  console.log('  ✅ PASS: Bayesian Beta calibration, A/B test promotion, merchant capacity & 24h customer fatigue verified.');
}

if (process.argv[1]?.endsWith('test_bayesian_economics.ts')) {
  runBayesianEconomicsTests();
}
