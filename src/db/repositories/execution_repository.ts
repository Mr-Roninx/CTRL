import { DatabaseSync } from 'node:sqlite';
import { ExecutionRecord } from '../../types/index.js';

export class ExecutionRepository {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  public upsert(record: ExecutionRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO execution_records (
        opportunity_id, razorpay_payment_link_id, link_url, status, idempotency_key, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(opportunity_id) DO UPDATE SET
        razorpay_payment_link_id = excluded.razorpay_payment_link_id,
        link_url = excluded.link_url,
        status = excluded.status,
        idempotency_key = excluded.idempotency_key,
        created_at = excluded.created_at
    `);
    stmt.run(
      record.opportunity_id,
      record.razorpay_payment_link_id,
      record.link_url,
      record.status,
      record.idempotency_key,
      record.created_at || new Date().toISOString()
    );
  }

  public getByOpportunityId(oppId: string): ExecutionRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM execution_records WHERE opportunity_id = ?');
    return stmt.get(oppId) as unknown as ExecutionRecord | undefined;
  }

  public getAll(tenantId?: string): ExecutionRecord[] {
    if (tenantId) {
      const stmt = this.db.prepare(`
        SELECT er.* FROM execution_records er
        JOIN recovery_opportunities ro ON er.opportunity_id = ro.id
        WHERE ro.tenant_id = ? OR ro.merchant_id = ?
        ORDER BY er.created_at DESC
      `);
      return stmt.all(tenantId, tenantId) as unknown as ExecutionRecord[];
    }
    const stmt = this.db.prepare('SELECT * FROM execution_records ORDER BY created_at DESC');
    return stmt.all() as unknown as ExecutionRecord[];
  }
}
