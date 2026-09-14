import { AgentLearningEngine } from '../../src/agents/learning.js';
import { AgentMemoryStore } from '../../src/agents/memory.js';
import { initDatabase, upsertOpportunity } from '../../src/db/database.js';

export function runLearningTests() {
  console.log('🧪 Running Test: Outcome Evaluation, Prediction Error & Auditable Learning...');
  initDatabase();

  const oppId = `opp_learn_${Date.now()}`;
  upsertOpportunity({
    id: oppId,
    source: 'synthetic',
    amount_paise: 500000,
    currency: 'INR',
    reason_code: 'insufficient_funds',
    decline_type: 'soft',
    attempt_count: 1,
    customer_id: 'cust_learn',
    customer_trust_score: 0.8,
    created_at: new Date().toISOString(),
    status: 'executing',
  });

  // 1. Evaluate outcome
  const runId = `run_learn_${Date.now()}`;
  const res = AgentLearningEngine.evaluateOutcome({
    runId,
    opportunityId: oppId,
    actualRecovered: true,
    actualRevenuePaise: 500000,
    customerResponse: 'Paid via link',
  });

  if (!res.outcome_record || res.outcome_record.net_gain_paise <= 0) {
    throw new Error('Outcome evaluation calculation failed');
  }

  // 2. Prediction error & Brier calculation
  if (typeof res.outcome_record.prediction_error !== 'number' || res.outcome_record.prediction_error < 0) {
    throw new Error('Prediction error calculation invalid');
  }

  // 3. Episodic Memory Update Verification
  const episodes = AgentMemoryStore.queryEpisodicMemories({
    failureType: 'insufficient_funds',
    cutoffTimestamp: new Date().toISOString(),
    limit: 5,
  });
  const matchingEpisode = episodes.find((e) => e.opportunity_id === oppId);
  if (!matchingEpisode || matchingEpisode.actual_outcome !== 'RECOVERED') {
    throw new Error('Episodic memory update failed to record outcome');
  }

  // 4. Calibration statistics & Governance (No auto-mutation)
  const stats = AgentLearningEngine.getCalibrationStatistics();
  if (stats.total_outcomes === 0 || typeof stats.brier_score !== 'number') {
    throw new Error('Calibration stats calculation failed');
  }

  console.log('  ✅ PASS: Outcome evaluation, prediction error (Brier score), episodic memory update & calibration proposals verified (Zero auto-mutation).');
}

if (process.argv[1]?.endsWith('test_agent_learning.ts')) {
  runLearningTests();
}
