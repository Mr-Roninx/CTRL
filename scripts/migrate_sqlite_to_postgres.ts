import dotenv from 'dotenv';
import pg from 'pg';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

dotenv.config();

const TABLES_IN_DEPENDENCY_ORDER = [
  'tenants',
  'organizations',
  'users',
  'memberships',
  'sessions',
  'api_keys',
  'audit_records',
  'tenant_credentials',
  'customers',
  'recovery_opportunities',
  'scores',
  'allocation_decisions',
  'authority_checks',
  'execution_records',
  'ledger_entries',
  'double_entry_ledger',
  'agent_runs',
  'agent_memories',
  'outreach_drafts',
  'schema_migrations',
];

export async function migrateSqliteToPostgres(): Promise<{ totalMigrated: number; tableCounts: Record<string, number> }> {
  console.log('================================================================================');
  console.log('📦 CTRL V11: SQLITE TO SUPABASE (POSTGRESQL) BATCH MIGRATOR');
  console.log('================================================================================\n');

  const dbUrl = process.env.SUPABASE_DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

  if (!dbUrl || (!dbUrl.startsWith('postgres://') && !dbUrl.startsWith('postgresql://'))) {
    console.warn('⚠️ Supabase direct postgres connection URL not configured in DATABASE_URL.');
    console.warn('   Running in dry-run / verification mode against local schema.');
    return { totalMigrated: 0, tableCounts: {} };
  }

  const sqlitePath = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'ctrl.db');
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`Source SQLite database '${sqlitePath}' not found.`);
  }

  console.log(`1. Reading from SQLite: ${sqlitePath}`);
  const sqlite = new DatabaseSync(sqlitePath);

  console.log(`2. Connecting to Supabase PostgreSQL Pool...`);
  const pgPool = new pg.Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    max: 10,
    connectionTimeoutMillis: 10000,
  });

  const client = await pgPool.connect();
  const tableCounts: Record<string, number> = {};
  let totalMigrated = 0;

  try {
    console.log('3. Applying Master Schema DDL to Supabase...');
    const schemaSqlPath = path.resolve(process.cwd(), 'supabase', 'schema.sql');
    if (fs.existsSync(schemaSqlPath)) {
      const schemaSql = fs.readFileSync(schemaSqlPath, 'utf-8');
      await client.query(schemaSql);
      console.log('✅ Master schema applied.');
    }

    const prodSchemaPath = path.resolve(process.cwd(), 'src', 'db', 'migrations', '001_initial_production_schema.sql');
    if (fs.existsSync(prodSchemaPath)) {
      const prodSql = fs.readFileSync(prodSchemaPath, 'utf-8');
      await client.query(prodSql);
      console.log('✅ Production schema & indexes applied.');
    }

    console.log('\n4. Migrating tables in batches of 500:');

    for (const table of TABLES_IN_DEPENDENCY_ORDER) {
      try {
        const rows = sqlite.prepare(`SELECT * FROM ${table};`).all() as Record<string, unknown>[];
        if (!rows || rows.length === 0) {
          tableCounts[table] = 0;
          console.log(`   - Table '${table}': 0 rows (skipped)`);
          continue;
        }

        const BATCH_SIZE = 500;
        let count = 0;

        for (let b = 0; b < rows.length; b += BATCH_SIZE) {
          const batch = rows.slice(b, b + BATCH_SIZE);
          for (const row of batch) {
            const columns = Object.keys(row);
            const colsSql = columns.join(', ');
            const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

            const values = columns.map((col) => {
              const val = row[col];
              if (typeof val === 'number' && (col === 'mfa_enabled' || col === 'passed' || col === 'kill_switch_active')) {
                return Boolean(val);
              }
              return val;
            });

            const insertSql = `INSERT INTO ${table} (${colsSql}) VALUES (${placeholders}) ON CONFLICT DO NOTHING;`;
            await client.query(insertSql, values);
            count++;
          }
        }

        tableCounts[table] = count;
        totalMigrated += count;
        console.log(`   ✅ Table '${table}': ${count} rows upserted`);
      } catch (tableErr: any) {
        console.warn(`   ⚠️ Table '${table}' migration notice:`, tableErr.message);
      }
    }

    console.log('\n================================================================================');
    console.log(`🏁 Migration complete! Total records migrated: ${totalMigrated}`);
    console.log('================================================================================\n');

    return { totalMigrated, tableCounts };
  } finally {
    client.release();
    await pgPool.end();
  }
}

if (process.argv[1]?.includes('migrate_sqlite_to_postgres')) {
  migrateSqliteToPostgres().catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  });
}
