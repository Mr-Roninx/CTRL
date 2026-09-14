import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

dotenv.config();

interface TableConfig {
  name: string;
  pk: string;
}

const TABLES: TableConfig[] = [
  { name: 'tenants', pk: 'id' },
  { name: 'users', pk: 'id' },
  { name: 'memberships', pk: 'id' },
  { name: 'sessions', pk: 'id' },
  { name: 'audit_records', pk: 'id' },
  { name: 'customers', pk: 'id' },
  { name: 'recovery_opportunities', pk: 'id' },
  { name: 'scores', pk: 'opportunity_id' },
  { name: 'allocation_decisions', pk: 'opportunity_id' },
  { name: 'authority_checks', pk: 'id' },
  { name: 'execution_records', pk: 'opportunity_id' },
  { name: 'ledger_entries', pk: 'id' },
  { name: 'agent_runs', pk: 'id' },
  { name: 'agent_memories', pk: 'id' },
  { name: 'outreach_drafts', pk: 'id' },
];

async function main() {
  console.log('================================================================================');
  console.log('📦 CTRL: SQLITE TO SUPABASE CLOUD MIGRATION (V2)');
  console.log('================================================================================\n');

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

  const client = createClient(supabaseUrl, supabaseKey);

  const sqlitePath = path.resolve(process.cwd(), 'ctrl.db');
  if (!fs.existsSync(sqlitePath)) {
    console.error(`❌ Source SQLite database file not found at: ${sqlitePath}`);
    process.exit(1);
  }

  console.log(`1. Reading source SQLite database: ${sqlitePath}`);
  const sqlite = new DatabaseSync(sqlitePath);

  console.log(`2. Target Supabase Project: ${supabaseUrl}\n`);

  let totalMigrated = 0;

  for (const { name: table, pk } of TABLES) {
    try {
      const tableExists = sqlite.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?;"
      ).get(table);

      if (!tableExists) {
        console.log(`- Table '${table}': Not present in SQLite (skipped)`);
        continue;
      }

      const rows = sqlite.prepare(`SELECT * FROM ${table};`).all() as any[];
      if (!rows || rows.length === 0) {
        console.log(`- Table '${table}': 0 rows (skipped)`);
        continue;
      }

      console.log(`Streaming ${rows.length} rows for table '${table}' (PK: ${pk}) to Supabase...`);

      // Transform booleans and values
      const cleanRows = rows.map((row) => {
        const clean: Record<string, any> = {};
        for (const [k, v] of Object.entries(row)) {
          if (typeof v === 'number' && (k === 'mfa_enabled' || k === 'passed' || k === 'kill_switch_active' || k === 'read')) {
            clean[k] = Boolean(v);
          } else {
            clean[k] = v;
          }
        }
        return clean;
      });

      const batchSize = 50;
      let insertedCount = 0;

      for (let i = 0; i < cleanRows.length; i += batchSize) {
        const batch = cleanRows.slice(i, i + batchSize);
        const { error } = await client.from(table).upsert(batch, { onConflict: pk });

        if (error) {
          console.warn(`  ⚠️ Warning on table '${table}': ${error.message}`);
        } else {
          insertedCount += batch.length;
        }
      }

      console.log(`  ✅ Table '${table}': Successfully migrated ${insertedCount} rows.`);
      totalMigrated += insertedCount;
    } catch (err: any) {
      console.warn(`  ⚠️ Skipped table '${table}': ${err.message}`);
    }
  }

  console.log('\n================================================================================');
  console.log(`🎉 MIGRATION COMPLETE! Total records migrated to Supabase: ${totalMigrated}`);
  console.log('================================================================================');
}

main().then(() => setTimeout(() => process.exit(0), 100));
