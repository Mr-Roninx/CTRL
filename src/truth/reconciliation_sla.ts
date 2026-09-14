import { DatabaseAdapter } from '../db/adapter.js';

export interface SlaMetric {
  path: 'webhook' | 'poller';
  latency_ms: number;
  sla_target_ms: number;
  passed_sla: boolean;
  opportunity_id: string;
  timestamp: string;
}

export interface DivergenceAlert {
  id?: number;
  opportunity_id: string;
  webhook_status: string;
  poller_status: string;
  divergence_type: string;
  detected_at: string;
}

export class ReconciliationSlaTracker {
  // Webhook SLA: < 5,000ms (5s)
  // Poller SLA: < 300,000ms (5 min)
  // Unreconciled Alert: > 1,800,000ms (30 min)
  private static readonly WEBHOOK_SLA_MS = 5000;
  private static readonly POLLER_SLA_MS = 300000;
  private static readonly UNRECONCILED_ALERT_MS = 1800000;

  public static async initTable(db?: DatabaseAdapter): Promise<void> {
    const adapter = db || DatabaseAdapter.getInstance();
    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS reconciliation_divergences (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT 'tenant_system_default',
        opportunity_id TEXT NOT NULL,
        webhook_status TEXT,
        poller_status TEXT,
        divergence_type TEXT,
        type TEXT DEFAULT 'STATUS_DIVERGENCE',
        severity TEXT DEFAULT 'MEDIUM',
        description TEXT,
        status TEXT NOT NULL DEFAULT 'OPEN',
        detected_at TEXT,
        resolved_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    try {
      await adapter.execute(`ALTER TABLE reconciliation_divergences ADD COLUMN webhook_status TEXT;`);
    } catch (e) {}
    try {
      await adapter.execute(`ALTER TABLE reconciliation_divergences ADD COLUMN poller_status TEXT;`);
    } catch (e) {}
    try {
      await adapter.execute(`ALTER TABLE reconciliation_divergences ADD COLUMN divergence_type TEXT;`);
    } catch (e) {}
    try {
      await adapter.execute(`ALTER TABLE reconciliation_divergences ADD COLUMN detected_at TEXT;`);
    } catch (e) {}
  }

  /**
   * Tracks reconciliation SLA latency and verifies compliance.
   */
  public static trackLatency(
    opportunityId: string,
    path: 'webhook' | 'poller',
    latencyMs: number
  ): SlaMetric {
    const targetMs = path === 'webhook' ? this.WEBHOOK_SLA_MS : this.POLLER_SLA_MS;
    const passedSla = latencyMs <= targetMs;

    if (!passedSla) {
      console.warn(
        `⏱️ Reconciliation SLA Breached on ${path} path for ${opportunityId}: took ${latencyMs}ms (target <= ${targetMs}ms)`
      );
    }

    return {
      path,
      latency_ms: latencyMs,
      sla_target_ms: targetMs,
      passed_sla: passedSla,
      opportunity_id: opportunityId,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Checks for executing links that have remained unreconciled for > 30 minutes.
   */
  public static async checkUnreconciledAlerts(): Promise<{ opportunity_id: string; age_minutes: number }[]> {
    const adapter = DatabaseAdapter.getInstance();
    const cutoff = new Date(Date.now() - this.UNRECONCILED_ALERT_MS).toISOString();

    const staleRecords = await adapter.query<{ opportunity_id: string; created_at: string }>(
      `SELECT e.opportunity_id, e.created_at
       FROM execution_records e
       JOIN recovery_opportunities o ON e.opportunity_id = o.id
       WHERE o.status = 'executing' AND e.created_at <= ?;`,
      [cutoff]
    );

    return staleRecords.map((r) => ({
      opportunity_id: r.opportunity_id,
      age_minutes: Math.floor((Date.now() - new Date(r.created_at).getTime()) / 60000),
    }));
  }

  /**
   * Detects and logs divergences between webhook and poller states.
   */
  public static async detectDivergence(
    opportunityId: string,
    webhookStatus: string,
    pollerStatus: string
  ): Promise<DivergenceAlert | null> {
    if (webhookStatus === pollerStatus) {
      return null;
    }

    const adapter = DatabaseAdapter.getInstance();
    await this.initTable(adapter);

    const now = new Date().toISOString();
    const id = `div_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const alert: DivergenceAlert = {
      opportunity_id: opportunityId,
      webhook_status: webhookStatus,
      poller_status: pollerStatus,
      divergence_type: `MISMATCH (${webhookStatus} vs ${pollerStatus})`,
      detected_at: now,
    };

    console.error(`🚨 Divergence Detected for opportunity ${opportunityId}: Webhook=${webhookStatus}, Poller=${pollerStatus}`);

    await adapter.execute(
      `INSERT INTO reconciliation_divergences (
        id, tenant_id, opportunity_id, webhook_status, poller_status, divergence_type,
        type, severity, description, status, detected_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        id,
        'tenant_system_default',
        alert.opportunity_id,
        alert.webhook_status,
        alert.poller_status,
        alert.divergence_type,
        'STATUS_DIVERGENCE',
        'HIGH',
        `Reconciliation divergence: webhook status '${webhookStatus}' differs from poller status '${pollerStatus}'`,
        'OPEN',
        alert.detected_at,
        now,
      ]
    );

    return alert;
  }
}
