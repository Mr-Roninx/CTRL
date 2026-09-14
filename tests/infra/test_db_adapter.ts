import { DatabaseAdapter } from '../../src/db/adapter.js';

export async function runDbAdapterTests() {
  console.log('🧪 Running Test: Database Adapter & Connection Pool...');

  const adapter = DatabaseAdapter.getInstance();
  const metrics = adapter.getPoolMetrics();

  if (!['PostgreSQL', 'SQLite'].includes(metrics.engine)) {
    throw new Error(`Invalid engine returned: ${metrics.engine}`);
  }

  // 1. Parameterized Query Test
  const testRows = await adapter.query<{ val: number }>('SELECT 1 + 1 as val;');
  if (!testRows || Number(testRows[0]?.val) !== 2) {
    throw new Error('Parameterized query failed');
  }

  // 2. Transaction Rollback Verification
  await adapter.execute('CREATE TABLE IF NOT EXISTS test_tx_data (id TEXT PRIMARY KEY);');
  await adapter.execute('DELETE FROM test_tx_data;');

  let rollbackCaught = false;
  try {
    await adapter.withTransaction(async (tx) => {
      await tx.execute('INSERT INTO test_tx_data (id) VALUES (?);', ['id_rollback_test']);
      // Force error to trigger rollback
      throw new Error('Intentional transaction test error');
    });
  } catch (err: any) {
    if (err.message === 'Intentional transaction test error') {
      rollbackCaught = true;
    }
  }

  if (!rollbackCaught) {
    throw new Error('Transaction failed to catch intentional error');
  }

  // Verify id_rollback_test was not committed
  const checkRows = await adapter.query('SELECT * FROM test_tx_data WHERE id = ?;', ['id_rollback_test']);
  if (checkRows.length > 0) {
    throw new Error('Transaction rollback failed: record was committed despite error');
  }

  // Clean up test table
  await adapter.execute('DROP TABLE IF EXISTS test_tx_data;');

  console.log(`  ✅ PASS: DatabaseAdapter (${metrics.engine}) verified with connection pool metrics & atomic transaction rollback.`);
}

if (process.argv[1]?.endsWith('test_db_adapter.ts')) {
  runDbAdapterTests();
}
