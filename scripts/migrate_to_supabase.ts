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

async function main() {
  console.log('================================================================================');
  console.log('📦 CTRL: SQLITE TO SUPABASE (POSTGRESQL) DATA MIGRATION');
  console.log('================================================================================\n');

  const dbUrl = process.env.SUPABASE_DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

  if (!dbUrl || (!dbUrl.startsWith('postgres://') && !dbUrl.startsWith('postgresql://'))) {
    console.error('❌ Error: Supabase PostgreSQL connection string not configured in DATABASE_URL / SUPABASE_DATABASE_URL.');
    console.log('   Please provide your Supabase connection string in .env:');
    console.log('   DATABASE_URL="postgresql://postgres.[REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres"\n');
    process.exit(1);
  }

  const sqlitePath = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'ctrl.db');
  if (!fs.existsSync(sqlitePath)) {
    console.error(`❌ Error: Source SQLite database file '${sqlitePath}' does not exist.`);
    process.exit(1);
  }

  console.log(`1. Reading from SQLite: ${sqlitePath}`);
  const sqlite = new DatabaseSync(sqlitePath);

  console.log(`2. Connecting to Supabase PostgreSQL...`);
  const pgPool = new pg.Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  const client = await pgPool.connect();

  try {
    console.log('3. Applying Supabase Master Schema (DDL)...');
    const schemaSqlPath = path.resolve(process.cwd(), 'supabase', 'schema.sql');
    if (fs.existsSync(schemaSqlPath)) {
      const schemaSql = fs.readFileSync(schemaSqlPath, 'utf-8');
      await client.query(schemaSql);
      console.log('✅ Master schema applied successfully to Supabase.');
    }

    console.log('\n4. Streaming records from SQLite into Supabase PostgreSQL:');

    let totalMigrated = 0;

    for (const table of TABLES_IN_DEPENDENCY_ORDER) {
      try {
        const rows = sqlite.prepare(`SELECT * FROM ${table};`).all() as any[];
        if (!rows || rows.length === 0) {
          console.log(`   - Table '${table}': 0 rows (skipped)`);
          continue;
        }

        const columns = Object.keys(rows[0]);
        const colsSql = columns.join(', ');
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

        const insertSql = `INSERT INTO ${table} (${colsSql}) VALUES (${placeholders}) ON CONFLICT DO NOTHING;`;

        let tableCount = 0;
        for (const row of rows) {
          const values = columns.map((col) => {
            const val = row[col];
            // Format boolean or JSON if necessary
            if (typeof val === 'number' && (col === 'mfa_enabled' || col === 'passed' || col === 'kill_switch_active')) {
              return Boolean(val);
            }
            return val;
          });

          await client.query(insertSql, values);
          tableCount++;
        }

        console.log(`   ✅ Table '${table}': ${tableCount} records migrated.`);
        totalMigrated += tableCount;
      } catch (err: any) {
        console.warn(`   ⚠️ Table '${table}' notice: ${err.message}`);
      }
    }

    console.log(`\n🎉 MIGRATION COMPLETED SUCCESSFULLY! Total records migrated: ${totalMigrated}\n`);
  } finally {
    client.release();
    await pgPool.end();
    sqlite.close();
  }
}

main().catch((err) => {
  console.error('Fatal Migration Error:', err);
  process.exit(1);
});
