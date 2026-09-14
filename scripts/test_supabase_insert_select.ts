import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

  const client = createClient(supabaseUrl, supabaseKey);

  const testTenant = {
    id: `tnt_sb_test_${Date.now()}`,
    name: 'Supabase Store Test',
    slug: `sb-store-${Date.now()}`,
    environment: 'test',
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
  };

  console.log('Testing INSERT into Supabase tenants table...');
  const { data: insData, error: insErr } = await client.from('tenants').insert(testTenant).select();

  if (insErr) {
    console.error('❌ Insert error:', insErr.message, insErr);
  } else {
    console.log('✅ Successfully inserted tenant into Supabase:', insData);
  }

  console.log('Testing SELECT from Supabase tenants table...');
  const { data: selData, error: selErr } = await client.from('tenants').select('*').eq('id', testTenant.id);

  if (selErr) {
    console.error('❌ Select error:', selErr.message);
  } else {
    console.log('✅ Successfully selected tenant from Supabase:', selData);
  }
}

main().then(() => setTimeout(() => process.exit(0), 100));
