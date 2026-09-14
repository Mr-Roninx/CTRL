import { DoubleEntryLedger } from '../../src/truth/double_entry_ledger.js';
import { ReconciliationSlaTracker } from '../../src/truth/reconciliation_sla.js';
import { DatabaseAdapter } from '../../src/db/adapter.js';

export async function runDoubleEntryLedgerTests() {
  console.log('🧪 Running Test: Double-Entry Cryptographic Hash-Chained Ledger & SLAs...');

  const adapter = DatabaseAdapter.getInstance();

  // 1. Record Double-Entry Transactions
  const oppId = `opp_ledger_${Date.now()}`;
  await adapter.execute(`
    INSERT INTO customers (id, trust_score, created_at, updated_at) VALUES ('cust_test_del', 0.5, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO NOTHING;
  `);
  await adapter.execute(`
    INSERT INTO recovery_opportunities (id, source, amount_paise, currency, reason_code, decline_type, attempt_count, customer_id, customer_trust_score, created_at, status)
    VALUES (?, 'synthetic', 150000, 'INR', 'insufficient_funds', 'soft', 1, 'cust_test_del', 0.5, datetime('now'), 'executing');
  `, [oppId]);

  const entry1 = await DoubleEntryLedger.recordEntry({
    opportunity_id: oppId,
    event_type: 'PAYMENT_LINK_CREATED',
    debit_account: 'receivables',
    credit_account: 'unearned_recovery',
    amount_paise: 150000,
  });

  const entry2 = await DoubleEntryLedger.recordEntry({
    opportunity_id: oppId,
    event_type: 'PAYMENT_RECOVERED',
    debit_account: 'bank_settlement',
    credit_account: 'recovered_revenue',
    amount_paise: 150000,
  });

  // Verify prev_hash chaining
  if (entry2.prev_hash !== entry1.entry_hash) {
    throw new Error(`Hash chain linkage failed: entry2.prev_hash (${entry2.prev_hash}) !== entry1.entry_hash (${entry1.entry_hash})`);
  }

  // 2. Full Ledger Integrity Verification
  const integrity = await DoubleEntryLedger.verifyLedgerIntegrity();
  if (!integrity.valid || !integrity.unbroken_chain || !integrity.debit_credit_balanced) {
    throw new Error(`Ledger integrity check failed: ${integrity.error}`);
  }

  // 3. Reconciliation SLA Tracking
  const slaFast = ReconciliationSlaTracker.trackLatency(oppId, 'webhook', 350); // 350ms < 5000ms
  if (!slaFast.passed_sla) {
    throw new Error('SLA tracking marked fast webhook as breached');
  }

  const slaSlow = ReconciliationSlaTracker.trackLatency(oppId, 'webhook', 8500); // 8500ms > 5000ms
  if (slaSlow.passed_sla) {
    throw new Error('SLA tracking marked slow webhook as passed');
  }

  // 4. Divergence Detection
  const divergence = await ReconciliationSlaTracker.detectDivergence(oppId, 'paid', 'expired');
  if (!divergence || !divergence.divergence_type.includes('MISMATCH')) {
    throw new Error('Divergence detector failed to flag webhook vs poller mismatch');
  }

  console.log('  ✅ PASS: Double-entry accounting, cryptographic SHA-256 hash chains, SLAs and divergence detector verified.');
}

if (process.argv[1]?.endsWith('test_double_entry_ledger.ts')) {
  runDoubleEntryLedgerTests();
}
