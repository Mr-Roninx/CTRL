import dotenv from 'dotenv';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

async function main() {
  console.log('================================================================================');
  console.log('🔌 CTRL: SUPABASE DATABASE CONNECTIVITY & HEALTH CHECK');
  console.log('================================================================================\n');

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const dbUrl = process.env.SUPABASE_DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

  console.log('1. Supabase API Configuration:');
  console.log('   - Project URL:', supabaseUrl || 'NOT SET');
  console.log('   - Key Present:', Boolean(supabaseKey));

  console.log('\n2. Direct PostgreSQL / Pooler URL:');
  if (dbUrl && (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://'))) {
    const masked = dbUrl.replace(/:([^:@]+)@/, ':****@');
    console.log('   - Database URI:', masked);
  } else {
    console.log('   - Database URI: (Not configured — using SQLite fallback)');
  }

  // Test Supabase JS Client
  if (supabaseUrl && supabaseKey) {
    console.log('\n--- Testing Supabase API Gateway Connection ---');
    try {
      const client = createClient(supabaseUrl, supabaseKey);
      const { data, error } = await client.auth.getSession();
      if (error) {
        console.warn('⚠️ Supabase Auth ping notice:', error.message);
      } else {
        console.log('✅ Supabase Auth API endpoint reachable and responsive.');
      }
    } catch (err: any) {
      console.error('❌ Supabase Auth API ping failed:', err.message);
    }
  }

  // Test Direct PostgreSQL Pooler Connection if configured
  if (dbUrl && (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://'))) {
    console.log('\n--- Testing Direct Supabase PostgreSQL Pooler ---');
    const pool = new pg.Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
    });

    try {
      const start = Date.now();
      const res = await pool.query('SELECT NOW() as server_time, version();');
      const elapsed = Date.now() - start;
      console.log(`✅ Supabase PostgreSQL connected successfully in ${elapsed}ms!`);
      console.log('   - Server Time:', res.rows[0].server_time);
      console.log('   - Engine:', res.rows[0].version.split(',')[0]);
    } catch (err: any) {
      console.error('❌ Direct PostgreSQL connection failed:', err.message);
    } finally {
      await pool.end();
    }
  }

  console.log('\n================================================================================');
  console.log('🏁 Diagnostic check complete.');
  console.log('================================================================================\n');
}

main();
