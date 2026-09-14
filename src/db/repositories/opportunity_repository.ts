import { DatabaseSync } from 'node:sqlite';
import { RecoveryOpportunity, OpportunityStatus } from '../../types/index.js';

/**
 * Dependency Inversion Principle (DIP) - Abstract port for opportunity persistence.
 * Decouples domain logic and services from concrete SQLite drivers.
 */
export interface IOpportunityRepository {
  getById(id: string, tenantId?: string): RecoveryOpportunity | undefined;
  getByRazorpayEventId(eventId: string): RecoveryOpportunity | undefined;
  getAll(tenantId?: string, environment?: 'test' | 'live'): RecoveryOpportunity[];
  getPending(tenantId?: string): RecoveryOpportunity[];
  getByStatus(status: OpportunityStatus, tenantId?: string): RecoveryOpportunity[];
  insert(opp: RecoveryOpportunity): void;
  upsert(opp: RecoveryOpportunity): void;
  updateStatus(id: string, status: OpportunityStatus): void;
}

export class OpportunityRepository implements IOpportunityRepository {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  public getById(id: string, tenantId?: string): RecoveryOpportunity | undefined {
    if (tenantId) {
      const stmt = this.db.prepare(
        'SELECT * FROM recovery_opportunities WHERE id = ? AND (tenant_id = ? OR merchant_id = ?)'
      );
      return stmt.get(id, tenantId, tenantId) as unknown as RecoveryOpportunity | undefined;
    }
    const stmt = this.db.prepare('SELECT * FROM recovery_opportunities WHERE id = ?');
    return stmt.get(id) as unknown as RecoveryOpportunity | undefined;
  }

  public getByRazorpayEventId(eventId: string): RecoveryOpportunity | undefined {
    const stmt = this.db.prepare('SELECT * FROM recovery_opportunities WHERE razorpay_event_id = ?');
    return stmt.get(eventId) as unknown as RecoveryOpportunity | undefined;
  }

  public getAll(tenantId?: string, environment?: 'test' | 'live'): RecoveryOpportunity[] {
    if (tenantId && environment) {
      if (environment === 'live') {
        const stmt = this.db.prepare(
          'SELECT * FROM recovery_opportunities WHERE (tenant_id = ? OR merchant_id = ?) AND environment = ? ORDER BY created_at DESC'
        );
        return stmt.all(tenantId, tenantId, environment) as unknown as RecoveryOpportunity[];
      } else {
        const stmt = this.db.prepare(
          'SELECT * FROM recovery_opportunities WHERE (tenant_id = ? OR merchant_id = ?) AND (environment = ? OR environment IS NULL) ORDER BY created_at DESC'
        );
        return stmt.all(tenantId, tenantId, environment) as unknown as RecoveryOpportunity[];
      }
    }
    if (tenantId) {
      const stmt = this.db.prepare(
        'SELECT * FROM recovery_opportunities WHERE tenant_id = ? OR merchant_id = ? ORDER BY created_at DESC'
      );
      return stmt.all(tenantId, tenantId) as unknown as RecoveryOpportunity[];
    }
    if (environment) {
      if (environment === 'live') {
        const stmt = this.db.prepare('SELECT * FROM recovery_opportunities WHERE environment = ? ORDER BY created_at DESC');
        return stmt.all(environment) as unknown as RecoveryOpportunity[];
      } else {
        const stmt = this.db.prepare(
          'SELECT * FROM recovery_opportunities WHERE environment = ? OR environment IS NULL ORDER BY created_at DESC'
        );
        return stmt.all(environment) as unknown as RecoveryOpportunity[];
      }
    }
    const stmt = this.db.prepare('SELECT * FROM recovery_opportunities ORDER BY created_at DESC');
    return stmt.all() as unknown as RecoveryOpportunity[];
  }

  public getPending(tenantId?: string): RecoveryOpportunity[] {
    return this.getByStatus('pending', tenantId);
  }

  public getByStatus(status: OpportunityStatus, tenantId?: string): RecoveryOpportunity[] {
    if (tenantId) {
      const stmt = this.db.prepare(
        'SELECT * FROM recovery_opportunities WHERE status = ? AND (tenant_id = ? OR merchant_id = ?) ORDER BY created_at ASC'
      );
      return stmt.all(status, tenantId, tenantId) as unknown as RecoveryOpportunity[];
    }
    const stmt = this.db.prepare('SELECT * FROM recovery_opportunities WHERE status = ? ORDER BY created_at ASC');
    return stmt.all(status) as unknown as RecoveryOpportunity[];
  }

  public insert(opp: RecoveryOpportunity): void {
    const tenantId = opp.tenant_id || 'tenant_system_default';
    let oppEnv = opp.environment;
    if (!oppEnv) {
      try {
        const tRow = this.db.prepare('SELECT environment FROM tenants WHERE id = ? LIMIT 1;').get(tenantId) as any;
        oppEnv = tRow?.environment || 'test';
      } catch {
        oppEnv = 'test';
      }
    }

    const stmt = this.db.prepare(`
      INSERT INTO recovery_opportunities (
        id, source, amount_paise, currency, reason_code, decline_type,
        attempt_count, customer_id, customer_trust_score, created_at, status,
        tenant_id, merchant_id, razorpay_event_id, raw_payload_ref, environment
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        source = excluded.source,
        amount_paise = excluded.amount_paise,
        currency = excluded.currency,
        reason_code = excluded.reason_code,
        decline_type = excluded.decline_type,
        attempt_count = excluded.attempt_count,
        customer_id = excluded.customer_id,
        customer_trust_score = excluded.customer_trust_score,
        status = excluded.status,
        tenant_id = excluded.tenant_id,
        merchant_id = excluded.merchant_id,
        razorpay_event_id = excluded.razorpay_event_id,
        raw_payload_ref = excluded.raw_payload_ref,
        environment = excluded.environment
    `);

    stmt.run(
      opp.id,
      opp.source,
      opp.amount_paise,
      opp.currency || 'INR',
      opp.reason_code,
      opp.decline_type,
      opp.attempt_count ?? 1,
      opp.customer_id,
      opp.customer_trust_score ?? 0.65,
      opp.created_at || new Date().toISOString(),
      opp.status || 'pending',
      tenantId,
      tenantId,
      opp.razorpay_event_id || null,
      opp.raw_payload_ref || null,
      oppEnv || 'test'
    );
  }

  public upsert(opp: RecoveryOpportunity): void {
    this.insert(opp);
  }

  public updateStatus(id: string, status: OpportunityStatus): void {
    const current = this.getById(id);
    if (!current) return;

    // Terminal state immutability guard: Once recovered, state is irreversible
    if (current.status === 'recovered' && status !== 'recovered') {
      return;
    }

    // Finite State Machine (FSM) integrity validation:
    // Reject illegal transitions and backward regressions
    const currentStatus = current.status;
    if (currentStatus === status) {
      return;
    }

    const invalidTransitions: Record<OpportunityStatus, OpportunityStatus[]> = {
      pending: ['executing', 'recovered', 'not_recovered'],
      scored: ['executing', 'pending', 'recovered', 'not_recovered'],
      allocated: ['pending', 'scored', 'recovered'],
      authorized: ['pending', 'scored', 'allocated'],
      deferred: ['executing', 'recovered'],
      blocked: ['pending', 'scored', 'allocated', 'authorized', 'executing', 'recovered'],
      abstained: ['pending', 'allocated', 'authorized', 'executing', 'recovered'],
      executing: ['pending', 'scored', 'allocated', 'authorized'],
      recovered: ['pending', 'scored', 'allocated', 'authorized', 'deferred', 'blocked', 'abstained', 'executing', 'not_recovered'],
      not_recovered: ['pending', 'scored', 'allocated', 'authorized', 'executing'],
    };

    if (invalidTransitions[currentStatus]?.includes(status)) {
      console.warn(`🛡️ FSM Guard: Blocked illegal state transition from '${currentStatus}' to '${status}' for opportunity ${id}`);
      return;
    }

    const stmt = this.db.prepare('UPDATE recovery_opportunities SET status = ? WHERE id = ?');
    stmt.run(status, id);
  }

  public ensureOpportunity(oppId: string): void {
    if (!oppId) return;
    const existing = this.getById(oppId);
    if (!existing) {
      this.insert({
        id: oppId,
        source: 'synthetic',
        amount_paise: 100000,
        currency: 'INR',
        reason_code: 'generic_decline',
        decline_type: 'soft',
        attempt_count: 1,
        customer_id: `cust_${oppId}`,
        customer_trust_score: 0.65,
        created_at: new Date().toISOString(),
        status: 'pending',
        tenant_id: 'tenant_system_default',
        environment: 'test',
      });
    }
  }
}
