import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const TABLES = [
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
  'notifications',
  'agent_runs',
  'agent_memories',
  'outreach_drafts',
];

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

  const client = createClient(supabaseUrl, supabaseKey);

  console.log('Inspecting Supabase Tables...');
  for (const t of TABLES) {
    const { data, error } = await client.from(t).select('*').limit(1);
    if (error) {
      console.log(`❌ Table '${t}': ${error.message} (Code: ${error.code})`);
    } else {
      console.log(`✅ Table '${t}' exists! (Rows found: ${data?.length})`);
    }
  }
}

main().then(() => {
  setTimeout(() => process.exit(0), 100);
});
