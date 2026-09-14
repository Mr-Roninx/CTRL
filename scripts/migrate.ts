/**
 * CTRL Database Migration Runner — CLI Entry Point
 *
 * Delegates to MigrationRunner which handles registration, checksum
 * verification, and ordered application of all pending migrations.
 *
 * Usage:
 *   npm run db:migrate          — apply all pending migrations
 *   npm run db:migrate:status   — show migration status table
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { DatabaseAdapter } from '../src/db/adapter.js';
import { MigrationRunner } from '../src/db/migrations/runner.js';
import { initDatabase } from '../src/db/database.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const command = process.argv[2] || 'up';

async function main() {
  console.log('🔄 CTRL Migration Runner\n');

  // Bootstrap the base schema tables first (CREATE TABLE IF NOT EXISTS)
  initDatabase();

  const db = DatabaseAdapter.getInstance();

  if (command === 'status') {
    const status = await MigrationRunner.getStatus(db);
    console.log('📊 Migration Status:\n');
    console.log(
      `${'ID'.padEnd(6)}  ${'Name'.padEnd(35)}  ${'Status'.padEnd(10)}  Applied At`
    );
    console.log('─'.repeat(80));
    for (const m of status) {
      const icon = m.status === 'APPLIED' ? '✅' : '⏳';
      console.log(
        `${icon} ${m.id.padEnd(5)}  ${m.name.padEnd(35)}  ${m.status.padEnd(10)}  ${m.applied_at || '—'}`
      );
    }
    console.log('');
    return;
  }

  // Default: run pending migrations up
  const result = await MigrationRunner.migrateUp(db);

  if (result.applied.length === 0) {
    console.log('✅ All migrations already applied. Database is up to date.\n');
  } else {
    console.log(`\n🎉 Applied ${result.applied.length} migration(s):`);
    for (const m of result.applied) console.log(`   ✅ ${m}`);
    console.log('');
  }

  if (result.skipped.length > 0) {
    console.log(`   ↩ Skipped ${result.skipped.length} already-applied migration(s).`);
  }
}

main().catch((err) => {
  console.error('❌ Migration runner failed:', err.message);
  process.exit(1);
});
