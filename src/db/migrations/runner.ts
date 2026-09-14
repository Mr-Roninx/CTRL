import { DatabaseAdapter } from '../adapter.js';
import { Migration, AppliedMigrationRecord } from './types.js';
import { migration001CoreSchema } from './001_core_schema.js';
import { migration002AgentSchema } from './002_agent_schema.js';
import { migration003IndexesAndJsonb } from './003_indexes_and_jsonb.js';
import { migration004TenancyAndAuth } from './004_v6_tenancy_and_auth.js';
import { migration005TenantScoping } from './005_tenant_scoping.js';

export class MigrationRunner {
  private static registeredMigrations: Migration[] = [
    migration001CoreSchema,
    migration002AgentSchema,
    migration003IndexesAndJsonb,
    migration004TenancyAndAuth,
    migration005TenantScoping,
  ];

  /**
   * Initializes the schema_migrations tracking table if it does not already exist.
   */
  public static async initTrackingTable(adapter: DatabaseAdapter): Promise<void> {
    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        execution_time_ms INTEGER NOT NULL
      );
    `);
  }

  /**
   * Returns all currently applied migrations from the database.
   */
  public static async getAppliedMigrations(adapter: DatabaseAdapter): Promise<AppliedMigrationRecord[]> {
    await this.initTrackingTable(adapter);
    const rows = await adapter.query<AppliedMigrationRecord>(
      'SELECT id, name, checksum, applied_at, execution_time_ms FROM schema_migrations ORDER BY id ASC;'
    );
    return rows;
  }

  /**
   * Runs all pending migrations in ascending order with checksum verification.
   */
  public static async migrateUp(adapter?: DatabaseAdapter): Promise<{
    applied: string[];
    skipped: string[];
  }> {
    const db = adapter || DatabaseAdapter.getInstance();
    await this.initTrackingTable(db);

    const appliedRows = await this.getAppliedMigrations(db);
    const appliedMap = new Map(appliedRows.map((r) => [r.id, r]));

    const applied: string[] = [];
    const skipped: string[] = [];

    for (const migration of this.registeredMigrations) {
      const existing = appliedMap.get(migration.id);

      if (existing) {
        if (existing.checksum !== migration.checksum) {
          console.warn(
            `⚠️ Migration checksum mismatch for ${migration.id}_${migration.name}: recorded=${existing.checksum}, current=${migration.checksum}`
          );
        }
        skipped.push(`${migration.id}_${migration.name}`);
        continue;
      }

      console.log(`⏳ Applying migration: ${migration.id}_${migration.name}...`);
      const startTime = Date.now();

      await db.withTransaction(async (tx) => {
        await migration.up(tx);
        const duration = Date.now() - startTime;
        await tx.execute(
          `INSERT INTO schema_migrations (id, name, checksum, applied_at, execution_time_ms) VALUES (?, ?, ?, ?, ?);`,
          [migration.id, migration.name, migration.checksum, new Date().toISOString(), duration]
        );
      });

      console.log(`✅ Applied migration: ${migration.id}_${migration.name} (${Date.now() - startTime}ms)`);
      applied.push(`${migration.id}_${migration.name}`);
    }

    return { applied, skipped };
  }

  /**
   * Rolls back the last N applied migrations.
   */
  public static async migrateDown(
    steps = 1,
    adapter?: DatabaseAdapter
  ): Promise<{ rolledBack: string[] }> {
    const db = adapter || DatabaseAdapter.getInstance();
    await this.initTrackingTable(db);

    const appliedRows = await this.getAppliedMigrations(db);
    if (appliedRows.length === 0) {
      return { rolledBack: [] };
    }

    const toRollback = appliedRows.slice(-steps).reverse();
    const rolledBack: string[] = [];

    for (const applied of toRollback) {
      const migration = this.registeredMigrations.find((m) => m.id === applied.id);
      if (!migration) {
        throw new Error(`Cannot rollback unknown migration: ${applied.id}_${applied.name}`);
      }

      console.log(`⏳ Rolling back migration: ${migration.id}_${migration.name}...`);
      await db.withTransaction(async (tx) => {
        await migration.down(tx);
        await tx.execute('DELETE FROM schema_migrations WHERE id = ?;', [migration.id]);
      });

      console.log(`↩️ Rolled back migration: ${migration.id}_${migration.name}`);
      rolledBack.push(`${migration.id}_${migration.name}`);
    }

    return { rolledBack };
  }

  /**
   * Returns migration status comparison.
   */
  public static async getStatus(adapter?: DatabaseAdapter): Promise<any[]> {
    const db = adapter || DatabaseAdapter.getInstance();
    await this.initTrackingTable(db);

    const applied = await this.getAppliedMigrations(db);
    const appliedMap = new Map(applied.map((r) => [r.id, r]));

    return this.registeredMigrations.map((m) => {
      const isApplied = appliedMap.has(m.id);
      const record = appliedMap.get(m.id);
      return {
        id: m.id,
        name: m.name,
        checksum: m.checksum,
        status: isApplied ? 'APPLIED' : 'PENDING',
        applied_at: record?.applied_at || null,
        execution_time_ms: record?.execution_time_ms || null,
      };
    });
  }
}
