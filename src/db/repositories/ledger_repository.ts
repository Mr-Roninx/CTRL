import { DatabaseSync } from 'node:sqlite';
import { LedgerEntry } from '../../types/index.js';

export interface DoubleEntryRecord {
  id?: number;
  tenant_id: string;
  opportunity_id: string;
  entry_type: string;
  debit_account: string;
  credit_account: string;
  amount_paise: number;
  timestamp: string;
  prev_hash: string;
  entry_hash: string;
}

export class LedgerRepository {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  public insert(entry: LedgerEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO ledger_entries (
        id, opportunity_id, event_type, amount_paise, timestamp, raw_payload_ref
      ) VALUES (
        ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        opportunity_id = excluded.opportunity_id,
        event_type = excluded.event_type,
        amount_paise = excluded.amount_paise,
        timestamp = excluded.timestamp,
        raw_payload_ref = excluded.raw_payload_ref
    `);

    stmt.run(
      entry.id,
      entry.opportunity_id,
      entry.event_type,
      entry.amount_paise,
      entry.timestamp || new Date().toISOString(),
      entry.raw_payload_ref || null
    );
  }

  public getByOpportunity(oppId: string): LedgerEntry[] {
    const stmt = this.db.prepare('SELECT * FROM ledger_entries WHERE opportunity_id = ? ORDER BY timestamp ASC');
    return stmt.all(oppId) as unknown as LedgerEntry[];
  }

  public getAll(tenantId?: string): LedgerEntry[] {
    if (tenantId) {
      const stmt = this.db.prepare(`
        SELECT le.* FROM ledger_entries le
        JOIN recovery_opportunities ro ON le.opportunity_id = ro.id
        WHERE ro.tenant_id = ? OR ro.merchant_id = ?
        ORDER BY le.timestamp DESC
      `);
      return stmt.all(tenantId, tenantId) as unknown as LedgerEntry[];
    }
    const stmt = this.db.prepare('SELECT * FROM ledger_entries ORDER BY timestamp DESC');
    return stmt.all() as unknown as LedgerEntry[];
  }

  public insertDoubleEntry(entry: DoubleEntryRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO double_entry_ledger (
        tenant_id, opportunity_id, entry_type, debit_account, credit_account,
        amount_paise, timestamp, prev_hash, entry_hash
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `);

    stmt.run(
      entry.tenant_id,
      entry.opportunity_id,
      entry.entry_type,
      entry.debit_account,
      entry.credit_account,
      entry.amount_paise,
      entry.timestamp,
      entry.prev_hash,
      entry.entry_hash
    );
  }

  public getLatestDoubleEntry(tenantId: string): DoubleEntryRecord | undefined {
    // Pure ANSI SQL query with deterministic tie-breaking (no rowid)
    const stmt = this.db.prepare(`
      SELECT * FROM double_entry_ledger
      WHERE tenant_id = ?
      ORDER BY timestamp DESC, id DESC
      LIMIT 1
    `);
    return stmt.get(tenantId) as unknown as DoubleEntryRecord | undefined;
  }

  public getDoubleEntryRecords(tenantId: string, limit: number = 100): DoubleEntryRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM double_entry_ledger
      WHERE tenant_id = ?
      ORDER BY timestamp DESC, id DESC
      LIMIT ?
    `);
    return stmt.all(tenantId, limit) as unknown as DoubleEntryRecord[];
  }
}
