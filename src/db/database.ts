import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import {
  RecoveryOpportunity,
  Score,
  AllocationDecision,
  AuthorityCheck,
  ExecutionRecord,
  LedgerEntry,
  Customer,
  OpportunityStatus,
} from '../types/index.js';
import {
  AgentRunRecord,
  AgentStateRecord,
  AgentStepRecord,
  AgentToolCallRecord,
  AgentPlanRecord,
  AgentHypothesisRecord,
  AgentProposalRecord,
  AgentMemoryItem,
  AgentOutcomeRecord,
  AgentAuthorityCheckRecord,
  LLMInvocationRecord,
  OutreachDraftRecord,
  PerceptionAnnotationRecord,
} from '../agents/types.js';
import { getSupabaseClient } from '../security/supabase.js';
import {
  OpportunityRepository,
  ScoreRepository,
  AllocationRepository,
  LedgerRepository,
  CustomerRepository,
  AuthorityRepository,
  ExecutionRepository,
} from './repositories/index.js';

let supabaseBrokenUntil = 0;
let lastSupabaseWarn = 0;
const opportunitySyncPromises = new Map<string, Promise<void>>();

function handleSupabaseError(table: string, error: any): void {
  const currentNow = Date.now();
  const errMsg = error?.message || String(error);
  const code = error?.code || '';

  // Gracefully ignore missing tables in remote schema cache (PGRST205) or non-existent relations (42P01)
  if (code === 'PGRST205' || code === '42P01' || errMsg.includes('schema cache')) {
    return;
  }

  // Foreign key violation means parent record sync is pending or delayed — do not trip global breaker
  if (code === '23503' || errMsg.includes('foreign key constraint')) {
    return;
  }

  // Only trip circuit breaker for genuine network / server / timeout outages
  const isNetworkFailure =
    errMsg.includes('timeout') ||
    errMsg.includes('TimeoutError') ||
    errMsg.includes('AbortError') ||
    errMsg.includes('fetch failed') ||
    errMsg.includes('ECONNREFUSED') ||
    (typeof error?.status === 'number' && error.status >= 500);

  if (isNetworkFailure) {
    supabaseBrokenUntil = currentNow + 60000;
    if (currentNow - lastSupabaseWarn > 30000) {
      lastSupabaseWarn = currentNow;
      const shortMsg = errMsg.slice(0, 120).replace(/\s+/g, ' ');
      console.warn(`⚠️ [SUPABASE SYNC] Remote sync circuit opened for 60s (${table}): ${shortMsg}`);
    }
  }
}

async function syncOpportunityToSupabaseInternal(opp: RecoveryOpportunity): Promise<void> {
  const now = Date.now();
  if (now < supabaseBrokenUntil) return;

  try {
    const sb = getSupabaseClient();
    const tenantId = opp.tenant_id || 'tenant_system_default';
    const { error } = await sb.from('recovery_opportunities').upsert({
      id: opp.id,
      source: opp.source,
      amount_paise: opp.amount_paise,
      currency: opp.currency || 'INR',
      reason_code: opp.reason_code,
      decline_type: opp.decline_type,
      attempt_count: opp.attempt_count ?? 1,
      customer_id: opp.customer_id,
      customer_trust_score: opp.customer_trust_score ?? 0.65,
      status: opp.status || 'pending',
      tenant_id: tenantId,
      merchant_id: tenantId,
      created_at: opp.created_at || new Date().toISOString(),
    }, { onConflict: 'id' });

    if (error) {
      handleSupabaseError('recovery_opportunities', error);
    }
  } catch (err: any) {
    handleSupabaseError('recovery_opportunities', err);
  }
}

function syncToSupabase(table: string, payload: Record<string, any>, onConflictKey: string = 'id'): void {
  const now = Date.now();
  if (now < supabaseBrokenUntil) {
    return; // Circuit open: skip remote sync while Supabase is unreachable
  }

  // Non-blocking async execution
  (async () => {
    try {
      // If table is a dependent child table, ensure parent opportunity exists in Supabase first
      const childTables = ['scores', 'allocation_decisions', 'authority_checks', 'execution_records', 'ledger_entries'];
      if (childTables.includes(table) && payload.opportunity_id) {
        const oppId = payload.opportunity_id;
        const pending = opportunitySyncPromises.get(oppId);
        if (pending) {
          await pending.catch(() => {});
        } else {
          const opp = getOpportunityById(oppId);
          if (opp) {
            await syncOpportunityToSupabaseInternal(opp).catch(() => {});
          }
        }
      }

      const sb = getSupabaseClient();
      const query = onConflictKey
        ? sb.from(table).upsert(payload, { onConflict: onConflictKey })
        : sb.from(table).insert(payload);
      const { error } = await query;
      if (error) {
        handleSupabaseError(table, error);
      }
    } catch (err: any) {
      handleSupabaseError(table, err);
    }
  })().catch(() => {});
}

function updateInSupabase(table: string, id: string, payload: Record<string, any>): void {
  const now = Date.now();
  if (now < supabaseBrokenUntil) {
    return; // Circuit open: skip remote sync while Supabase is unreachable
  }

  (async () => {
    try {
      const sb = getSupabaseClient();
      const { error } = await sb.from(table).update(payload).eq('id', id);
      if (error) {
        handleSupabaseError(table, error);
      }
    } catch (err: any) {
      handleSupabaseError(table, err);
    }
  })().catch(() => {});
}

const DB_PATH = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'ctrl.db');

function createDatabaseInstance(): DatabaseSync {
  try {
    const dir = path.dirname(DB_PATH);
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return new DatabaseSync(DB_PATH);
  } catch (err: any) {
    console.warn(`⚠️ SQLite file '${DB_PATH}' could not be opened (${err.message}). Falling back to /tmp/ctrl.db...`);
    try {
      return new DatabaseSync('/tmp/ctrl.db');
    } catch {
      console.warn('⚠️ Falling back to in-memory SQLite database (:memory:)...');
      return new DatabaseSync(':memory:');
    }
  }
}

export const db = createDatabaseInstance();
export function getDatabase(): DatabaseSync {
  return db;
}

export function initDatabase(): void {
  // Enable WAL mode & foreign keys
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL DEFAULT 'merchant_default',
      trust_score REAL NOT NULL DEFAULT 0.65,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_otps (
      email TEXT PRIMARY KEY,
      otp TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recovery_opportunities (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default',
      merchant_id TEXT NOT NULL DEFAULT 'tenant_system_default',
      source TEXT NOT NULL CHECK(source IN ('real', 'synthetic')),
      amount_paise INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      reason_code TEXT NOT NULL,
      decline_type TEXT NOT NULL CHECK(decline_type IN ('hard', 'soft', 'unknown')),
      attempt_count INTEGER NOT NULL DEFAULT 1,
      customer_id TEXT NOT NULL,
      customer_trust_score REAL NOT NULL DEFAULT 0.65,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN (
        'pending', 'scored', 'allocated', 'authorized', 'deferred', 'blocked', 'abstained', 'executing', 'recovered', 'not_recovered'
      )),
      razorpay_event_id TEXT UNIQUE,
      raw_payload_ref TEXT
    );
  `);

  try {
    db.exec(`ALTER TABLE customers ADD COLUMN merchant_id TEXT NOT NULL DEFAULT 'tenant_system_default';`);
  } catch (e) {}

  try {
    db.exec(`ALTER TABLE customers ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';`);
  } catch (e) {}

  try {
    db.exec(`ALTER TABLE recovery_opportunities ADD COLUMN merchant_id TEXT NOT NULL DEFAULT 'tenant_system_default';`);
  } catch (e) {}

  try {
    db.exec(`ALTER TABLE recovery_opportunities ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';`);
  } catch (e) {}

  try {
    db.exec(`ALTER TABLE recovery_opportunities ADD COLUMN environment TEXT NOT NULL DEFAULT 'test';`);
  } catch (e) {}

  db.exec(`

    CREATE INDEX IF NOT EXISTS idx_opportunities_source ON recovery_opportunities(source);
    CREATE INDEX IF NOT EXISTS idx_opportunities_status ON recovery_opportunities(status);
    CREATE INDEX IF NOT EXISTS idx_opportunities_customer ON recovery_opportunities(customer_id);
    CREATE INDEX IF NOT EXISTS idx_opportunities_rzp_event ON recovery_opportunities(razorpay_event_id);

    CREATE TABLE IF NOT EXISTS scores (
      opportunity_id TEXT PRIMARY KEY,
      natural_recovery_prob REAL NOT NULL,
      intervention_recovery_prob REAL NOT NULL,
      incremental_prob REAL NOT NULL,
      operational_cost_paise INTEGER NOT NULL,
      fatigue_cost_paise INTEGER NOT NULL,
      expected_incremental_value_paise INTEGER NOT NULL,
      confidence TEXT NOT NULL CHECK(confidence IN ('low', 'medium', 'high')),
      FOREIGN KEY (opportunity_id) REFERENCES recovery_opportunities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS allocation_decisions (
      opportunity_id TEXT PRIMARY KEY,
      decision TEXT NOT NULL CHECK(decision IN ('ACT', 'WAIT', 'ABSTAIN')),
      rank_in_batch INTEGER NOT NULL,
      shadow_price_paise_at_decision INTEGER NOT NULL,
      reason TEXT NOT NULL,
      FOREIGN KEY (opportunity_id) REFERENCES recovery_opportunities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS authority_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opportunity_id TEXT NOT NULL,
      check_name TEXT NOT NULL,
      passed INTEGER NOT NULL CHECK(passed IN (0, 1)),
      reason TEXT NOT NULL,
      FOREIGN KEY (opportunity_id) REFERENCES recovery_opportunities(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_authority_opp_id ON authority_checks(opportunity_id);

    CREATE TABLE IF NOT EXISTS execution_records (
      opportunity_id TEXT PRIMARY KEY,
      razorpay_payment_link_id TEXT NOT NULL,
      link_url TEXT NOT NULL,
      status TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      FOREIGN KEY (opportunity_id) REFERENCES recovery_opportunities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type IN (
        'webhook_received', 'reconciled', 'recovered', 'not_recovered'
      )),
      amount_paise INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      raw_payload_ref TEXT,
      FOREIGN KEY (opportunity_id) REFERENCES recovery_opportunities(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ledger_opp_id ON ledger_entries(opportunity_id);

    -- ========================================================
    -- AGENT SYSTEM TABLES
    -- ========================================================

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
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_runs_opp ON agent_runs(opportunity_id);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);

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

    CREATE INDEX IF NOT EXISTS idx_agent_states_run ON agent_states(run_id);

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

    CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_steps(run_id);

    CREATE TABLE IF NOT EXISTS agent_tool_calls (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      input_payload TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      output_payload TEXT NOT NULL,
      output_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('SUCCESS', 'DENIED', 'FAILED', 'TIMEOUT')),
      latency_ms INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      permission_level TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tool_calls_run ON agent_tool_calls(run_id);

    CREATE TABLE IF NOT EXISTS agent_plans (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      plan_version INTEGER NOT NULL DEFAULT 1,
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

    CREATE INDEX IF NOT EXISTS idx_agent_plans_run ON agent_plans(run_id);

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

    CREATE TABLE IF NOT EXISTS agent_proposals (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      opportunity_id TEXT NOT NULL,
      proposal_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'SUPERSEDED')),
      review_notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_agent_proposals_opp ON agent_proposals(opportunity_id);

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
      confidence REAL NOT NULL DEFAULT 0.8,
      provenance TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_memories_type ON agent_memories(memory_type);
    CREATE INDEX IF NOT EXISTS idx_agent_memories_created ON agent_memories(created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_memories_opp ON agent_memories(opportunity_id);

    CREATE TABLE IF NOT EXISTS agent_outcomes (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      opportunity_id TEXT NOT NULL,
      predicted_recovery_prob REAL NOT NULL,
      actual_recovered INTEGER NOT NULL CHECK(actual_recovered IN (0, 1)),
      prediction_error REAL NOT NULL,
      actual_revenue_paise INTEGER NOT NULL,
      operational_cost_paise INTEGER NOT NULL,
      net_gain_paise INTEGER NOT NULL,
      customer_response TEXT,
      evaluated_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_agent_outcomes_opp ON agent_outcomes(opportunity_id);

    CREATE TABLE IF NOT EXISTS agent_authority_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      check_name TEXT NOT NULL,
      passed INTEGER NOT NULL CHECK(passed IN (0, 1)),
      reason TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_agent_auth_run ON agent_authority_checks(run_id);

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
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_llm_invocations_run ON llm_invocations(run_id);

    CREATE TABLE IF NOT EXISTS outreach_drafts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      opportunity_id TEXT NOT NULL,
      channel TEXT NOT NULL CHECK(channel IN ('SMS', 'WHATSAPP', 'EMAIL')),
      recipient TEXT NOT NULL,
      subject TEXT,
      body TEXT NOT NULL,
      compliance_footer TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED')),
      review_feedback TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_outreach_drafts_opp ON outreach_drafts(opportunity_id);

    CREATE TABLE IF NOT EXISTS perception_annotations (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL,
      failure_intent TEXT NOT NULL,
      customer_urgency_score REAL NOT NULL,
      merchant_risk_score REAL NOT NULL,
      semantic_notes TEXT NOT NULL,
      confidence REAL NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (opportunity_id) REFERENCES recovery_opportunities(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_perception_annotations_opp ON perception_annotations(opportunity_id);

    -- ========================================================
    -- WEB APP CLIENT CONNECTIONS (Live SDK Tracking)
    -- ========================================================
    CREATE TABLE IF NOT EXISTS web_app_connections (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      app_origin TEXT NOT NULL,
      app_url TEXT,
      app_name TEXT,
      sdk_version TEXT DEFAULT '6.1.0',
      status TEXT NOT NULL DEFAULT 'ONLINE' CHECK(status IN ('ONLINE', 'IDLE', 'OFFLINE')),
      last_ping_at TEXT NOT NULL,
      first_connected_at TEXT NOT NULL,
      metadata TEXT,
      UNIQUE(tenant_id, app_origin)
    );

    CREATE INDEX IF NOT EXISTS idx_web_app_tenant ON web_app_connections(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_web_app_last_ping ON web_app_connections(last_ping_at);

    -- ========================================================
    -- AUTONOMOUS DAEMON LOGS
    -- ========================================================
    CREATE TABLE IF NOT EXISTS daemon_sweep_logs (
      id TEXT PRIMARY KEY,
      sweep_number INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('SUCCESS','PARTIAL','FAILED','ABORTED')),
      opps_scanned INTEGER DEFAULT 0,
      opps_allocated INTEGER DEFAULT 0,
      opps_executed INTEGER DEFAULT 0,
      opps_reconciled INTEGER DEFAULT 0,
      revenue_recovered_paise INTEGER DEFAULT 0,
      error_message TEXT,
      config_snapshot TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_daemon_sweep_logs_started ON daemon_sweep_logs(started_at);

    -- ========================================================
    -- EVENT INGESTION LOGS (Live Stream & Debugging)
    -- ========================================================
    CREATE TABLE IF NOT EXISTS event_ingestion_logs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      event_id TEXT,
      payment_id TEXT,
      source TEXT NOT NULL DEFAULT 'CLIENT_SDK',
      status TEXT NOT NULL CHECK(status IN ('ACCEPTED', 'REJECTED', 'DEDUPLICATED', 'UNAUTHORIZED')),
      status_code INTEGER NOT NULL DEFAULT 200,
      rejection_reason TEXT,
      opportunity_id TEXT,
      raw_payload TEXT NOT NULL,
      origin TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_event_logs_tenant ON event_ingestion_logs(tenant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_logs_event_id ON event_ingestion_logs(event_id);

    -- ========================================================
    -- NOTIFICATIONS (Recovery Activity & System Alerts)
    -- ========================================================
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('LINK_CREATED', 'PAYMENT_RECOVERED', 'SWEEP_COMPLETED', 'INTEGRATION_ERROR', 'KILL_SWITCH_TRIGGERED', 'WHATSAPP_DISPATCHED')),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link_url TEXT,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_tenant_read ON notifications(tenant_id, read, created_at DESC);

    -- ========================================================
    -- WEBHOOK DELIVERY QUEUE & DEAD LETTER STORAGE
    -- ========================================================
    CREATE TABLE IF NOT EXISTS webhook_delivery_queue (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'RAZORPAY_WEBHOOK',
      event_id TEXT,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      headers TEXT,
      status TEXT NOT NULL CHECK(status IN ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'DEAD_LETTER')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      last_error TEXT,
      next_retry_at TEXT,
      delivered_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_webhook_queue_tenant ON webhook_delivery_queue(tenant_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_webhook_queue_retry ON webhook_delivery_queue(status, next_retry_at);

    -- ========================================================
    -- DOUBLE ENTRY LEDGER & RECONCILIATION AUDIT TABLES
    -- ========================================================
    CREATE TABLE IF NOT EXISTS double_entry_ledger (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default',
      opportunity_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      debit_account TEXT NOT NULL,
      credit_account TEXT NOT NULL,
      amount_paise BIGINT NOT NULL,
      timestamp TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      entry_hash TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_double_entry_ledger_tenant ON double_entry_ledger(tenant_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_double_entry_ledger_opp ON double_entry_ledger(opportunity_id);

    CREATE TABLE IF NOT EXISTS reconciliation_divergences (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default',
      opportunity_id TEXT NOT NULL,
      webhook_status TEXT,
      poller_status TEXT,
      divergence_type TEXT,
      type TEXT DEFAULT 'STATUS_DIVERGENCE',
      severity TEXT DEFAULT 'MEDIUM',
      description TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN',
      detected_at TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_divergences_tenant ON reconciliation_divergences(tenant_id, status);

    CREATE TABLE IF NOT EXISTS probability_models (
      reason_code TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default',
      p_natural_mean REAL NOT NULL,
      p_interv_mean REAL NOT NULL,
      sample_size INTEGER NOT NULL,
      model_type TEXT NOT NULL CHECK(model_type IN ('STATIC', 'CALIBRATED')),
      status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'CANDIDATE')),
      lift_vs_baseline REAL NOT NULL DEFAULT 0.0,
      p_value REAL NOT NULL DEFAULT 1.0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bandit_arms (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default',
      context_key TEXT NOT NULL,
      alpha_interv REAL NOT NULL DEFAULT 2.0,
      beta_interv REAL NOT NULL DEFAULT 2.0,
      alpha_nat REAL NOT NULL DEFAULT 2.0,
      beta_nat REAL NOT NULL DEFAULT 5.0,
      pull_count INTEGER NOT NULL DEFAULT 0,
      reward_sum REAL NOT NULL DEFAULT 0.0,
      updated_at TEXT NOT NULL,
      UNIQUE(tenant_id, context_key)
    );

    CREATE INDEX IF NOT EXISTS idx_bandit_arms_tenant ON bandit_arms(tenant_id, context_key);

    CREATE TABLE IF NOT EXISTS pacing_bandit_logs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default',
      time_window TEXT NOT NULL,
      pacing_arm TEXT NOT NULL,
      lambda_applied REAL NOT NULL,
      spent_paise INTEGER NOT NULL,
      budget_paise INTEGER NOT NULL,
      reward REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pacing_bandit_logs_tenant ON pacing_bandit_logs(tenant_id, created_at DESC);
  `);

  try {
    db.exec(`ALTER TABLE reconciliation_divergences ADD COLUMN webhook_status TEXT;`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE reconciliation_divergences ADD COLUMN poller_status TEXT;`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE reconciliation_divergences ADD COLUMN divergence_type TEXT;`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE reconciliation_divergences ADD COLUMN detected_at TEXT;`);
  } catch (e) {}
}

// Initial execution
initDatabase();

// Centralized Domain Repositories
export const opportunityRepo = new OpportunityRepository(db);
export const scoreRepo = new ScoreRepository(db);
export const allocationRepo = new AllocationRepository(db);
export const ledgerRepo = new LedgerRepository(db);
export const customerRepo = new CustomerRepository(db);
export const authorityRepo = new AuthorityRepository(db);
export const executionRepo = new ExecutionRepository(db);

// Customers queries
export function getCustomerById(id: string, tenantId?: string): Customer | undefined {
  return customerRepo.getById(id, tenantId);
}

export function getOrCreateCustomer(id: string, defaultTrustScore: number = 0.65, tenantId: string = 'tenant_system_default'): Customer {
  return customerRepo.getOrCreate(id, defaultTrustScore, tenantId);
}

export function upsertCustomer(customer: Customer): void {
  customerRepo.upsert(customer);
}

export function countPriorAttempts(customerId: string, rawPayloadSubstring?: string, tenantId?: string): number {
  return customerRepo.countPriorAttempts(customerId, rawPayloadSubstring, tenantId);
}

// Opportunity queries
export function getOpportunityById(id: string, tenantId?: string): RecoveryOpportunity | undefined {
  return opportunityRepo.getById(id, tenantId);
}

export function getOpportunityByRazorpayEventId(eventId: string): RecoveryOpportunity | undefined {
  return opportunityRepo.getByRazorpayEventId(eventId);
}

export function getAllOpportunities(tenantId?: string, environment?: 'test' | 'live'): RecoveryOpportunity[] {
  return opportunityRepo.getAll(tenantId, environment);
}

export function insertOpportunity(opp: RecoveryOpportunity): void {
  opportunityRepo.insert(opp);
  const syncPromise = syncOpportunityToSupabaseInternal(opp);
  opportunitySyncPromises.set(opp.id, syncPromise);
  syncPromise.finally(() => {
    setTimeout(() => opportunitySyncPromises.delete(opp.id), 30000);
  });
}

export function upsertOpportunity(opp: RecoveryOpportunity): void {
  opportunityRepo.upsert(opp);
  const upsertSyncPromise = syncOpportunityToSupabaseInternal(opp);
  opportunitySyncPromises.set(opp.id, upsertSyncPromise);
  upsertSyncPromise.finally(() => {
    setTimeout(() => opportunitySyncPromises.delete(opp.id), 30000);
  });
}

export function updateOpportunityStatus(id: string, status: OpportunityStatus): void {
  opportunityRepo.updateStatus(id, status);
  updateInSupabase('recovery_opportunities', id, {
    status,
  });
}

// Scores queries
export function getScoreByOpportunityId(opportunityId: string): Score | undefined {
  return scoreRepo.getByOpportunityId(opportunityId);
}

export function upsertScore(score: Score): void {
  scoreRepo.upsert(score);
  syncToSupabase('scores', {
    opportunity_id: score.opportunity_id,
    tenant_id: score.tenant_id || 'tenant_system_default',
    natural_recovery_prob: score.natural_recovery_prob,
    intervention_recovery_prob: score.intervention_recovery_prob,
    incremental_prob: score.incremental_prob,
    operational_cost_paise: score.operational_cost_paise,
    fatigue_cost_paise: score.fatigue_cost_paise,
    expected_incremental_value_paise: score.expected_incremental_value_paise,
    confidence: score.confidence,
  }, 'opportunity_id');
}

export function getAllScores(tenantId?: string): (Score & { opportunity_id: string })[] {
  return scoreRepo.getAll(tenantId);
}

// Allocation Decisions queries
export function getAllocationDecisionByOpportunityId(oppId: string): AllocationDecision | undefined {
  return allocationRepo.getByOpportunityId(oppId);
}

export function upsertAllocationDecision(decision: AllocationDecision): void {
  allocationRepo.upsert(decision);
  syncToSupabase('allocation_decisions', {
    opportunity_id: decision.opportunity_id,
    decision: decision.decision,
    rank_in_batch: decision.rank_in_batch,
    shadow_price_paise_at_decision: decision.shadow_price_paise_at_decision,
    reason: decision.reason,
  }, 'opportunity_id');
}

export function getAllAllocationDecisions(tenantId?: string): AllocationDecision[] {
  return allocationRepo.getAll(tenantId);
}

// Authority Checks queries
export function ensureOpportunity(oppId: string): void {
  if (!oppId) return;
  const existing = getOpportunityById(oppId);
  if (!existing) {
    upsertOpportunity({
      id: oppId,
      source: 'synthetic',
      amount_paise: 100000,
      currency: 'INR',
      reason_code: 'generic_decline',
      decline_type: 'soft',
      attempt_count: 1,
      customer_id: `cust_${oppId}`,
      customer_trust_score: 0.65,
      created_at: new Date().toISOString(),
      status: 'pending',
      tenant_id: 'tenant_system_default',
      environment: 'test',
    });
  }
}

export function insertAuthorityCheck(check: AuthorityCheck): void {
  ensureOpportunity(check.opportunity_id);
  authorityRepo.insert(check);

  const authPayload: Record<string, any> = {
    opportunity_id: check.opportunity_id,
    check_name: check.check_name,
    passed: Boolean(check.passed),
    reason: check.reason,
  };
  if (typeof check.id === 'number') {
    authPayload.id = check.id;
  }
  syncToSupabase('authority_checks', authPayload, typeof check.id === 'number' ? 'id' : undefined);
}

export function getAuthorityChecksByOpportunityId(oppId: string): AuthorityCheck[] {
  return authorityRepo.getByOpportunityId(oppId);
}

export function clearAuthorityChecksForOpportunity(oppId: string): void {
  authorityRepo.clearForOpportunity(oppId);
}

export function clearAllAuthorityChecks(): void {
  authorityRepo.clearAll();
}

// Execution Records queries
export function upsertExecutionRecord(record: ExecutionRecord): void {
  executionRepo.upsert(record);

  syncToSupabase('execution_records', {
    opportunity_id: record.opportunity_id,
    razorpay_payment_link_id: record.razorpay_payment_link_id,
    link_url: record.link_url,
    status: record.status,
    idempotency_key: record.idempotency_key,
    created_at: record.created_at || new Date().toISOString(),
  }, 'opportunity_id');
}

export function getExecutionRecordByOpportunityId(oppId: string): ExecutionRecord | undefined {
  return executionRepo.getByOpportunityId(oppId);
}

export function getAllExecutionRecords(tenantId?: string): ExecutionRecord[] {
  return executionRepo.getAll(tenantId);
}

// Ledger queries
export function insertLedgerEntry(entry: LedgerEntry): void {
  ledgerRepo.insert(entry);

  syncToSupabase('ledger_entries', {
    id: entry.id,
    opportunity_id: entry.opportunity_id,
    event_type: entry.event_type,
    amount_paise: entry.amount_paise,
    timestamp: entry.timestamp || new Date().toISOString(),
    raw_payload_ref: entry.raw_payload_ref || null,
  }, 'id');
}

export function getLedgerEntriesByOpportunity(oppId: string): LedgerEntry[] {
  return ledgerRepo.getByOpportunity(oppId);
}

export function getAllLedgerEntries(tenantId?: string): LedgerEntry[] {
  return ledgerRepo.getAll(tenantId);
}

// ========================================================
// AGENT SYSTEM QUERIES
// ========================================================

// 1. Agent Runs
export function ensureAgentRun(runId: string, oppId?: string): void {
  if (!runId) return;
  const existing = getAgentRunById(runId);
  if (!existing) {
    insertAgentRun({
      id: runId,
      mission_id: `miss_${runId}`,
      opportunity_id: oppId || null,
      goal_type: 'RECOVER_PAYMENT',
      status: 'running',
      start_time: new Date().toISOString(),
      end_time: null,
      total_steps: 0,
      llm_calls: 0,
      tool_calls: 0,
      replan_count: 0,
      total_tokens: 0,
      latency_ms: 0,
      termination_reason: null,
      created_at: new Date().toISOString(),
    });
  }
}

export function insertAgentRun(run: AgentRunRecord): void {
  const stmt = db.prepare(`
    INSERT INTO agent_runs (
      id, mission_id, opportunity_id, goal_type, status,
      start_time, end_time, total_steps, llm_calls, tool_calls,
      replan_count, total_tokens, latency_ms, termination_reason, created_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?
    )
  `);
  stmt.run(
    run.id,
    run.mission_id,
    run.opportunity_id || null,
    run.goal_type,
    run.status,
    run.start_time,
    run.end_time || null,
    run.total_steps || 0,
    run.llm_calls || 0,
    run.tool_calls || 0,
    run.replan_count || 0,
    run.total_tokens || 0,
    run.latency_ms || 0,
    run.termination_reason || null,
    run.created_at || new Date().toISOString()
  );
}

export function updateAgentRun(run: Partial<AgentRunRecord> & { id: string }): void {
  const existing = getAgentRunById(run.id);
  if (!existing) return;

  const updated: AgentRunRecord = { ...existing, ...run };
  const stmt = db.prepare(`
    UPDATE agent_runs SET
      status = ?,
      end_time = ?,
      total_steps = ?,
      llm_calls = ?,
      tool_calls = ?,
      replan_count = ?,
      total_tokens = ?,
      latency_ms = ?,
      termination_reason = ?
    WHERE id = ?
  `);
  stmt.run(
    updated.status,
    updated.end_time,
    updated.total_steps,
    updated.llm_calls,
    updated.tool_calls,
    updated.replan_count,
    updated.total_tokens,
    updated.latency_ms,
    updated.termination_reason,
    updated.id
  );
}

export function getAgentRunById(id: string): AgentRunRecord | undefined {
  const stmt = db.prepare('SELECT * FROM agent_runs WHERE id = ?');
  return stmt.get(id) as unknown as AgentRunRecord | undefined;
}

export function getAllAgentRuns(): AgentRunRecord[] {
  const stmt = db.prepare('SELECT * FROM agent_runs ORDER BY created_at DESC');
  return stmt.all() as unknown as AgentRunRecord[];
}

export function getAgentRunsByOpportunityId(oppId: string): AgentRunRecord[] {
  const stmt = db.prepare('SELECT * FROM agent_runs WHERE opportunity_id = ? ORDER BY created_at DESC');
  return stmt.all(oppId) as unknown as AgentRunRecord[];
}

// 2. Agent States
export function insertAgentState(state: AgentStateRecord): void {
  ensureAgentRun(state.run_id);
  const stmt = db.prepare(`
    INSERT INTO agent_states (
      run_id, state, previous_state, trigger, metadata, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    state.run_id,
    state.state,
    state.previous_state || null,
    state.trigger,
    state.metadata || null,
    state.timestamp || new Date().toISOString()
  );
}

export function getAgentStatesByRunId(runId: string): AgentStateRecord[] {
  const stmt = db.prepare('SELECT * FROM agent_states WHERE run_id = ? ORDER BY id ASC');
  return stmt.all(runId) as unknown as AgentStateRecord[];
}

// 3. Agent Steps
export function insertAgentStep(step: AgentStepRecord): void {
  ensureAgentRun(step.run_id);
  const stmt = db.prepare(`
    INSERT INTO agent_steps (
      run_id, step_number, state, observation, thought,
      action_type, action_payload, tool_name, tool_input, tool_output, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    step.run_id,
    step.step_number,
    step.state,
    step.observation || null,
    step.thought || null,
    step.action_type || null,
    step.action_payload || null,
    step.tool_name || null,
    step.tool_input || null,
    step.tool_output || null,
    step.timestamp || new Date().toISOString()
  );
}

export function getAgentStepsByRunId(runId: string): AgentStepRecord[] {
  const stmt = db.prepare('SELECT * FROM agent_steps WHERE run_id = ? ORDER BY step_number ASC');
  return stmt.all(runId) as unknown as AgentStepRecord[];
}

// 4. Agent Tool Calls
export function insertAgentToolCall(call: AgentToolCallRecord): void {
  ensureAgentRun(call.run_id);
  const stmt = db.prepare(`
    INSERT INTO agent_tool_calls (
      id, run_id, tool_name, agent_name, input_payload,
      input_hash, output_payload, output_hash, status,
      latency_ms, error_message, permission_level, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    call.id,
    call.run_id,
    call.tool_name,
    call.agent_name,
    call.input_payload,
    call.input_hash,
    call.output_payload,
    call.output_hash,
    call.status,
    call.latency_ms,
    call.error_message || null,
    call.permission_level,
    call.created_at || new Date().toISOString()
  );
}

export function getAgentToolCallsByRunId(runId: string): AgentToolCallRecord[] {
  const stmt = db.prepare('SELECT * FROM agent_tool_calls WHERE run_id = ? ORDER BY created_at ASC');
  return stmt.all(runId) as unknown as AgentToolCallRecord[];
}

export function getAllAgentToolCalls(): AgentToolCallRecord[] {
  const stmt = db.prepare('SELECT * FROM agent_tool_calls ORDER BY created_at DESC LIMIT 100');
  return stmt.all() as unknown as AgentToolCallRecord[];
}

// 5. Agent Plans
export function insertAgentPlan(plan: AgentPlanRecord): void {
  ensureAgentRun(plan.run_id);
  const stmt = db.prepare(`
    INSERT INTO agent_plans (
      id, run_id, plan_version, goal, steps,
      validity_assumptions, candidate_actions, preferred_action,
      status, invalidation_reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    plan.id,
    plan.run_id,
    plan.plan_version,
    plan.goal,
    JSON.stringify(plan.steps),
    JSON.stringify(plan.validity_assumptions),
    JSON.stringify(plan.candidate_actions),
    plan.preferred_action,
    plan.status,
    plan.invalidation_reason || null,
    plan.created_at || new Date().toISOString()
  );
}

export function updateAgentPlanStatus(planId: string, status: 'ACTIVE' | 'INVALIDATED' | 'EXECUTED' | 'SUPERSEDED', reason?: string): void {
  const stmt = db.prepare('UPDATE agent_plans SET status = ?, invalidation_reason = ? WHERE id = ?');
  stmt.run(status, reason || null, planId);
}

export function getAgentPlansByRunId(runId: string): AgentPlanRecord[] {
  const stmt = db.prepare('SELECT * FROM agent_plans WHERE run_id = ? ORDER BY plan_version ASC');
  const rows = stmt.all(runId) as any[];
  return rows.map((r) => ({
    ...r,
    steps: JSON.parse(r.steps || '[]'),
    validity_assumptions: JSON.parse(r.validity_assumptions || '[]'),
    candidate_actions: JSON.parse(r.candidate_actions || '[]'),
  }));
}

export function getActivePlanByRunId(runId: string): AgentPlanRecord | undefined {
  const stmt = db.prepare("SELECT * FROM agent_plans WHERE run_id = ? AND status = 'ACTIVE' ORDER BY plan_version DESC LIMIT 1");
  const r = stmt.get(runId) as any;
  if (!r) return undefined;
  return {
    ...r,
    steps: JSON.parse(r.steps || '[]'),
    validity_assumptions: JSON.parse(r.validity_assumptions || '[]'),
    candidate_actions: JSON.parse(r.candidate_actions || '[]'),
  };
}

// 6. Agent Hypotheses
export function insertAgentHypothesis(hyp: AgentHypothesisRecord): void {
  ensureAgentRun(hyp.run_id);
  const stmt = db.prepare(`
    INSERT INTO agent_hypotheses (
      id, run_id, failure_category, root_cause_hypothesis,
      confidence, supporting_evidence, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    hyp.id,
    hyp.run_id,
    hyp.failure_category,
    hyp.root_cause_hypothesis,
    hyp.confidence,
    JSON.stringify(hyp.supporting_evidence),
    hyp.created_at || new Date().toISOString()
  );
}

export function getAgentHypothesesByRunId(runId: string): AgentHypothesisRecord[] {
  const stmt = db.prepare('SELECT * FROM agent_hypotheses WHERE run_id = ? ORDER BY created_at ASC');
  const rows = stmt.all(runId) as any[];
  return rows.map((r) => ({
    ...r,
    supporting_evidence: JSON.parse(r.supporting_evidence || '[]'),
  }));
}

// 7. Agent Proposals
export function insertAgentProposal(prop: AgentProposalRecord): void {
  ensureAgentRun(prop.run_id, prop.opportunity_id);
  const stmt = db.prepare(`
    INSERT INTO agent_proposals (
      id, run_id, opportunity_id, proposal_type,
      payload, status, review_notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    prop.id,
    prop.run_id,
    prop.opportunity_id,
    prop.proposal_type,
    JSON.stringify(prop.payload),
    prop.status,
    prop.review_notes || null,
    prop.created_at || new Date().toISOString()
  );
}

export function updateAgentProposalStatus(id: string, status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED', notes?: string): void {
  const stmt = db.prepare('UPDATE agent_proposals SET status = ?, review_notes = ? WHERE id = ?');
  stmt.run(status, notes || null, id);
}

export function getAgentProposalsByOpportunityId(oppId: string): AgentProposalRecord[] {
  const stmt = db.prepare('SELECT * FROM agent_proposals WHERE opportunity_id = ? ORDER BY created_at DESC');
  const rows = stmt.all(oppId) as any[];
  return rows.map((r) => ({
    ...r,
    payload: JSON.parse(r.payload || '{}'),
  }));
}

export function getAllAgentProposals(): AgentProposalRecord[] {
  const stmt = db.prepare('SELECT * FROM agent_proposals ORDER BY created_at DESC');
  const rows = stmt.all() as any[];
  return rows.map((r) => ({
    ...r,
    payload: JSON.parse(r.payload || '{}'),
  }));
}

// 8. Agent Memories
export function insertAgentMemory(mem: AgentMemoryItem): void {
  const stmt = db.prepare(`
    INSERT INTO agent_memories (
      id, memory_type, run_id, opportunity_id, failure_type,
      context_summary, action_taken, predicted_outcome, actual_outcome,
      prediction_error, semantic_key, semantic_value, confidence, provenance, created_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `);
  stmt.run(
    mem.id,
    mem.memory_type,
    mem.run_id || null,
    mem.opportunity_id || null,
    mem.failure_type || null,
    mem.context_summary,
    mem.action_taken || null,
    mem.predicted_outcome || null,
    mem.actual_outcome || null,
    mem.prediction_error !== undefined ? mem.prediction_error : null,
    mem.semantic_key || null,
    mem.semantic_value || null,
    mem.confidence,
    mem.provenance,
    mem.created_at || new Date().toISOString()
  );
}

export function getMemories(type?: 'working' | 'episodic' | 'semantic', maxTimestamp?: string): AgentMemoryItem[] {
  let query = 'SELECT * FROM agent_memories WHERE 1=1';
  const params: any[] = [];
  if (type) {
    query += ' AND memory_type = ?';
    params.push(type);
  }
  if (maxTimestamp) {
    query += ' AND created_at <= ?';
    params.push(maxTimestamp);
  }
  query += ' ORDER BY created_at DESC';
  const stmt = db.prepare(query);
  return stmt.all(...params) as unknown as AgentMemoryItem[];
}

export function getEpisodicMemories(failureType?: string, maxTimestamp?: string): AgentMemoryItem[] {
  let query = "SELECT * FROM agent_memories WHERE memory_type = 'episodic'";
  const params: any[] = [];
  if (failureType) {
    query += ' AND failure_type = ?';
    params.push(failureType);
  }
  if (maxTimestamp) {
    query += ' AND created_at <= ?';
    params.push(maxTimestamp);
  }
  query += ' ORDER BY created_at DESC LIMIT 50';
  const stmt = db.prepare(query);
  return stmt.all(...params) as unknown as AgentMemoryItem[];
}

export function getSemanticMemories(keyPrefix?: string, maxTimestamp?: string): AgentMemoryItem[] {
  let query = "SELECT * FROM agent_memories WHERE memory_type = 'semantic'";
  const params: any[] = [];
  if (keyPrefix) {
    query += ' AND semantic_key LIKE ?';
    params.push(`${keyPrefix}%`);
  }
  if (maxTimestamp) {
    query += ' AND created_at <= ?';
    params.push(maxTimestamp);
  }
  query += ' ORDER BY created_at DESC';
  const stmt = db.prepare(query);
  return stmt.all(...params) as unknown as AgentMemoryItem[];
}

export function getWorkingMemoryForRun(runId: string): AgentMemoryItem[] {
  const stmt = db.prepare("SELECT * FROM agent_memories WHERE memory_type = 'working' AND run_id = ? ORDER BY created_at ASC");
  return stmt.all(runId) as unknown as AgentMemoryItem[];
}

// 9. Agent Outcomes
export function insertAgentOutcome(outcome: AgentOutcomeRecord): void {
  ensureAgentRun(outcome.run_id, outcome.opportunity_id);
  const stmt = db.prepare(`
    INSERT INTO agent_outcomes (
      id, run_id, opportunity_id, predicted_recovery_prob, actual_recovered,
      prediction_error, actual_revenue_paise, operational_cost_paise,
      net_gain_paise, customer_response, evaluated_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?
    )
  `);
  stmt.run(
    outcome.id,
    outcome.run_id,
    outcome.opportunity_id,
    outcome.predicted_recovery_prob,
    outcome.actual_recovered ? 1 : 0,
    outcome.prediction_error,
    outcome.actual_revenue_paise,
    outcome.operational_cost_paise,
    outcome.net_gain_paise,
    outcome.customer_response || null,
    outcome.evaluated_at || new Date().toISOString()
  );
}

export function getAgentOutcomeByOpportunityId(oppId: string): AgentOutcomeRecord | undefined {
  const stmt = db.prepare('SELECT * FROM agent_outcomes WHERE opportunity_id = ?');
  const r = stmt.get(oppId) as any;
  if (!r) return undefined;
  return {
    ...r,
    actual_recovered: Boolean(r.actual_recovered),
  };
}

export function getAllAgentOutcomes(): AgentOutcomeRecord[] {
  const stmt = db.prepare('SELECT * FROM agent_outcomes ORDER BY evaluated_at DESC');
  const rows = stmt.all() as any[];
  return rows.map((r) => ({
    ...r,
    actual_recovered: Boolean(r.actual_recovered),
  }));
}

// 10. Agent Authority Checks
export function insertAgentAuthorityCheck(check: AgentAuthorityCheckRecord): void {
  ensureAgentRun(check.run_id);
  const stmt = db.prepare(`
    INSERT INTO agent_authority_checks (
      run_id, tool_name, agent_name, check_name, passed, reason, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    check.run_id,
    check.tool_name,
    check.agent_name,
    check.check_name,
    check.passed ? 1 : 0,
    check.reason,
    check.timestamp || new Date().toISOString()
  );
}

export function getAgentAuthorityChecksByRunId(runId: string): AgentAuthorityCheckRecord[] {
  const stmt = db.prepare('SELECT * FROM agent_authority_checks WHERE run_id = ? ORDER BY id ASC');
  const rows = stmt.all(runId) as any[];
  return rows.map((r) => ({
    ...r,
    passed: Boolean(r.passed),
  }));
}

// 11. LLM Invocations
export function insertLLMInvocation(inv: LLMInvocationRecord): void {
  ensureAgentRun(inv.run_id);
  const stmt = db.prepare(`
    INSERT INTO llm_invocations (
      id, run_id, model, provider, prompt_hash,
      prompt_preview, completion_hash, completion_preview, reasoning_preview,
      latency_ms, prompt_tokens, completion_tokens, total_tokens, error, created_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `);
  stmt.run(
    inv.id,
    inv.run_id,
    inv.model,
    inv.provider,
    inv.prompt_hash,
    inv.prompt_preview,
    inv.completion_hash,
    inv.completion_preview,
    inv.reasoning_preview || null,
    inv.latency_ms,
    inv.prompt_tokens,
    inv.completion_tokens,
    inv.total_tokens,
    inv.error || null,
    inv.created_at || new Date().toISOString()
  );
}

export function getLLMInvocationsByRunId(runId: string): LLMInvocationRecord[] {
  const stmt = db.prepare('SELECT * FROM llm_invocations WHERE run_id = ? ORDER BY created_at ASC');
  return stmt.all(runId) as unknown as LLMInvocationRecord[];
}

export function getAllLLMInvocations(): LLMInvocationRecord[] {
  const stmt = db.prepare('SELECT * FROM llm_invocations ORDER BY created_at DESC LIMIT 100');
  return stmt.all() as unknown as LLMInvocationRecord[];
}

// 12. Outreach Drafts
export function insertOutreachDraft(draft: OutreachDraftRecord): void {
  ensureAgentRun(draft.run_id, draft.opportunity_id);
  const stmt = db.prepare(`
    INSERT INTO outreach_drafts (
      id, run_id, opportunity_id, channel, recipient,
      subject, body, compliance_footer, status, review_feedback, created_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `);
  stmt.run(
    draft.id,
    draft.run_id,
    draft.opportunity_id,
    draft.channel,
    draft.recipient,
    draft.subject || null,
    draft.body,
    draft.compliance_footer,
    draft.status || 'PENDING_REVIEW',
    draft.review_feedback || null,
    draft.created_at || new Date().toISOString()
  );
}

export function updateOutreachDraftStatus(id: string, status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED', feedback?: string): void {
  const stmt = db.prepare('UPDATE outreach_drafts SET status = ?, review_feedback = ? WHERE id = ?');
  stmt.run(status, feedback || null, id);
}

export function getOutreachDraftsByOpportunityId(oppId: string): OutreachDraftRecord[] {
  const stmt = db.prepare('SELECT * FROM outreach_drafts WHERE opportunity_id = ? ORDER BY created_at DESC');
  return stmt.all(oppId) as unknown as OutreachDraftRecord[];
}

export function getAllOutreachDrafts(): OutreachDraftRecord[] {
  const stmt = db.prepare('SELECT * FROM outreach_drafts ORDER BY created_at DESC');
  return stmt.all() as unknown as OutreachDraftRecord[];
}

// 13. Perception Annotations
export function insertPerceptionAnnotation(ann: PerceptionAnnotationRecord): void {
  ensureOpportunity(ann.opportunity_id);
  const stmt = db.prepare(`
    INSERT INTO perception_annotations (
      id, opportunity_id, failure_intent, customer_urgency_score,
      merchant_risk_score, semantic_notes, confidence, created_at
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      failure_intent = excluded.failure_intent,
      customer_urgency_score = excluded.customer_urgency_score,
      merchant_risk_score = excluded.merchant_risk_score,
      semantic_notes = excluded.semantic_notes,
      confidence = excluded.confidence
  `);
  stmt.run(
    ann.id,
    ann.opportunity_id,
    ann.failure_intent,
    ann.customer_urgency_score,
    ann.merchant_risk_score,
    ann.semantic_notes,
    ann.confidence,
    ann.created_at || new Date().toISOString()
  );
}

export function getPerceptionAnnotationByOpportunityId(oppId: string): PerceptionAnnotationRecord | undefined {
  const stmt = db.prepare('SELECT * FROM perception_annotations WHERE opportunity_id = ?');
  return stmt.get(oppId) as unknown as PerceptionAnnotationRecord | undefined;
}

// 14. Web App Connections (Live Client SDK Tracking)
export interface WebAppConnection {
  id: string;
  tenant_id: string;
  app_origin: string;
  app_url?: string | null;
  app_name?: string | null;
  sdk_version?: string | null;
  status: 'ONLINE' | 'IDLE' | 'OFFLINE';
  last_ping_at: string;
  first_connected_at: string;
  metadata?: string | null;
}

export function upsertWebAppConnection(conn: Partial<WebAppConnection> & { tenant_id: string; app_origin: string }): WebAppConnection {
  const now = new Date().toISOString();
  const id = conn.id || `wac_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const sdkVersion = conn.sdk_version || '6.1.0';

  const stmt = db.prepare(`
    INSERT INTO web_app_connections (
      id, tenant_id, app_origin, app_url, app_name, sdk_version, status, last_ping_at, first_connected_at, metadata
    ) VALUES (
      ?, ?, ?, ?, ?, ?, 'ONLINE', ?, ?, ?
    )
    ON CONFLICT(tenant_id, app_origin) DO UPDATE SET
      app_url = COALESCE(excluded.app_url, web_app_connections.app_url),
      app_name = COALESCE(excluded.app_name, web_app_connections.app_name),
      sdk_version = excluded.sdk_version,
      status = 'ONLINE',
      last_ping_at = excluded.last_ping_at,
      metadata = COALESCE(excluded.metadata, web_app_connections.metadata)
  `);

  stmt.run(
    id,
    conn.tenant_id,
    conn.app_origin,
    conn.app_url || null,
    conn.app_name || null,
    sdkVersion,
    now,
    conn.first_connected_at || now,
    conn.metadata || null
  );

  return {
    id,
    tenant_id: conn.tenant_id,
    app_origin: conn.app_origin,
    app_url: conn.app_url || null,
    app_name: conn.app_name || null,
    sdk_version: sdkVersion,
    status: 'ONLINE',
    last_ping_at: now,
    first_connected_at: conn.first_connected_at || now,
    metadata: conn.metadata || null,
  };
}

export function getWebAppConnections(tenantId?: string): WebAppConnection[] {
  const now = Date.now();
  const sql = tenantId
    ? 'SELECT * FROM web_app_connections WHERE tenant_id = ? ORDER BY last_ping_at DESC'
    : 'SELECT * FROM web_app_connections ORDER BY last_ping_at DESC';
  const rows = (tenantId ? db.prepare(sql).all(tenantId) : db.prepare(sql).all()) as any[];

  return rows.map((r) => {
    const lastPingTime = new Date(r.last_ping_at).getTime();
    const ageSeconds = Math.floor((now - lastPingTime) / 1000);
    let status: 'ONLINE' | 'IDLE' | 'OFFLINE' = 'OFFLINE';
    if (ageSeconds <= 90) {
      status = 'ONLINE';
    } else if (ageSeconds <= 300) {
      status = 'IDLE';
    } else {
      status = 'OFFLINE';
    }
    return {
      id: r.id,
      tenant_id: r.tenant_id,
      app_origin: r.app_origin,
      app_url: r.app_url,
      app_name: r.app_name,
      sdk_version: r.sdk_version,
      status,
      last_ping_at: r.last_ping_at,
      first_connected_at: r.first_connected_at,
      metadata: r.metadata,
    };
  });
}

// ========================================================
// AUTONOMOUS DAEMON HELPERS
// ========================================================
export interface DaemonSweepLog {
  id: string;
  sweep_number: number;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'ABORTED';
  opps_scanned: number;
  opps_allocated: number;
  opps_executed: number;
  opps_reconciled: number;
  revenue_recovered_paise: number;
  error_message?: string;
  config_snapshot?: string;
}

export function insertDaemonSweepLog(log: DaemonSweepLog): void {
  const stmt = db.prepare(`
    INSERT INTO daemon_sweep_logs (
      id, sweep_number, started_at, finished_at, duration_ms, status,
      opps_scanned, opps_allocated, opps_executed, opps_reconciled,
      revenue_recovered_paise, error_message, config_snapshot
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    log.id,
    log.sweep_number,
    log.started_at,
    log.finished_at,
    log.duration_ms,
    log.status,
    log.opps_scanned,
    log.opps_allocated,
    log.opps_executed,
    log.opps_reconciled,
    log.revenue_recovered_paise,
    log.error_message || null,
    log.config_snapshot || null
  );
}

export function getDaemonSweepLogs(limit: number = 50): DaemonSweepLog[] {
  const stmt = db.prepare('SELECT * FROM daemon_sweep_logs ORDER BY started_at DESC LIMIT ?');
  return stmt.all(limit) as unknown as DaemonSweepLog[];
}

// ========================================================
// EVENT INGESTION LOG HELPERS (Live Stream)
// ========================================================
export interface EventIngestionLog {
  id: string;
  tenant_id: string;
  event_id?: string;
  payment_id?: string | null;
  source: string;
  status: 'ACCEPTED' | 'REJECTED' | 'DEDUPLICATED' | 'UNAUTHORIZED';
  status_code: number;
  rejection_reason?: string;
  opportunity_id?: string;
  raw_payload: string;
  origin?: string;
  created_at: string;
}

export function insertEventIngestionLog(log: EventIngestionLog): void {
  const stmt = db.prepare(`
    INSERT INTO event_ingestion_logs (
      id, tenant_id, event_id, payment_id, source, status, status_code,
      rejection_reason, opportunity_id, raw_payload, origin, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    log.id,
    log.tenant_id,
    log.event_id || null,
    log.payment_id || null,
    log.source || 'CLIENT_SDK',
    log.status,
    log.status_code,
    log.rejection_reason || null,
    log.opportunity_id || null,
    log.raw_payload,
    log.origin || null,
    log.created_at
  );
}

export function getEventIngestionLogs(options: { tenantId?: string; status?: string; limit?: number } = {}): EventIngestionLog[] {
  const limit = options.limit || 50;
  if (options.tenantId && options.status) {
    const stmt = db.prepare(`
      SELECT * FROM event_ingestion_logs 
      WHERE tenant_id = ? AND status = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `);
    return stmt.all(options.tenantId, options.status, limit) as unknown as EventIngestionLog[];
  } else if (options.tenantId) {
    const stmt = db.prepare(`
      SELECT * FROM event_ingestion_logs 
      WHERE tenant_id = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `);
    return stmt.all(options.tenantId, limit) as unknown as EventIngestionLog[];
  } else if (options.status) {
    const stmt = db.prepare(`
      SELECT * FROM event_ingestion_logs 
      WHERE status = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `);
    return stmt.all(options.status, limit) as unknown as EventIngestionLog[];
  } else {
    const stmt = db.prepare(`
      SELECT * FROM event_ingestion_logs 
      ORDER BY created_at DESC 
      LIMIT ?
    `);
    return stmt.all(limit) as unknown as EventIngestionLog[];
  }
}

// ========================================================
// NOTIFICATION HELPERS
// ========================================================
export type NotificationType =
  | 'LINK_CREATED'
  | 'PAYMENT_RECOVERED'
  | 'SWEEP_COMPLETED'
  | 'INTEGRATION_ERROR'
  | 'KILL_SWITCH_TRIGGERED'
  | 'WHATSAPP_DISPATCHED';

export interface NotificationItem {
  id: string;
  tenant_id: string;
  type: NotificationType;
  title: string;
  message: string;
  link_url?: string;
  read: boolean;
  created_at: string;
}

export function insertNotification(n: Omit<NotificationItem, 'read'> & { read?: boolean }): void {
  const stmt = db.prepare(`
    INSERT INTO notifications (id, tenant_id, type, title, message, link_url, read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    n.id,
    n.tenant_id,
    n.type,
    n.title,
    n.message,
    n.link_url || null,
    n.read ? 1 : 0,
    n.created_at
  );
}

export function getNotifications(tenantId: string, limit: number = 30): NotificationItem[] {
  const stmt = db.prepare(`
    SELECT id, tenant_id, type, title, message, link_url, read, created_at 
    FROM notifications 
    WHERE tenant_id = ? 
    ORDER BY created_at DESC 
    LIMIT ?
  `);
  const rows = stmt.all(tenantId, limit) as any[];
  return rows.map((r) => ({
    ...r,
    read: Boolean(r.read),
  }));
}

export function getUnreadNotificationCount(tenantId: string): number {
  const stmt = db.prepare(`
    SELECT COUNT(*) as unread_count 
    FROM notifications 
    WHERE tenant_id = ? AND read = 0
  `);
  const row = stmt.get(tenantId) as { unread_count: number } | undefined;
  return row ? row.unread_count : 0;
}

export function markNotificationAsRead(id: string, tenantId: string): void {
  const stmt = db.prepare(`
    UPDATE notifications 
    SET read = 1 
    WHERE id = ? AND tenant_id = ?
  `);
  stmt.run(id, tenantId);
}

export function markAllNotificationsAsRead(tenantId: string): void {
  const stmt = db.prepare(`
    UPDATE notifications 
    SET read = 1 
    WHERE tenant_id = ? AND read = 0
  `);
  stmt.run(tenantId);
}

// ========================================================
// WEBHOOK DELIVERY QUEUE & REPLAY HELPERS
// ========================================================
export type WebhookQueueStatus = 'PENDING' | 'PROCESSING' | 'DELIVERED' | 'FAILED' | 'DEAD_LETTER';

export interface WebhookDeliveryQueueItem {
  id: string;
  tenant_id: string;
  source: string;
  event_id?: string;
  event_type: string;
  payload: string;
  headers?: string;
  status: WebhookQueueStatus;
  attempts: number;
  max_attempts: number;
  last_error?: string;
  next_retry_at?: string;
  delivered_at?: string;
  created_at: string;
}

export function insertWebhookDelivery(item: WebhookDeliveryQueueItem): void {
  const stmt = db.prepare(`
    INSERT INTO webhook_delivery_queue (
      id, tenant_id, source, event_id, event_type, payload, headers,
      status, attempts, max_attempts, last_error, next_retry_at, delivered_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    item.id,
    item.tenant_id,
    item.source || 'RAZORPAY_WEBHOOK',
    item.event_id || null,
    item.event_type,
    item.payload,
    item.headers || null,
    item.status || 'PENDING',
    item.attempts || 0,
    item.max_attempts || 5,
    item.last_error || null,
    item.next_retry_at || null,
    item.delivered_at || null,
    item.created_at
  );
}

export function getWebhookDeliveries(options: { tenantId: string; status?: string; limit?: number }): WebhookDeliveryQueueItem[] {
  const limit = options.limit || 50;
  if (options.status && options.status !== 'ALL') {
    const stmt = db.prepare(`
      SELECT * FROM webhook_delivery_queue 
      WHERE tenant_id = ? AND status = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `);
    return stmt.all(options.tenantId, options.status, limit) as unknown as WebhookDeliveryQueueItem[];
  }
  const stmt = db.prepare(`
    SELECT * FROM webhook_delivery_queue 
    WHERE tenant_id = ? 
    ORDER BY created_at DESC 
    LIMIT ?
  `);
  return stmt.all(options.tenantId, limit) as unknown as WebhookDeliveryQueueItem[];
}

export function getWebhookDeliveryById(id: string, tenantId: string): WebhookDeliveryQueueItem | undefined {
  const stmt = db.prepare('SELECT * FROM webhook_delivery_queue WHERE id = ? AND tenant_id = ?');
  return stmt.get(id, tenantId) as unknown as WebhookDeliveryQueueItem | undefined;
}

export function updateWebhookDeliveryStatus(
  id: string,
  status: WebhookQueueStatus,
  options: { attempts?: number; last_error?: string; next_retry_at?: string; delivered_at?: string } = {}
): void {
  const stmt = db.prepare(`
    UPDATE webhook_delivery_queue
    SET status = ?,
        attempts = COALESCE(?, attempts),
        last_error = ?,
        next_retry_at = ?,
        delivered_at = ?
    WHERE id = ?
  `);
  stmt.run(
    status,
    options.attempts !== undefined ? options.attempts : null,
    options.last_error !== undefined ? options.last_error : null,
    options.next_retry_at !== undefined ? options.next_retry_at : null,
    options.delivered_at !== undefined ? options.delivered_at : null,
    id
  );
}

export function getDueWebhookRetries(limit: number = 20): WebhookDeliveryQueueItem[] {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    SELECT * FROM webhook_delivery_queue
    WHERE status IN ('PENDING', 'FAILED') AND (next_retry_at IS NULL OR next_retry_at <= ?)
    ORDER BY created_at ASC
    LIMIT ?
  `);
  return stmt.all(now, limit) as unknown as WebhookDeliveryQueueItem[];
}

export function requeueDeadLetterWebhooks(tenantId: string): number {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE webhook_delivery_queue
    SET status = 'PENDING',
        attempts = 0,
        last_error = 'Manually requeued from Dead Letter Queue',
        next_retry_at = ?
    WHERE tenant_id = ? AND status IN ('DEAD_LETTER', 'FAILED')
  `);
  const info = stmt.run(now, tenantId);
  return Number(info.changes);
}

// ========================================================
// REINFORCEMENT LEARNING: BANDIT ARMS & PACING LOG HELPERS
// ========================================================
export interface BanditArmRecord {
  id: string;
  tenant_id: string;
  context_key: string;
  alpha_interv: number;
  beta_interv: number;
  alpha_nat: number;
  beta_nat: number;
  pull_count: number;
  reward_sum: number;
  updated_at: string;
}

export interface PacingBanditLogRecord {
  id: string;
  tenant_id: string;
  time_window: string;
  pacing_arm: string;
  lambda_applied: number;
  spent_paise: number;
  budget_paise: number;
  reward: number;
  created_at: string;
}

export function getBanditArm(tenantId: string, contextKey: string): BanditArmRecord | undefined {
  const stmt = db.prepare('SELECT * FROM bandit_arms WHERE tenant_id = ? AND context_key = ?');
  return stmt.get(tenantId, contextKey) as unknown as BanditArmRecord | undefined;
}

export function upsertBanditArm(arm: BanditArmRecord): void {
  const stmt = db.prepare(`
    INSERT INTO bandit_arms (
      id, tenant_id, context_key, alpha_interv, beta_interv,
      alpha_nat, beta_nat, pull_count, reward_sum, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, context_key) DO UPDATE SET
      alpha_interv = excluded.alpha_interv,
      beta_interv = excluded.beta_interv,
      alpha_nat = excluded.alpha_nat,
      beta_nat = excluded.beta_nat,
      pull_count = excluded.pull_count,
      reward_sum = excluded.reward_sum,
      updated_at = excluded.updated_at
  `);
  stmt.run(
    arm.id,
    arm.tenant_id,
    arm.context_key,
    arm.alpha_interv,
    arm.beta_interv,
    arm.alpha_nat,
    arm.beta_nat,
    arm.pull_count,
    arm.reward_sum,
    arm.updated_at
  );

  syncToSupabase('bandit_arms', arm as any, 'id');
}

export function getAllBanditArms(tenantId: string): BanditArmRecord[] {
  const stmt = db.prepare('SELECT * FROM bandit_arms WHERE tenant_id = ? ORDER BY pull_count DESC');
  return stmt.all(tenantId) as unknown as BanditArmRecord[];
}

export function insertPacingBanditLog(log: PacingBanditLogRecord): void {
  const stmt = db.prepare(`
    INSERT INTO pacing_bandit_logs (
      id, tenant_id, time_window, pacing_arm, lambda_applied,
      spent_paise, budget_paise, reward, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    log.id,
    log.tenant_id,
    log.time_window,
    log.pacing_arm,
    log.lambda_applied,
    log.spent_paise,
    log.budget_paise,
    log.reward,
    log.created_at
  );

  syncToSupabase('pacing_bandit_logs', log as any, 'id');
}

export function getRecentPacingBanditLogs(tenantId: string, limit: number = 50): PacingBanditLogRecord[] {
  const stmt = db.prepare('SELECT * FROM pacing_bandit_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?');
  return stmt.all(tenantId, limit) as unknown as PacingBanditLogRecord[];
}



