import { Migration } from './types.js';
import crypto from 'node:crypto';

export const migration004TenancyAndAuth: Migration = {
  id: '004',
  name: 'v6_tenancy_and_auth_schema',
  checksum: crypto.createHash('sha256').update('004_v6_tenancy_and_auth_schema_v1').digest('hex'),
  up: async (db) => {
    // 1. Tenants Table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        environment TEXT NOT NULL CHECK(environment IN ('live', 'test')),
        status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'SUSPENDED', 'PENDING')),
        created_at TEXT NOT NULL
      );
    `);

    // 2. Organizations Table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      );
    `);

    // 3. Users Table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        mfa_enabled INTEGER NOT NULL DEFAULT 0,
        mfa_secret TEXT,
        created_at TEXT NOT NULL
      );
    `);

    // 4. Memberships Table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS memberships (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('Viewer', 'Analyst', 'Operator', 'Admin', 'Owner')),
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
        UNIQUE(user_id, tenant_id)
      );
    `);

    // 5. Sessions Table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      );
    `);

    // 6. API Keys Table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        key_id TEXT NOT NULL UNIQUE,
        secret_hash TEXT NOT NULL,
        environment TEXT NOT NULL CHECK(environment IN ('live', 'test')),
        scopes TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        expires_at TEXT,
        revoked_at TEXT,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      );
    `);

    // 7. Audit Records Table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS audit_records (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        actor_type TEXT NOT NULL CHECK(actor_type IN ('USER', 'API_KEY', 'SYSTEM', 'AGENT')),
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        payload TEXT,
        ip_address TEXT,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      );
    `);

    // 8. Tenant Encrypted Credentials Table (Resolves D6)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS tenant_credentials (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        environment TEXT NOT NULL CHECK(environment IN ('live', 'test')),
        credential_reference TEXT NOT NULL UNIQUE,
        encrypted_data TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
      );
    `);

    // 9. Add tenant_id column to existing tables if missing
    const tablesToTenantScope = [
      'customers',
      'recovery_opportunities',
      'scores',
      'allocation_decisions',
      'authority_checks',
      'execution_records',
      'ledger_entries',
      'agent_runs',
      'agent_memories',
      'agent_outcomes',
      'outreach_drafts',
      'perception_annotations',
      'double_entry_ledger',
    ];

    for (const table of tablesToTenantScope) {
      try {
        await db.execute(`ALTER TABLE ${table} ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_default';`);
      } catch (e) {
        // column already exists
      }
    }

    // 10. Indexes for Tenancy & Security
    await db.execute('CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_memberships_tenant ON memberships(tenant_id);');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_api_keys_key_id ON api_keys(key_id);');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_records(tenant_id);');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_records(timestamp);');
  },
  down: async (db) => {
    await db.execute('DROP TABLE IF EXISTS tenant_credentials;');
    await db.execute('DROP TABLE IF EXISTS audit_records;');
    await db.execute('DROP TABLE IF EXISTS api_keys;');
    await db.execute('DROP TABLE IF EXISTS sessions;');
    await db.execute('DROP TABLE IF EXISTS memberships;');
    await db.execute('DROP TABLE IF EXISTS users;');
    await db.execute('DROP TABLE IF EXISTS organizations;');
    await db.execute('DROP TABLE IF EXISTS tenants;');
  },
};
