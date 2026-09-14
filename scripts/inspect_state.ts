import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('ctrl.db');

console.log('=== SQLITE MASTER TABLES & SCHEMA ===');
const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name").all() as any[];
for (const t of tables) {
  console.log(`\nTABLE: ${t.name}`);
  console.log(t.sql);
  const info = db.prepare(`PRAGMA table_info(${t.name})`).all();
  console.log('COLUMNS:', info);
}

console.log('\n=== ROW COUNTS ===');
for (const t of tables) {
  if (t.name.startsWith('sqlite_')) continue;
  const count = (db.prepare(`SELECT count(*) as c FROM ${t.name}`).get() as any).c;
  console.log(`${t.name}: ${count} rows`);
}

console.log('\n=== RECOVERY OPPORTUNITIES SAMPLE ===');
const opps = db.prepare("SELECT id, source, amount_paise, decline_type, reason_code, status, razorpay_event_id, raw_payload_ref FROM recovery_opportunities").all();
console.table(opps);

console.log('\n=== LEDGER ENTRIES ===');
const ledger = db.prepare("SELECT * FROM ledger_entries").all();
console.table(ledger);

console.log('\n=== EXECUTION RECORDS ===');
const execs = db.prepare("SELECT * FROM execution_records").all();
console.table(execs);

console.log('\n=== AUTHORITY CHECKS SUMMARY ===');
const checks = db.prepare("SELECT check_name, passed, count(*) as c FROM authority_checks GROUP BY check_name, passed").all();
console.table(checks);
