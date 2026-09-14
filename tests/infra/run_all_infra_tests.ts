import { runDbAdapterTests } from './test_db_adapter.js';
import { runMigrationTests } from './test_migrations.js';
import { runRedisCachingTests } from './test_redis_caching.js';

async function runAllInfraTests() {
  console.log('======================================================================');
  console.log('🏗️ CTRL-AGENT HARDENED INFRASTRUCTURE TEST SUITE');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  const testList: [string, () => Promise<void>][] = [
    ['Database Adapter & Connection Pool', runDbAdapterTests],
    ['Migration Runner & Schema Checksums', runMigrationTests],
    ['Redis Caching, Idempotency & Pub/Sub', runRedisCachingTests],
  ];

  for (const [name, fn] of testList) {
    try {
      await fn();
      passed++;
    } catch (err: any) {
      console.error(`❌ FAILED: ${name}`);
      console.error(err);
      failed++;
    }
  }

  console.log('\n======================================================================');
  console.log(`🏁 INFRASTRUCTURE TEST SUITE: ${passed} PASSED | ${failed} FAILED`);
  console.log('======================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllInfraTests();
