import { AgentMemoryStore } from '../../src/agents/memory.js';
import { initDatabase } from '../../src/db/database.js';

export function runMemoryStoreTests() {
  console.log('🧪 Running Test: Agent Memory Store (Working, Episodic, Semantic)...');
  initDatabase();

  const runId = `mem_run_${Date.now()}`;

  // 1. Working memory
  const wm = AgentMemoryStore.addWorkingMemory({
    runId,
    summary: 'Working observation for active mission',
    provenance: 'test',
  });
  if (!wm.id || wm.memory_type !== 'working') throw new Error('Working memory insert failed');

  const fetchedWm = AgentMemoryStore.getWorkingMemory(runId);
  if (fetchedWm.length === 0) throw new Error('Working memory retrieval failed');

  // 2. Episodic memory: Mission 1 -> Outcome -> Episodic memory
  const m1Time = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
  const ep = AgentMemoryStore.recordEpisode({
    runId: 'mission_1_run',
    opportunityId: 'synth_02_insufficient_funds_att1',
    failureType: 'insufficient_funds',
    summary: 'Mission 1 recovered payment via WhatsApp link',
    actionTaken: 'SEND_PAYMENT_LINK',
    predictedOutcome: 'P=0.55',
    actualOutcome: 'RECOVERED',
    predictionError: 0.45,
    provenance: 'settlement_reconciliation',
  });
  if (!ep.id || ep.memory_type !== 'episodic') throw new Error('Episodic memory insert failed');

  // 3. Mission 2 -> Retrieves eligible memory from Mission 1
  const m2Query = AgentMemoryStore.queryEpisodicMemories({
    failureType: 'insufficient_funds',
    cutoffTimestamp: new Date().toISOString(),
    limit: 5,
  });
  const foundM1 = m2Query.some((m) => m.run_id === 'mission_1_run');
  if (!foundM1) {
    throw new Error('Mission 2 failed to retrieve eligible episodic memory from Mission 1');
  }

  // 4. Future memory -> Blocked
  const pastCutoff = new Date(Date.now() - 1800000).toISOString(); // 30 min ago (before Mission 1 which was recorded now)
  const queryPast = AgentMemoryStore.queryEpisodicMemories({
    failureType: 'insufficient_funds',
    cutoffTimestamp: pastCutoff,
    limit: 5,
  });
  const hasFuture = queryPast.some((m) => new Date(m.created_at).getTime() > new Date(pastCutoff).getTime());
  if (hasFuture) {
    throw new Error('Temporal Memory Firewall failed: future memory leaked into past cutoff query');
  }

  // 5. Semantic memory
  const sm = AgentMemoryStore.recordSemanticMemory({
    key: 'pattern:bank_timeouts',
    value: 'High natural auto-recovery (0.60)',
    summary: 'Bank timeouts usually recover naturally within 1 hour',
    confidence: 0.95,
    provenance: 'historical_cluster',
  });
  if (!sm.id || sm.memory_type !== 'semantic') throw new Error('Semantic memory insert failed');

  console.log('  ✅ PASS: Working, Episodic (Mission 1 -> Mission 2), and Semantic memory persistence & temporal firewall verified.');
}

if (process.argv[1]?.endsWith('test_agent_memory.ts')) {
  runMemoryStoreTests();
}
