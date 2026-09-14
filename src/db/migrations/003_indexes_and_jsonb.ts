import { Migration } from './types.js';
import crypto from 'node:crypto';

export const migration003IndexesAndJsonb: Migration = {
  id: '003',
  name: 'indexes_and_performance_optimization',
  checksum: crypto.createHash('sha256').update('003_indexes_and_performance_v3').digest('hex'),
  up: async (db) => {
    // Indexes on core tables
    await db.execute('CREATE INDEX IF NOT EXISTS idx_opps_status ON recovery_opportunities(status);');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_opps_customer ON recovery_opportunities(customer_id);');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_opps_merchant ON recovery_opportunities(merchant_id);');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_ledger_opp ON ledger_entries(opportunity_id);');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_ledger_timestamp ON ledger_entries(timestamp);');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_auth_opp ON authority_checks(opportunity_id);');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_alloc_rank ON allocation_decisions(rank_in_batch);');

    // Indexes on agent tables
    await db.execute('CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_agent_runs_opp ON agent_runs(opportunity_id);');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_agent_states_run ON agent_states(run_id);');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_steps(run_id, step_number);');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_run ON agent_tool_calls(run_id);');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_agent_plans_run ON agent_plans(run_id, plan_version);');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_agent_proposals_opp ON agent_proposals(opportunity_id);');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_agent_memories_type ON agent_memories(memory_type);');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_agent_memories_created ON agent_memories(created_at);');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_llm_invocations_run ON llm_invocations(run_id);');
  },
  down: async (db) => {
    const indexes = [
      'idx_opps_status',
      'idx_opps_customer',
      'idx_opps_merchant',
      'idx_ledger_opp',
      'idx_ledger_timestamp',
      'idx_auth_opp',
      'idx_alloc_rank',
      'idx_agent_runs_status',
      'idx_agent_runs_opp',
      'idx_agent_states_run',
      'idx_agent_steps_run',
      'idx_agent_tool_calls_run',
      'idx_agent_plans_run',
      'idx_agent_proposals_opp',
      'idx_agent_memories_type',
      'idx_agent_memories_created',
      'idx_llm_invocations_run',
    ];
    for (const idx of indexes) {
      await db.execute(`DROP INDEX IF EXISTS ${idx};`);
    }
  },
};
