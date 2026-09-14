import { db } from '../src/db/database.js';

function verifyIsolation() {
  const realCount = (db.prepare("SELECT COUNT(*) as c FROM recovery_opportunities WHERE source = 'real'").get() as { c: number }).c;
  const synthCount = (db.prepare("SELECT COUNT(*) as c FROM recovery_opportunities WHERE source = 'synthetic'").get() as { c: number }).c;
  console.log('Database opportunities breakdown:', { realCount, synthCount });
  if (realCount === 0) {
    console.log('✅ PASS: Exactly 0 real rows in database after running test suite.');
  } else {
    console.error(`❌ FAIL: Found ${realCount} real rows in database.`);
    process.exit(1);
  }
}

verifyIsolation();
