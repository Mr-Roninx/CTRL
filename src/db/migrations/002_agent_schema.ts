import { Migration } from './types.js';
import crypto from 'node:crypto';

export const migration002AgentSchema: Migration = {
  id: '002',
  name: 'agent_intelligence_schema',
  checksum: crypto.createHash('sha256').update('002_agent_intelligence_schema_v3').digest('hex'),
  up: async (db) => {
    // 1. Agent Runs
    await db.execute(`
      CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        opportunity_id TEXT,
        goal_type TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'aborted', 'human_review')),
        start_time TEXT NOT NULL,
        end_time TEXT,
        total_steps INTEGER NOT NULL DEFAULT 0,
        llm_calls INTEGER NOT NULL DEFAULT 0,
        tool_calls INTEGER NOT NULL DEFAULT 0,
        replan_count INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        termination_reason TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (opportunity_id) REFERENCES recovery_opportunities(id) ON DELETE SET NULL
      );
    `);

    // 2. Agent States
    await db.execute(`
      CREATE TABLE IF NOT EXISTS agent_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        state TEXT NOT NULL,
        previous_state TEXT,
        trigger TEXT NOT NULL,
        metadata TEXT,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
      );
    `);

    // 3. Agent Steps
    await db.execute(`
      CREATE TABLE IF NOT EXISTS agent_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        step_number INTEGER NOT NULL,
        state TEXT NOT NULL,
        observation TEXT,
        thought TEXT,
        action_type TEXT,
        action_payload TEXT,
        tool_name TEXT,
        tool_input TEXT,
        tool_output TEXT,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
      );
    `);

    // 4. Agent Tool Calls
    await db.execute(`
      CREATE TABLE IF NOT EXISTS agent_tool_calls (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        input_payload TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        output_payload TEXT NOT NULL,
        output_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        error_message TEXT,
        permission_level TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
      );
    `);

    // 5. Agent Plans
    await db.execute(`
      CREATE TABLE IF NOT EXISTS agent_plans (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        plan_version INTEGER NOT NULL,
        goal TEXT NOT NULL,
        steps TEXT NOT NULL,
        validity_assumptions TEXT NOT NULL,
        candidate_actions TEXT NOT NULL,
        preferred_action TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'INVALIDATED', 'EXECUTED', 'SUPERSEDED')),
        invalidation_reason TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
      );
    `);

    // 6. Agent Hypotheses
    await db.execute(`
      CREATE TABLE IF NOT EXISTS agent_hypotheses (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        failure_category TEXT NOT NULL,
        root_cause_hypothesis TEXT NOT NULL,
        confidence REAL NOT NULL,
        supporting_evidence TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
      );
    `);

    // 7. Agent Proposals
    await db.execute(`
      CREATE TABLE IF NOT EXISTS agent_proposals (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        opportunity_id TEXT NOT NULL,
        proposal_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'SUPERSEDED')),
        review_notes TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (opportunity_id) REFERENCES recovery_opportunities(id) ON DELETE CASCADE
      );
    `);

    // 8. Agent Memories
    await db.execute(`
      CREATE TABLE IF NOT EXISTS agent_memories (
        id TEXT PRIMARY KEY,
        memory_type TEXT NOT NULL CHECK(memory_type IN ('working', 'episodic', 'semantic')),
        run_id TEXT,
        opportunity_id TEXT,
        failure_type TEXT,
        context_summary TEXT NOT NULL,
        action_taken TEXT,
        predicted_outcome TEXT,
        actual_outcome TEXT,
        prediction_error REAL,
        semantic_key TEXT,
        semantic_value TEXT,
        confidence REAL NOT NULL DEFAULT 0.5,
        provenance TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    // 9. Agent Outcomes
    await db.execute(`
      CREATE TABLE IF NOT EXISTS agent_outcomes (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        opportunity_id TEXT NOT NULL,
        predicted_recovery_prob REAL NOT NULL,
        actual_recovered INTEGER NOT NULL,
        prediction_error REAL NOT NULL,
        actual_revenue_paise BIGINT NOT NULL,
        operational_cost_paise BIGINT NOT NULL,
        net_gain_paise BIGINT NOT NULL,
        customer_response TEXT,
        evaluated_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (opportunity_id) REFERENCES recovery_opportunities(id) ON DELETE CASCADE
      );
    `);

    // 10. Agent Authority Checks
    await db.execute(`
      CREATE TABLE IF NOT EXISTS agent_authority_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        check_name TEXT NOT NULL,
        passed INTEGER NOT NULL,
        reason TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
      );
    `);

    // 11. LLM Invocations
    await db.execute(`
      CREATE TABLE IF NOT EXISTS llm_invocations (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        prompt_hash TEXT NOT NULL,
        prompt_preview TEXT NOT NULL,
        completion_hash TEXT NOT NULL,
        completion_preview TEXT NOT NULL,
        reasoning_preview TEXT,
        latency_ms INTEGER NOT NULL,
        prompt_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
      );
    `);

    // 12. Outreach Drafts
    await db.execute(`
      CREATE TABLE IF NOT EXISTS outreach_drafts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        opportunity_id TEXT NOT NULL,
        channel TEXT NOT NULL CHECK(channel IN ('SMS', 'WHATSAPP', 'EMAIL')),
        recipient TEXT NOT NULL,
        subject TEXT,
        body TEXT NOT NULL,
        compliance_footer TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED')),
        review_feedback TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (opportunity_id) REFERENCES recovery_opportunities(id) ON DELETE CASCADE
      );
    `);

    // 13. Perception Annotations
    await db.execute(`
      CREATE TABLE IF NOT EXISTS perception_annotations (
        id TEXT PRIMARY KEY,
        opportunity_id TEXT NOT NULL UNIQUE,
        failure_intent TEXT NOT NULL,
        customer_urgency_score REAL NOT NULL,
        merchant_risk_score REAL NOT NULL,
        semantic_notes TEXT NOT NULL,
        confidence REAL NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (opportunity_id) REFERENCES recovery_opportunities(id) ON DELETE CASCADE
      );
    `);
  },
  down: async (db) => {
    const tables = [
      'perception_annotations',
      'outreach_drafts',
      'llm_invocations',
      'agent_authority_checks',
      'agent_outcomes',
      'agent_memories',
      'agent_proposals',
      'agent_hypotheses',
      'agent_plans',
      'agent_tool_calls',
      'agent_steps',
      'agent_states',
      'agent_runs',
    ];
    for (const tbl of tables) {
      await db.execute(`DROP TABLE IF EXISTS ${tbl};`);
    }
  },
};
