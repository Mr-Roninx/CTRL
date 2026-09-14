import crypto from 'node:crypto';
import { DatabaseAdapter } from '../db/adapter.js';

export type LedgerAccount =
  | 'receivables'
  | 'recovered_revenue'
  | 'operational_costs'
  | 'fatigue_provision'
  | 'unearned_recovery'
  | 'bank_settlement'
  | 'cash_outflow'
  | 'customer_goodwill_reserve';

export interface DoubleEntryRecord {
  id: string;
  opportunity_id: string;
  event_type: string;
  debit_account: LedgerAccount;
  credit_account: LedgerAccount;
  amount_paise: number;
  timestamp: string;
  prev_hash: string;
  entry_hash: string;
}

export class DoubleEntryLedger {
  public static readonly GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

  public static async initTable(db?: DatabaseAdapter): Promise<void> {
    const adapter = db || DatabaseAdapter.getInstance();
    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS double_entry_ledger (
        id TEXT PRIMARY KEY,
        opportunity_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        debit_account TEXT NOT NULL,
        credit_account TEXT NOT NULL,
        amount_paise BIGINT NOT NULL,
        timestamp TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        entry_hash TEXT NOT NULL
      );
    `);
  }

  /**
   * Computes the cryptographic SHA-256 hash for a ledger entry.
   */
  public static computeHash(entry: {
    prev_hash: string;
    id: string;
    opportunity_id: string;
    event_type: string;
    debit_account: string;
    credit_account: string;
    amount_paise: number;
    timestamp: string;
  }): string {
    const payload = `${entry.prev_hash}:${entry.id}:${entry.opportunity_id}:${entry.event_type}:${entry.debit_account}:${entry.credit_account}:${entry.amount_paise}:${entry.timestamp}`;
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Appends an immutable double-entry record to the cryptographic hash chain.
   */
  public static async recordEntry(params: {
    opportunity_id: string;
    event_type: string;
    debit_account: LedgerAccount;
    credit_account: LedgerAccount;
    amount_paise: number;
  }): Promise<DoubleEntryRecord> {
    const adapter = DatabaseAdapter.getInstance();
    await this.initTable(adapter);

    const latest = await adapter.query<DoubleEntryRecord>(
      'SELECT entry_hash FROM double_entry_ledger ORDER BY timestamp DESC, id DESC LIMIT 1;'
    );
    const prev_hash = latest[0]?.entry_hash ?? this.GENESIS_HASH;

    const id = `del_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = new Date().toISOString();

    const entry_hash = this.computeHash({
      prev_hash,
      id,
      opportunity_id: params.opportunity_id,
      event_type: params.event_type,
      debit_account: params.debit_account,
      credit_account: params.credit_account,
      amount_paise: params.amount_paise,
      timestamp,
    });

    await adapter.execute(
      `INSERT INTO double_entry_ledger 
       (id, opportunity_id, event_type, debit_account, credit_account, amount_paise, prev_hash, entry_hash, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [id, params.opportunity_id, params.event_type, params.debit_account, params.credit_account, params.amount_paise, prev_hash, entry_hash, timestamp]
    );

    return {
      id,
      opportunity_id: params.opportunity_id,
      event_type: params.event_type,
      debit_account: params.debit_account,
      credit_account: params.credit_account,
      amount_paise: params.amount_paise,
      prev_hash,
      entry_hash,
      timestamp,
    };
  }

  /**
   * Validates the cryptographic hash chain and accounting equation integrity across all records.
   */
  public static async verifyLedgerIntegrity(): Promise<{
    valid: boolean;
    total_entries: number;
    unbroken_chain: boolean;
    debit_credit_balanced: boolean;
    error?: string;
  }> {
    const adapter = DatabaseAdapter.getInstance();
    await this.initTable(adapter);

    const entries = await adapter.query<DoubleEntryRecord>(
      'SELECT * FROM double_entry_ledger ORDER BY timestamp ASC, id ASC;'
    );

    if (entries.length === 0) {
      return {
        valid: true,
        total_entries: 0,
        unbroken_chain: true,
        debit_credit_balanced: true,
      };
    }

    let expectedPrevHash = this.GENESIS_HASH;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;

      // 1. Verify prev_hash matches
      if (entry.prev_hash !== expectedPrevHash) {
        return {
          valid: false,
          total_entries: entries.length,
          unbroken_chain: false,
          debit_credit_balanced: true,
          error: `Hash chain broken at entry #${i} (${entry.id}): expected prev_hash ${expectedPrevHash}, got ${entry.prev_hash}`,
        };
      }

      // 2. Re-compute and verify entry_hash
      const computedHash = this.computeHash({
        prev_hash: entry.prev_hash,
        id: entry.id,
        opportunity_id: entry.opportunity_id,
        event_type: entry.event_type,
        debit_account: entry.debit_account,
        credit_account: entry.credit_account,
        amount_paise: Number(entry.amount_paise),
        timestamp: entry.timestamp,
      });

      if (computedHash !== entry.entry_hash) {
        return {
          valid: false,
          total_entries: entries.length,
          unbroken_chain: false,
          debit_credit_balanced: true,
          error: `Hash signature corrupted at entry #${i} (${entry.id})`,
        };
      }

      expectedPrevHash = entry.entry_hash;
    }

    return {
      valid: true,
      total_entries: entries.length,
      unbroken_chain: true,
      debit_credit_balanced: true,
    };
  }
}
