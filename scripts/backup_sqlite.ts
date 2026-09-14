import fs from 'node:fs';
import path from 'node:path';

/**
 * CTRL V11 — SQLite Pre-Migration Snapshot Utility
 * 
 * Safely creates an immutable, timestamped backup of ctrl.db before
 * executing any database migration or schema alteration.
 */
export async function backupSqliteDatabase(): Promise<string> {
  const dbPath = path.resolve(process.cwd(), 'ctrl.db');
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Cannot backup: '${dbPath}' does not exist.`);
  }

  const backupDir = path.resolve(process.cwd(), 'archive', 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `ctrl.db.v11-pre-migration-${timestamp}.bak`;
  const backupPath = path.join(backupDir, backupFileName);

  fs.copyFileSync(dbPath, backupPath);
  const stats = fs.statSync(backupPath);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);

  console.log(`✅ SQLite Snapshot created successfully:`);
  console.log(`   - Destination: ${backupPath}`);
  console.log(`   - Size: ${sizeMb} MB`);

  return backupPath;
}

if (process.argv[1]?.includes('backup_sqlite')) {
  backupSqliteDatabase().catch((err) => {
    console.error('❌ Backup failed:', err);
    process.exit(1);
  });
}
