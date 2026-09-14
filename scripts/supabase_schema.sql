-- ====================================================================
-- CTRL: Supabase PostgreSQL Complete Schema
-- Safe, Idempotent, Migration-Resilient Schema Script
-- Execute this script in your Supabase Project -> SQL Editor
-- ====================================================================

-- 1. Schema Migrations Tracker
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  execution_time_ms INTEGER NOT NULL DEFAULT 0
);

-- 2. Tenants Table
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  environment TEXT NOT NULL DEFAULT 'test' CHECK(environment IN ('test', 'live')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'SUSPENDED', 'REVOKED', 'PENDING')),
  capacity_limit INTEGER NOT NULL DEFAULT 5,
  kill_switch_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Users Table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_secret TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Memberships Table (Multi-tenant RBAC)
CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('Owner', 'Admin', 'Operator', 'Analyst', 'Viewer')),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_tenant ON memberships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);

-- Also create tenant_memberships view/table for backwards compatibility
CREATE TABLE IF NOT EXISTS tenant_memberships (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('Owner', 'Admin', 'Operator', 'Analyst', 'Viewer')),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id)
);

-- 5. Tenant Encrypted Credentials (AES-256-GCM)
CREATE TABLE IF NOT EXISTS tenant_credentials (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment IN ('test', 'live')),
  credential_reference TEXT NOT NULL,
  encrypted_blob TEXT,
  encrypted_data TEXT,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, credential_reference)
);

CREATE INDEX IF NOT EXISTS idx_credentials_tenant ON tenant_credentials(tenant_id);

-- 6. API Keys Table
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_id TEXT UNIQUE,
  key_hash TEXT,
  secret_hash TEXT,
  environment TEXT DEFAULT 'test' CHECK(environment IN ('test', 'live')),
  scopes JSONB NOT NULL DEFAULT '["events:write", "opportunities:read"]'::jsonb,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON api_keys(key_prefix);

-- 7. Customers Table
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default',
  merchant_id TEXT NOT NULL DEFAULT 'merchant_default',
  trust_score REAL NOT NULL DEFAULT 0.65,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Recovery Opportunities Table
CREATE TABLE IF NOT EXISTS recovery_opportunities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default',
  merchant_id TEXT NOT NULL DEFAULT 'merchant_default',
  source TEXT NOT NULL CHECK(source IN ('real', 'synthetic')),
  amount_paise BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  reason_code TEXT NOT NULL,
  decline_type TEXT NOT NULL CHECK(decline_type IN ('hard', 'soft', 'unknown')),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  customer_id TEXT NOT NULL,
  customer_trust_score REAL NOT NULL DEFAULT 0.65,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL CHECK(status IN (
    'pending', 'scored', 'allocated', 'authorized', 'deferred', 'blocked', 'abstained', 'executing', 'recovered', 'not_recovered'
  )),
  razorpay_event_id TEXT UNIQUE,
  raw_payload_ref TEXT
);

-- 9. Scores Table (1:1 with Opportunity)
CREATE TABLE IF NOT EXISTS scores (
  opportunity_id TEXT PRIMARY KEY REFERENCES recovery_opportunities(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default',
  natural_recovery_prob REAL NOT NULL,
  intervention_recovery_prob REAL NOT NULL,
  incremental_prob REAL NOT NULL,
  operational_cost_paise BIGINT NOT NULL,
  fatigue_cost_paise BIGINT NOT NULL,
  expected_incremental_value_paise BIGINT NOT NULL,
  confidence TEXT NOT NULL CHECK(confidence IN ('low', 'medium', 'high'))
);

-- 10. Allocation Decisions Table (1:1 with Opportunity)
CREATE TABLE IF NOT EXISTS allocation_decisions (
  opportunity_id TEXT PRIMARY KEY REFERENCES recovery_opportunities(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default',
  decision TEXT NOT NULL CHECK(decision IN ('ACT', 'WAIT', 'ABSTAIN')),
  rank_in_batch INTEGER NOT NULL,
  shadow_price_paise_at_decision BIGINT NOT NULL,
  reason TEXT NOT NULL
);

-- 11. Authority Checks Table (Many:1 with Opportunity)
CREATE TABLE IF NOT EXISTS authority_checks (
  id BIGSERIAL PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES recovery_opportunities(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default',
  check_name TEXT NOT NULL,
  passed BOOLEAN NOT NULL,
  reason TEXT NOT NULL
);

-- 12. Execution Records Table (1:1 with Opportunity)
CREATE TABLE IF NOT EXISTS execution_records (
  opportunity_id TEXT PRIMARY KEY REFERENCES recovery_opportunities(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default',
  razorpay_payment_link_id TEXT NOT NULL,
  link_url TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. Ledger Entries Table (Append-only)
CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES recovery_opportunities(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default',
  event_type TEXT NOT NULL CHECK(event_type IN (
    'webhook_received', 'reconciled', 'recovered', 'not_recovered'
  )),
  amount_paise BIGINT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload_ref TEXT
);

-- 14. Audit Records Table (Immutable Compliance Audit Trail)
CREATE TABLE IF NOT EXISTS audit_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default',
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('USER', 'API_KEY', 'SYSTEM', 'AGENT')),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  payload JSONB,
  ip_address TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. Sessions Table (Stateful User & API Sessions)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

-- ====================================================================
-- Column Migration & Compatibility Safeguard
-- Ensures all columns exist regardless of previous schema runs
-- ====================================================================
DO $$ 
BEGIN
  -- customers
  ALTER TABLE customers ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';
  ALTER TABLE customers ADD COLUMN IF NOT EXISTS merchant_id TEXT NOT NULL DEFAULT 'merchant_default';
  ALTER TABLE customers ADD COLUMN IF NOT EXISTS trust_score REAL NOT NULL DEFAULT 0.65;
  ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

  -- recovery_opportunities
  ALTER TABLE recovery_opportunities ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';
  ALTER TABLE recovery_opportunities ADD COLUMN IF NOT EXISTS merchant_id TEXT NOT NULL DEFAULT 'merchant_default';
  ALTER TABLE recovery_opportunities ADD COLUMN IF NOT EXISTS razorpay_event_id TEXT;
  ALTER TABLE recovery_opportunities ADD COLUMN IF NOT EXISTS raw_payload_ref TEXT;

  -- scores
  ALTER TABLE scores ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';

  -- allocation_decisions
  ALTER TABLE allocation_decisions ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';

  -- authority_checks
  ALTER TABLE authority_checks ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';

  -- execution_records
  ALTER TABLE execution_records ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';

  -- ledger_entries
  ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';

  -- audit_records
  ALTER TABLE audit_records ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';
END $$;

-- ====================================================================
-- Indexes for High Performance & Multitenant Isolation
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_opps_tenant ON recovery_opportunities(tenant_id);
CREATE INDEX IF NOT EXISTS idx_opps_status ON recovery_opportunities(status);
CREATE INDEX IF NOT EXISTS idx_opps_created ON recovery_opportunities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opps_customer ON recovery_opportunities(customer_id);
CREATE INDEX IF NOT EXISTS idx_scores_tenant ON scores(tenant_id);
CREATE INDEX IF NOT EXISTS idx_alloc_tenant ON allocation_decisions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_authority_opp ON authority_checks(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_authority_tenant ON authority_checks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_exec_tenant ON execution_records(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ledger_opp ON ledger_entries(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_ledger_tenant ON ledger_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_records(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_records(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);

-- ====================================================================
-- 16. Agent System Tables
-- ====================================================================
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default',
  mission_id TEXT NOT NULL,
  opportunity_id TEXT,
  goal_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'aborted', 'human_review')),
  start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_time TIMESTAMPTZ,
  total_steps INTEGER NOT NULL DEFAULT 0,
  llm_calls INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  replan_count INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  termination_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_opp ON agent_runs(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);

CREATE TABLE IF NOT EXISTS agent_states (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  previous_state TEXT,
  trigger TEXT NOT NULL,
  metadata JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_steps (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  state TEXT NOT NULL,
  observation TEXT,
  thought TEXT,
  action_type TEXT,
  action_payload JSONB,
  tool_name TEXT,
  tool_input JSONB,
  tool_output JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  input_payload JSONB,
  input_hash TEXT NOT NULL,
  output_payload JSONB,
  output_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('SUCCESS', 'DENIED', 'FAILED', 'TIMEOUT')),
  latency_ms INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  permission_level TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_plans (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  plan_version INTEGER NOT NULL DEFAULT 1,
  goal TEXT NOT NULL,
  steps JSONB NOT NULL,
  validity_assumptions JSONB,
  candidate_actions JSONB,
  preferred_action TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'INVALIDATED', 'EXECUTED', 'SUPERSEDED')),
  invalidation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_hypotheses (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  failure_category TEXT NOT NULL,
  root_cause_hypothesis TEXT NOT NULL,
  confidence REAL NOT NULL,
  supporting_evidence JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_proposals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL,
  proposal_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'SUPERSEDED')),
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_memories (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default',
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_outcomes (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL,
  predicted_recovery_prob REAL NOT NULL,
  actual_recovered INTEGER NOT NULL CHECK(actual_recovered IN (0, 1)),
  prediction_error REAL NOT NULL,
  actual_revenue_paise BIGINT NOT NULL,
  operational_cost_paise BIGINT NOT NULL,
  net_gain_paise BIGINT NOT NULL,
  customer_response TEXT,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_authority_checks (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  check_name TEXT NOT NULL,
  passed BOOLEAN NOT NULL,
  reason TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS llm_invocations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outreach_drafts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('SMS', 'WHATSAPP', 'EMAIL')),
  recipient TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  compliance_footer TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED')),
  review_feedback TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS perception_annotations (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  failure_intent TEXT NOT NULL,
  customer_urgency_score REAL NOT NULL,
  merchant_risk_score REAL NOT NULL,
  semantic_notes TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, context_key)
);

CREATE INDEX IF NOT EXISTS idx_bandit_arms_tenant ON bandit_arms(tenant_id, context_key);

CREATE TABLE IF NOT EXISTS pacing_bandit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default',
  time_window TEXT NOT NULL,
  pacing_arm TEXT NOT NULL,
  lambda_applied REAL NOT NULL,
  spent_paise BIGINT NOT NULL,
  budget_paise BIGINT NOT NULL,
  reward REAL NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pacing_bandit_logs_tenant ON pacing_bandit_logs(tenant_id, created_at DESC);

-- ====================================================================
-- Realtime Publications for Live Control Plane UI
-- ====================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'recovery_opportunities') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE recovery_opportunities;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'ledger_entries') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE ledger_entries;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'allocation_decisions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE allocation_decisions;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'execution_records') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE execution_records;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;
