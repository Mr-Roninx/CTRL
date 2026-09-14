import { Migration } from './types.js';
import crypto from 'node:crypto';

export const migration001CoreSchema: Migration = {
  id: '001',
  name: 'core_financial_schema',
  checksum: crypto.createHash('sha256').update('001_core_financial_schema_v3_fixed').digest('hex'),
  up: async (db) => {
    // 1. Customers
    await db.execute(`
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL DEFAULT 'merchant_default',
        trust_score REAL NOT NULL DEFAULT 0.5,
        created_at TEXT NOT NULL
      );
    `);

    // Ensure merchant_id exists on customers
    try {
      await db.execute(`ALTER TABLE customers ADD COLUMN merchant_id TEXT NOT NULL DEFAULT 'merchant_default';`);
    } catch (e) {
      // column already exists
    }

    // 2. Recovery Opportunities
    await db.execute(`
      CREATE TABLE IF NOT EXISTS recovery_opportunities (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL DEFAULT 'merchant_default',
        source TEXT NOT NULL CHECK(source IN ('real', 'synthetic')),
        amount_paise BIGINT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'INR',
        reason_code TEXT NOT NULL,
        decline_type TEXT NOT NULL CHECK(decline_type IN ('hard', 'soft', 'unknown')),
        attempt_count INTEGER NOT NULL DEFAULT 1,
        customer_id TEXT NOT NULL,
        customer_trust_score REAL NOT NULL DEFAULT 0.5,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'scored', 'allocated', 'deferred', 'blocked', 'abstained', 'executing', 'recovered', 'not_recovered')),
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
      );
    `);

    // Ensure merchant_id exists on recovery_opportunities
    try {
      await db.execute(`ALTER TABLE recovery_opportunities ADD COLUMN merchant_id TEXT NOT NULL DEFAULT 'merchant_default';`);
    } catch (e) {
      // column already exists
    }

    // 3. Scores
    await db.execute(`
      CREATE TABLE IF NOT EXISTS scores (
        opportunity_id TEXT PRIMARY KEY,
        natural_recovery_prob REAL NOT NULL,
        intervention_recovery_prob REAL NOT NULL,
        incremental_prob REAL NOT NULL,
        operational_cost_paise BIGINT NOT NULL,
        fatigue_cost_paise BIGINT NOT NULL,
        expected_incremental_value_paise BIGINT NOT NULL,
        confidence TEXT NOT NULL CHECK(confidence IN ('low', 'medium', 'high')),
        FOREIGN KEY (opportunity_id) REFERENCES recovery_opportunities(id) ON DELETE CASCADE
      );
    `);

    // 4. Allocation Decisions
    await db.execute(`
      CREATE TABLE IF NOT EXISTS allocation_decisions (
        opportunity_id TEXT PRIMARY KEY,
        decision TEXT NOT NULL CHECK(decision IN ('ACT', 'WAIT', 'ABSTAIN')),
        rank_in_batch INTEGER NOT NULL,
        shadow_price_paise_at_decision BIGINT NOT NULL,
        reason TEXT NOT NULL,
        FOREIGN KEY (opportunity_id) REFERENCES recovery_opportunities(id) ON DELETE CASCADE
      );
    `);

    // 5. Authority Checks
    await db.execute(`
      CREATE TABLE IF NOT EXISTS authority_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        opportunity_id TEXT NOT NULL,
        check_name TEXT NOT NULL,
        passed INTEGER NOT NULL,
        reason TEXT NOT NULL,
        FOREIGN KEY (opportunity_id) REFERENCES recovery_opportunities(id) ON DELETE CASCADE
      );
    `);

    // 6. Execution Records
    await db.execute(`
      CREATE TABLE IF NOT EXISTS execution_records (
        opportunity_id TEXT PRIMARY KEY,
        razorpay_payment_link_id TEXT NOT NULL UNIQUE,
        link_url TEXT NOT NULL,
        status TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        FOREIGN KEY (opportunity_id) REFERENCES recovery_opportunities(id) ON DELETE CASCADE
      );
    `);

    // 7. Ledger Entries (With Partition Key Timestamp Support)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS ledger_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        opportunity_id TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK(event_type IN ('webhook_received', 'reconciled', 'recovered', 'not_recovered')),
        amount_paise BIGINT NOT NULL,
        timestamp TEXT NOT NULL,
        raw_payload_ref TEXT,
        FOREIGN KEY (opportunity_id) REFERENCES recovery_opportunities(id) ON DELETE CASCADE
      );
    `);
  },
  down: async (db) => {
    await db.execute('DROP TABLE IF EXISTS ledger_entries;');
    await db.execute('DROP TABLE IF EXISTS execution_records;');
    await db.execute('DROP TABLE IF EXISTS authority_checks;');
    await db.execute('DROP TABLE IF EXISTS allocation_decisions;');
    await db.execute('DROP TABLE IF EXISTS scores;');
    await db.execute('DROP TABLE IF EXISTS recovery_opportunities;');
    await db.execute('DROP TABLE IF EXISTS customers;');
  },
};
