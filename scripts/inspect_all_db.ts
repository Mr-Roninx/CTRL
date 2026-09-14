import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('ctrl.db');

console.log('=== ALL RECOVERY OPPORTUNITIES ===');
const opps = db.prepare("SELECT * FROM recovery_opportunities").all();
console.log(JSON.stringify(opps, null, 2));

console.log('\n=== ALL LEDGER ENTRIES ===');
const ledger = db.prepare("SELECT * FROM ledger_entries").all();
console.log(JSON.stringify(ledger, null, 2));

console.log('\n=== ALL ALLOCATION DECISIONS ===');
const allocs = db.prepare("SELECT * FROM allocation_decisions").all();
console.log(JSON.stringify(allocs, null, 2));
