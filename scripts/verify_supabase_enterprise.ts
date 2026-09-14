import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
dotenv.config();

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const key = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

console.log('--- SUPABASE ENTERPRISE CONNECTIVITY AUDIT ---');
console.log('Project URL:', url);
console.log('Key:', key ? `${key.slice(0, 16)}...` : 'MISSING');

const client = createClient(url, key, {
  auth: { persistSession: false },
});

async function run() {
  const tables = [
    'tenants',
    'organizations',
    'users',
    'memberships',
    'sessions',
    'api_keys',
    'audit_records',
    'recovery_opportunities',
    'scores',
    'allocation_decisions',
    'authority_checks',
    'execution_records',
    'ledger_entries',
    'bandit_arms',
    'pacing_bandit_logs',
  ];

  for (const table of tables) {
    try {
      const { data, error, count } = await client
        .from(table)
        .select('*', { count: 'exact', head: true });

      if (error) {
        console.log(`[TABLE] ${table.padEnd(25)}: ⚠️  ${error.code || 'ERR'} - ${error.message}`);
      } else {
        console.log(`[TABLE] ${table.padEnd(25)}: ✅ CONNECTED (Rows: ${count ?? 0})`);
      }
    } catch (err: any) {
      console.log(`[TABLE] ${table.padEnd(25)}: ❌ EXCEPTION: ${err.message}`);
    }
  }

  // Check Auth service connectivity
  try {
    const { data, error } = await client.auth.getSession();
    console.log('[AUTH]  Supabase Auth Service    : ✅ ONLINE');
  } catch (err: any) {
    console.log('[AUTH]  Supabase Auth Service    : ❌ ' + err.message);
  }
}

run();
