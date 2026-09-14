import { TemporalMemoryFirewall } from '../../src/agents/temporal_firewall.js';
import { AgentMemoryItem } from '../../src/agents/types.js';

export function runTemporalFirewallTests() {
  console.log('🧪 Running Test: Temporal Memory Firewall (Anti-Lookahead)...');

  const now = new Date('2026-08-31T12:00:00.000Z');
  const past = new Date('2026-08-31T10:00:00.000Z').toISOString();
  const future = new Date('2026-08-31T14:00:00.000Z').toISOString();

  const memories: AgentMemoryItem[] = [
    {
      id: 'mem_1',
      memory_type: 'episodic',
      run_id: 'run_1',
      opportunity_id: 'opp_1',
      failure_type: 'insufficient_funds',
      context_summary: 'Past episode',
      action_taken: 'SEND_PAYMENT_LINK',
      predicted_outcome: 'P=0.5',
      actual_outcome: 'RECOVERED',
      prediction_error: 0.1,
      semantic_key: null,
      semantic_value: null,
      confidence: 0.9,
      provenance: 'test',
      created_at: past,
    },
    {
      id: 'mem_2',
      memory_type: 'episodic',
      run_id: 'run_2',
      opportunity_id: 'opp_2',
      failure_type: 'insufficient_funds',
      context_summary: 'Future oracle leakage episode',
      action_taken: 'SEND_PAYMENT_LINK',
      predicted_outcome: 'P=0.9',
      actual_outcome: 'RECOVERED',
      prediction_error: 0.0,
      semantic_key: null,
      semantic_value: null,
      confidence: 1.0,
      provenance: 'test',
      created_at: future,
    },
  ];

  const filtered = TemporalMemoryFirewall.filterMemories(memories, now.toISOString());

  if (filtered.length !== 1 || filtered[0].id !== 'mem_1') {
    throw new Error(`Temporal Firewall failed: expected 1 memory, got ${filtered.length}`);
  }

  let errorThrown = false;
  try {
    TemporalMemoryFirewall.assertTimestampValid(future, now.toISOString());
  } catch (e) {
    errorThrown = true;
  }
  if (!errorThrown) {
    throw new Error('Expected future timestamp assertion to throw error');
  }

  console.log('  ✅ PASS: Temporal Memory Firewall strictly blocks future records and lookahead oracle leakage.');
}

if (process.argv[1]?.endsWith('test_agent_temporal_firewall.ts')) {
  runTemporalFirewallTests();
}
