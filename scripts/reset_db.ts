import { db, initDatabase } from '../src/db/database.js';
import { DatabaseAdapter } from '../src/db/adapter.js';
import { MigrationRunner } from '../src/db/migrations/runner.js';

export async function resetDatabase(): Promise<void> {
  console.log('🔄 Resetting CTRL database to empty clean state...');

  // Disable foreign keys temporarily for clean cascade drops
  db.exec('PRAGMA foreign_keys = OFF;');
  const existingTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
  for (const table of existingTables) {
    db.exec(`DROP TABLE IF EXISTS "${table.name}";`);
  }
  db.exec('PRAGMA foreign_keys = ON;');

  // Recreate all tables
  initDatabase();

  const adapter = DatabaseAdapter.getInstance();
  await MigrationRunner.migrateUp(adapter);

  const tables = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
  `).all() as { name: string }[];

  console.log('✅ Clean database schema initialized with tables:', tables.map((t) => t.name).join(', '));
  
  const countOpps = (db.prepare('SELECT COUNT(*) as c FROM recovery_opportunities').get() as { c: number }).c;
  console.log(`📊 Total opportunities in reset DB: ${countOpps}`);
}

// Run directly
resetDatabase();
