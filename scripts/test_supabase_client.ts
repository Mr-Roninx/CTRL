import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

  console.log('Testing Supabase Client...');
  console.log('URL:', supabaseUrl);
  console.log('Key:', supabaseKey ? supabaseKey.slice(0, 15) + '...' : 'NONE');

  const client = createClient(supabaseUrl, supabaseKey);

  try {
    const { data, error } = await client.from('recovery_opportunities').select('*').limit(5);
    if (error) {
      console.log('PostgREST query response:', error);
    } else {
      console.log('✅ PostgREST query succeeded. Rows found:', data?.length);
    }
  } catch (e: any) {
    console.error('Error during query:', e.message);
  }

  process.exit(0);
}

main();
