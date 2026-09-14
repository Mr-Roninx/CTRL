import { Router, Request, Response } from 'express';
import { DatabaseAdapter } from '../db/adapter.js';

import { resolveTenantId } from '../security/tenant_guard.js';

export const auditRouter = Router();

// GET /audit/records
auditRouter.get('/records', async (req: Request, res: Response) => {
  try {
    const db = DatabaseAdapter.getInstance();
    const tenantId = resolveTenantId(req) || 'tenant_system_default';
    
    // Fetch audit_records
    const records = await db.query<any>(
      `SELECT * FROM audit_records WHERE tenant_id = ? ORDER BY timestamp DESC LIMIT 100;`,
      [tenantId]
    );

    // Fetch tenant-scoped ledger_entries with opportunity metadata
    let ledger = await db.query<any>(
      `SELECT l.*, o.amount_paise, o.currency, o.reason_code, o.decline_type, o.customer_id
       FROM ledger_entries l
       JOIN recovery_opportunities o ON o.id = l.opportunity_id
       WHERE o.tenant_id = ? OR o.merchant_id = ?
       ORDER BY l.timestamp DESC LIMIT 100;`,
      [tenantId, tenantId]
    ).catch(() => []);

    // Only allow global ledger view for system admin / default tenant
    if (ledger.length === 0 && tenantId === 'tenant_system_default') {
      ledger = await db.query<any>(
        `SELECT * FROM ledger_entries ORDER BY timestamp DESC LIMIT 50;`
      ).catch(() => []);
    }

    res.json({
      count: records.length,
      records,
      ledger_count: ledger.length,
      ledger,
    });
  } catch (error: any) {
    console.error('Failed to fetch audit records:', error);
    res.status(500).json({ error: 'Failed to fetch audit records', details: error.message });
  }
});
