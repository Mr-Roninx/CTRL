import { DatabaseSync } from 'node:sqlite';
import { Customer } from '../../types/index.js';

export class CustomerRepository {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  public getById(id: string, tenantId?: string): Customer | undefined {
    if (tenantId) {
      const stmt = this.db.prepare('SELECT * FROM customers WHERE id = ? AND (tenant_id = ? OR merchant_id = ?)');
      return stmt.get(id, tenantId, tenantId) as unknown as Customer | undefined;
    }
    const stmt = this.db.prepare('SELECT * FROM customers WHERE id = ?');
    return stmt.get(id) as unknown as Customer | undefined;
  }

  public getOrCreate(
    id: string,
    defaultTrustScore: number = 0.65,
    tenantId: string = 'tenant_system_default'
  ): Customer {
    const existing = this.getById(id, tenantId);
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const insertStmt = this.db.prepare(`
      INSERT INTO customers (id, trust_score, created_at, updated_at, tenant_id, merchant_id)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
    `);
    insertStmt.run(id, defaultTrustScore, now, now, tenantId, tenantId);

    return {
      id,
      trust_score: defaultTrustScore,
      created_at: now,
      updated_at: now,
    };
  }

  public upsert(customer: Customer): void {
    const tenantId = (customer as any).tenant_id || 'tenant_system_default';
    const stmt = this.db.prepare(`
      INSERT INTO customers (id, trust_score, created_at, updated_at, tenant_id, merchant_id)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        trust_score = excluded.trust_score,
        updated_at = excluded.updated_at
    `);
    stmt.run(customer.id, customer.trust_score, customer.created_at, customer.updated_at, tenantId, tenantId);
  }

  public countPriorAttempts(customerId: string, rawPayloadSubstring?: string, tenantId?: string): number {
    if (tenantId) {
      if (rawPayloadSubstring) {
        const stmt = this.db.prepare(`
          SELECT COUNT(*) as count FROM recovery_opportunities 
          WHERE customer_id = ? AND (raw_payload_ref LIKE ? OR id LIKE ?) AND (tenant_id = ? OR merchant_id = ?)
        `);
        const res = stmt.get(customerId, `%${rawPayloadSubstring}%`, `%${rawPayloadSubstring}%`, tenantId, tenantId) as { count: number };
        return res?.count || 0;
      }

      const stmt = this.db.prepare(
        'SELECT COUNT(*) as count FROM recovery_opportunities WHERE customer_id = ? AND (tenant_id = ? OR merchant_id = ?)'
      );
      const res = stmt.get(customerId, tenantId, tenantId) as { count: number };
      return res?.count || 0;
    }

    if (rawPayloadSubstring) {
      const stmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM recovery_opportunities 
        WHERE customer_id = ? AND (raw_payload_ref LIKE ? OR id LIKE ?)
      `);
      const res = stmt.get(customerId, `%${rawPayloadSubstring}%`, `%${rawPayloadSubstring}%`) as { count: number };
      return res?.count || 0;
    }

    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM recovery_opportunities WHERE customer_id = ?');
    const res = stmt.get(customerId) as { count: number };
    return res?.count || 0;
  }
}
