process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseAdapter } from '../../src/db/adapter.js';
import { MigrationRunner } from '../../src/db/migrations/runner.js';
import { DoubleEntryLedger } from '../../src/truth/double_entry_ledger.js';

describe('V6 Phase 7: Double-Entry Financial Ledger & Hash-Chain Immutability', () => {
  before(async () => {
    const db = DatabaseAdapter.getInstance();
    await MigrationRunner.migrateUp(db);
    await DoubleEntryLedger.initTable(db);
  });

  it('appends records to cryptographic SHA-256 hash chain with balanced double entries', async () => {
    const oppId = `opp_ledger_v6_${Date.now()}`;
    const amountPaise = 250000;

    // 1. Record operational cost entry
    const entry1 = await DoubleEntryLedger.recordEntry({
      opportunity_id: oppId,
      event_type: 'intervened',
      debit_account: 'operational_costs',
      credit_account: 'cash_outflow',
      amount_paise: 1500, // ₹15.00
    });

    assert.ok(entry1.entry_hash, 'Must generate valid SHA-256 entry_hash');
    assert.equal(entry1.amount_paise, 1500);

    // 2. Record recovery revenue entry
    const entry2 = await DoubleEntryLedger.recordEntry({
      opportunity_id: oppId,
      event_type: 'recovered',
      debit_account: 'bank_settlement',
      credit_account: 'recovered_revenue',
      amount_paise: amountPaise,
    });

    assert.equal(entry2.prev_hash, entry1.entry_hash, 'entry2 prev_hash must link to entry1 entry_hash');

    // 3. Verify ledger integrity
    const audit = await DoubleEntryLedger.verifyLedgerIntegrity();
    assert.equal(audit.valid, true, 'Ledger hash chain must be 100% valid');
    assert.equal(audit.unbroken_chain, true, 'Hash chain must be unbroken');
    assert.equal(audit.debit_credit_balanced, true, 'Debits and credits must be balanced');
  });

  it('detects tampering and fails verification if any historical ledger entry is modified in place', async () => {
    const db = DatabaseAdapter.getInstance();

    // Fetch the latest entry
    const rows = await db.query<any>(
      'SELECT id, amount_paise FROM double_entry_ledger ORDER BY rowid DESC LIMIT 1;'
    );
    assert.ok(rows.length > 0);
    const targetEntry = rows[0];

    // Tamper with the amount directly in the database
    const tamperedAmount = Number(targetEntry.amount_paise) + 99999;
    await db.execute(
      'UPDATE double_entry_ledger SET amount_paise = ? WHERE id = ?;',
      [tamperedAmount, targetEntry.id]
    );

    // Run audit
    const tamperedAudit = await DoubleEntryLedger.verifyLedgerIntegrity();
    assert.equal(tamperedAudit.valid, false, 'Tampered ledger must fail integrity check');
    assert.match(tamperedAudit.error || '', /Hash signature corrupted/);

    // Restore original amount
    await db.execute(
      'UPDATE double_entry_ledger SET amount_paise = ? WHERE id = ?;',
      [targetEntry.amount_paise, targetEntry.id]
    );

    // Verify restored integrity
    const restoredAudit = await DoubleEntryLedger.verifyLedgerIntegrity();
    assert.equal(restoredAudit.valid, true, 'Restored ledger must pass verification');
  });
});
