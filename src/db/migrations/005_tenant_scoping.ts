/**
 * Migration 005: Tenant Scoping (SaaS Transformation)
 *
 * Adds `tenant_id` to all core pipeline tables, creates composite indexes,
 * adds capacity_limit + per-tenant kill_switch to the tenants table, and
 * ensures a system default tenant exists for pre-existing data.
 */
import { Migration } from './types.js';
import crypto from 'node:crypto';

export const migration005TenantScoping: Migration = {
  id: '005',
  name: 'tenant_scoping_saas',
  checksum: crypto.createHash('sha256').update('005_tenant_scoping_saas_v1').digest('hex'),

  up: async (db) => {
    const now = new Date().toISOString();

    // Ensure system default tenant exists for legacy data
    await db.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, environment, status, created_at)
       VALUES ('tenant_system_default', 'System Default', 'system_default', 'test', 'ACTIVE', ?);`,
      [now]
    );

    // ── tenants: add SaaS columns ───────────────────────────────────────────
    const tenantAlters = [
      `ALTER TABLE tenants ADD COLUMN capacity_limit INTEGER NOT NULL DEFAULT 5;`,
      `ALTER TABLE tenants ADD COLUMN kill_switch_active INTEGER NOT NULL DEFAULT 0;`,
      `ALTER TABLE tenants ADD COLUMN razorpay_account_id TEXT;`,
    ];
    for (const sql of tenantAlters) {
      try { await db.execute(sql); } catch { /* column already exists */ }
    }

    // ── recovery_opportunities ────────────────────────────────────────────────
    try {
      await db.execute(
        `ALTER TABLE recovery_opportunities ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';`
      );
    } catch { /* column already exists */ }
    try {
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_opp_tenant_status ON recovery_opportunities(tenant_id, status);`
      );
      await db.execute(
        `CREATE INDEX IF NOT EXISTS idx_opp_tenant_created ON recovery_opportunities(tenant_id, created_at);`
      );
    } catch { /* indexes already exist */ }

    // ── customers ──────────────────────────────────────────────────────────────
    try {
      await db.execute(
        `ALTER TABLE customers ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';`
      );
    } catch { /* column already exists */ }
    try {
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);`);
    } catch { /* index already exists */ }

    // ── scores ─────────────────────────────────────────────────────────────────
    try {
      await db.execute(
        `ALTER TABLE scores ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';`
      );
    } catch { /* column already exists */ }

    // ── allocation_decisions ───────────────────────────────────────────────────
    try {
      await db.execute(
        `ALTER TABLE allocation_decisions ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';`
      );
    } catch { /* column already exists */ }

    // ── authority_checks ───────────────────────────────────────────────────────
    try {
      await db.execute(
        `ALTER TABLE authority_checks ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';`
      );
    } catch { /* column already exists */ }

    // ── execution_records ──────────────────────────────────────────────────────
    try {
      await db.execute(
        `ALTER TABLE execution_records ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';`
      );
    } catch { /* column already exists */ }

    // ── ledger_entries ─────────────────────────────────────────────────────────
    try {
      await db.execute(
        `ALTER TABLE ledger_entries ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';`
      );
    } catch { /* column already exists */ }
    try {
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_ledger_tenant ON ledger_entries(tenant_id);`);
    } catch { /* index already exists */ }

    // ── double_entry_ledger (Truth Engine) ─────────────────────────────────────
    try {
      await db.execute(
        `ALTER TABLE double_entry_ledger ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';`
      );
    } catch { /* table may not exist or column already added */ }

    // ── agent_runs ─────────────────────────────────────────────────────────────
    try {
      await db.execute(
        `ALTER TABLE agent_runs ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default';`
      );
    } catch { /* column already exists */ }
    try {
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant ON agent_runs(tenant_id);`);
    } catch { /* index already exists */ }
  },

  down: async (db) => {
    // SQLite cannot drop columns — this is intentionally a no-op.
    console.warn('Migration 005 down: tenant_id columns cannot be auto-dropped in SQLite. Drop manually if needed.');
  },
};
