-- ====================================================================
-- CTRL: Enterprise PostgreSQL Production Schema (Migration 001)
-- Safe, Idempotent, High-Throughput Relational Storage
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

CREATE INDEX IF NOT EXISTS idx_tenants_env ON tenants(environment);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

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

-- 5. Tenant Encrypted Credentials (AES-256-GCM Envelope)
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

CREATE INDEX IF NOT EXISTS idx_credentials_tenant_env ON tenant_credentials(tenant_id, environment);

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

CREATE INDEX IF NOT EXISTS idx_api_keys_lookup ON api_keys(key_prefix, status);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);

-- 7. Customers Table & Trust Profiles
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  trust_score REAL NOT NULL DEFAULT 0.65 CHECK(trust_score >= 0.0 AND trust_score <= 1.0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Recovery Opportunities Table (Core Entity)
CREATE TABLE IF NOT EXISTS recovery_opportunities (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK(source IN ('real', 'synthetic')),
  amount_paise BIGINT NOT NULL CHECK(amount_paise > 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  reason_code TEXT NOT NULL,
  decline_type TEXT NOT NULL CHECK(decline_type IN ('hard', 'soft', 'unknown')),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK(attempt_count >= 1),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  customer_trust_score REAL NOT NULL CHECK(customer_trust_score >= 0.0 AND customer_trust_score <= 1.0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
    'pending', 'scored', 'allocated', 'deferred', 'authorized', 'blocked', 'abstained', 'executing', 'recovered', 'not_recovered'
  )),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  environment TEXT NOT NULL DEFAULT 'test' CHECK(environment IN ('test', 'live')),
  razorpay_event_id TEXT,
  raw_payload_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opportunities_tenant_status ON recovery_opportunities(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_opportunities_customer ON recovery_opportunities(customer_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_created ON recovery_opportunities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_event ON recovery_opportunities(razorpay_event_id);

-- 9. Economic Scores (1:1 with Opportunity)
CREATE TABLE IF NOT EXISTS scores (
  opportunity_id TEXT PRIMARY KEY REFERENCES recovery_opportunities(id) ON DELETE CASCADE,
  natural_recovery_prob REAL NOT NULL CHECK(natural_recovery_prob >= 0.0 AND natural_recovery_prob <= 1.0),
  intervention_recovery_prob REAL NOT NULL CHECK(intervention_recovery_prob >= 0.0 AND intervention_recovery_prob <= 1.0),
  incremental_prob REAL NOT NULL,
  operational_cost_paise BIGINT NOT NULL DEFAULT 0,
  fatigue_cost_paise BIGINT NOT NULL DEFAULT 0,
  expected_incremental_value_paise BIGINT NOT NULL,
  confidence TEXT NOT NULL CHECK(confidence IN ('low', 'medium', 'high')),
  bayesian_alpha REAL DEFAULT 1.0,
  bayesian_beta REAL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Allocation Decisions (Market Decisions)
CREATE TABLE IF NOT EXISTS allocation_decisions (
  opportunity_id TEXT PRIMARY KEY REFERENCES recovery_opportunities(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK(decision IN ('ACT', 'WAIT', 'ABSTAIN')),
  rank_in_batch INTEGER NOT NULL DEFAULT 0,
  shadow_price_paise_at_decision BIGINT NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_allocations_decision ON allocation_decisions(decision);

-- 11. Action Authority Checks (Many:1 with Opportunity)
CREATE TABLE IF NOT EXISTS authority_checks (
  id BIGSERIAL PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES recovery_opportunities(id) ON DELETE CASCADE,
  check_name TEXT NOT NULL,
  passed BOOLEAN NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_authority_checks_opp ON authority_checks(opportunity_id);

-- 12. Execution Records (Payment Links)
CREATE TABLE IF NOT EXISTS execution_records (
  opportunity_id TEXT PRIMARY KEY REFERENCES recovery_opportunities(id) ON DELETE CASCADE,
  razorpay_payment_link_id TEXT NOT NULL,
  link_url TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_execution_records_plink ON execution_records(razorpay_payment_link_id);
CREATE INDEX IF NOT EXISTS idx_execution_records_idemp ON execution_records(idempotency_key);

-- 13. Immutable Double-Entry Ledger Entries
CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES recovery_opportunities(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN ('webhook_received', 'reconciled', 'recovered', 'not_recovered')),
  amount_paise BIGINT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload_ref TEXT,
  state_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_ledger_opp ON ledger_entries(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_ledger_event_type ON ledger_entries(event_type);
CREATE INDEX IF NOT EXISTS idx_ledger_timestamp ON ledger_entries(timestamp DESC);

-- 14. Sessions Table (Stateful User & API Sessions)
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

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON sessions(tenant_id);

-- 15. Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link_url TEXT,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ====================================================================
-- Safe Column Migration Safeguard (Protects against any pre-existing tables)
-- ====================================================================
ALTER TABLE IF EXISTS notifications ADD COLUMN IF NOT EXISTS read BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE IF EXISTS notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS notifications ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';

ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';
ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS merchant_id TEXT NOT NULL DEFAULT 'merchant_default';
ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS trust_score REAL NOT NULL DEFAULT 0.65;
ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE IF EXISTS recovery_opportunities ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';
ALTER TABLE IF EXISTS recovery_opportunities ADD COLUMN IF NOT EXISTS merchant_id TEXT NOT NULL DEFAULT 'merchant_default';
ALTER TABLE IF EXISTS recovery_opportunities ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'test';
ALTER TABLE IF EXISTS recovery_opportunities ADD COLUMN IF NOT EXISTS razorpay_event_id TEXT;
ALTER TABLE IF EXISTS recovery_opportunities ADD COLUMN IF NOT EXISTS raw_payload_ref TEXT;

ALTER TABLE IF EXISTS scores ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';
ALTER TABLE IF EXISTS scores ADD COLUMN IF NOT EXISTS bayesian_alpha REAL DEFAULT 1.0;
ALTER TABLE IF EXISTS scores ADD COLUMN IF NOT EXISTS bayesian_beta REAL DEFAULT 1.0;

ALTER TABLE IF EXISTS allocation_decisions ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';

ALTER TABLE IF EXISTS authority_checks ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';

ALTER TABLE IF EXISTS execution_records ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';

ALTER TABLE IF EXISTS ledger_entries ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';
ALTER TABLE IF EXISTS ledger_entries ADD COLUMN IF NOT EXISTS state_hash TEXT;

ALTER TABLE IF EXISTS memberships ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id, read, created_at DESC);

-- ====================================================================
-- Default System Tenant & Demo Account Seeds (Safe & Idempotent)
-- ====================================================================
INSERT INTO tenants (id, name, slug, environment, status, capacity_limit, kill_switch_active)
VALUES 
  ('tenant_system_default', 'System Default Organization', 'system-default', 'test', 'ACTIVE', 5, FALSE),
  ('tenant_demo_merchant', 'Apex Sound Labs (Demo)', 'apex-sound-labs', 'test', 'ACTIVE', 5, FALSE)
ON CONFLICT (id) DO UPDATE SET
  status = 'ACTIVE',
  capacity_limit = EXCLUDED.capacity_limit;

INSERT INTO users (id, email, name, password_hash, mfa_enabled)
VALUES (
  'usr_demo_merchant',
  'demo@ctrl.app',
  'Apex Sound Labs (Demo)',
  'argon2id$v=19$m=65536,t=3,p=4$dGVzdHNhbHQ$dGVzdGhhc2g',
  FALSE
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO memberships (id, user_id, tenant_id, role, status)
VALUES (
  'mem_demo_merchant',
  'usr_demo_merchant',
  'tenant_system_default',
  'Owner',
  'ACTIVE'
)
ON CONFLICT (tenant_id, user_id) DO NOTHING;

-- Seed Migration Record
INSERT INTO schema_migrations (id, name, checksum, applied_at, execution_time_ms)
VALUES ('001', '001_initial_production_schema.sql', 'sha256_ctrl_prod_001', NOW(), 12)
ON CONFLICT (id) DO NOTHING;

-- Confirmation query
SELECT 'CTRL Schema initialized successfully!' AS status, count(*) AS total_tenants FROM tenants;

