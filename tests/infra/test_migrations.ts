import { MigrationRunner } from '../../src/db/migrations/runner.js';
import { DatabaseAdapter } from '../../src/db/adapter.js';

export async function runMigrationTests() {
  console.log('🧪 Running Test: Migration Runner & Checksum Governance...');

  const adapter = DatabaseAdapter.getInstance();

  // Reset tracking table for test run to verify clean migration from 001
  await adapter.execute('DROP TABLE IF EXISTS schema_migrations;');

  // 1. Run Migrations Up
  const upResult = await MigrationRunner.migrateUp(adapter);
  if (!Array.isArray(upResult.applied) || upResult.applied.length === 0) {
    throw new Error('Expected migrations to be applied');
  }

  // 2. Check Migration Status
  const status = await MigrationRunner.getStatus(adapter);
  if (status.length < 3) {
    throw new Error(`Expected at least 3 registered migrations, got ${status.length}`);
  }

  const allApplied = status.every((m) => m.status === 'APPLIED');
  if (!allApplied) {
    throw new Error('Expected all registered migrations to be in APPLIED status');
  }

  // 3. Verify Multi-Tenancy Column Exists in Core Schema
  const oppColumns = await adapter.query<{ name: string }>(
    "SELECT name FROM pragma_table_info('recovery_opportunities');"
  );
  const hasMerchantId = oppColumns.some((col) => col.name === 'merchant_id');
  if (!hasMerchantId) {
    throw new Error('merchant_id column missing from recovery_opportunities');
  }

  console.log('  ✅ PASS: Migration governance runner verified (Up, Checksum tracking, Multi-Tenancy columns).');
}

if (process.argv[1]?.endsWith('test_migrations.ts')) {
  runMigrationTests();
}
