import dotenv from 'dotenv';
import path from 'node:path';
import { initDatabase, upsertOpportunity, upsertCustomer, insertAgentState } from '../../src/db/database.js';
import { AgentOrchestrator } from '../../src/agents/orchestrator.js';
import { MissionReplayEngine } from '../../src/agents/replay.js';
import { RecoveryOpportunity } from '../../src/types/index.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const REPLAY_OPP: RecoveryOpportunity = {
  id: 'replay_test_opp_01',
  source: 'synthetic',
  amount_paise: 275000,
  currency: 'INR',
  reason_code: 'insufficient_funds',
  decline_type: 'soft',
  attempt_count: 1,
  customer_id: 'cust_replay_01',
  customer_trust_score: 0.8,
  created_at: new Date().toISOString(),
  status: 'pending',
};

export async function runReplayTests() {
  console.log('🧪 Running Test: Mission Replay & Cryptographic Fingerprinting...');
  initDatabase();

  upsertCustomer({ id: REPLAY_OPP.customer_id, trust_score: REPLAY_OPP.customer_trust_score, created_at: REPLAY_OPP.created_at, updated_at: REPLAY_OPP.created_at });
  upsertOpportunity(REPLAY_OPP);

  // Run initial mission
  const mission1 = await AgentOrchestrator.executeRecoveryMission({
    opportunityId: REPLAY_OPP.id,
    environment: 'SYNTHETIC',
  });

  // Test 1: Generate SHA-256 fingerprint
  const fp1 = MissionReplayEngine.generateFingerprint(mission1.run_id);
  if (!fp1.fingerprint_sha256 || fp1.fingerprint_sha256.length !== 64) {
    throw new Error(`Invalid SHA-256 fingerprint: ${fp1.fingerprint_sha256}`);
  }
  if (fp1.state_sequence.length === 0) {
    throw new Error('State sequence in fingerprint cannot be empty');
  }
  console.log(`  ✅ SHA-256 Fingerprint generated: ${fp1.fingerprint_sha256.slice(0, 16)}... (${fp1.state_sequence.length} states)`);

  // Test 2: Deterministic fingerprint (same run yields identical fingerprint)
  const fp1_again = MissionReplayEngine.generateFingerprint(mission1.run_id);
  if (fp1.fingerprint_sha256 !== fp1_again.fingerprint_sha256) {
    throw new Error('Fingerprint generation is non-deterministic on identical run');
  }
  console.log(`  ✅ Deterministic fingerprint consistency verified`);

  // Test 3: Self-replay verification (comparing run against itself)
  const verifySelf = MissionReplayEngine.verifyReplay(mission1.run_id, mission1.run_id);
  if (!verifySelf.is_match || verifySelf.divergence_detected) {
    throw new Error(`Self-replay verification failed: ${JSON.stringify(verifySelf)}`);
  }
  console.log(`  ✅ Self-replay matches with zero divergence`);

  // Test 4: Divergence detection on modified telemetry
  // Create a synthetic divergent run by inserting an altered state sequence
  const fakeDivergentRunId = `run_fake_divergent_${Date.now()}`;
  insertAgentState({
    run_id: fakeDivergentRunId,
    state: 'IDLE',
    previous_state: null,
    trigger: 'INIT',
    metadata: null,
    timestamp: new Date().toISOString(),
  });
  insertAgentState({
    run_id: fakeDivergentRunId,
    state: 'ABORTED',
    previous_state: 'IDLE',
    trigger: 'MANUAL_ABORT',
    metadata: null,
    timestamp: new Date().toISOString(),
  });

  const verifyDivergent = MissionReplayEngine.verifyReplay(mission1.run_id, fakeDivergentRunId);
  if (verifyDivergent.is_match || !verifyDivergent.divergence_detected) {
    throw new Error('Expected divergence to be detected between distinct runs');
  }
  if (!verifyDivergent.divergence_stage) {
    throw new Error('Divergence stage should be identified');
  }
  console.log(`  ✅ Divergence detected at stage: ${verifyDivergent.divergence_stage}`);

  console.log('  ✅ PASS: Mission replay engine verified — SHA-256 fingerprinting, determinism, divergence detection.\n');
}

if (process.argv[1]?.endsWith('test_replay.ts')) {
  runReplayTests();
}
