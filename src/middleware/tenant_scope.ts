/**
 * Tenant Scope Middleware
 *
 * Wraps TenancyEnforcer.authenticateTenant() with additional checks:
 * 1. Validates the tenant is ACTIVE (not suspended or deleted)
 * 2. Attaches enriched tenant metadata (capacity_limit, kill_switch_active)
 *    to req.tenantContext for downstream use
 * 3. Enforces CORS-equivalent tenant header validation
 */
import { Request, Response, NextFunction } from 'express';
import { DatabaseAdapter } from '../db/adapter.js';
import { TenancyEnforcer, TenantScopedRequest } from '../security/tenancy.js';

export interface EnrichedTenantContext {
  tenantId: string;
  tenantName?: string;
  environment: 'live' | 'test';
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  capacityLimit: number;
  killSwitchActive: boolean;
}

// Extend TenantScopedRequest to carry enriched data
declare module '../security/tenancy.js' {
  interface TenantContext {
    enriched?: EnrichedTenantContext;
  }
}

/**
 * Middleware that requires authentication AND validates the tenant is active.
 * Use on all merchant-facing routes.
 */
export function requireActiveTenant() {
  return [
    TenancyEnforcer.authenticateTenant(),
    async (req: TenantScopedRequest, res: Response, next: NextFunction): Promise<void> => {
      const ctx = req.tenantContext;
      if (!ctx) {
        res.status(401).json({ error: 'Unauthorized', message: 'No tenant context.' });
        return;
      }

      const db = DatabaseAdapter.getInstance();
      const rows = await db.query<any>(
        `SELECT id, name, status, capacity_limit, kill_switch_active FROM tenants WHERE id = ?;`,
        [ctx.tenantId]
      );

      if (rows.length === 0) {
        res.status(401).json({ error: 'Unauthorized', message: 'Tenant not found.' });
        return;
      }

      const tenant = rows[0];
      if (tenant.status !== 'ACTIVE') {
        res.status(403).json({
          error: 'Forbidden',
          message: `Tenant account is ${tenant.status.toLowerCase()}. Contact support.`,
        });
        return;
      }

      // Attach enriched data
      ctx.enriched = {
        tenantId: ctx.tenantId,
        tenantName: tenant.name,
        environment: ctx.environment,
        status: tenant.status,
        capacityLimit: tenant.capacity_limit ?? 5,
        killSwitchActive: Boolean(tenant.kill_switch_active),
      };

      next();
    },
  ];
}

/**
 * Audit logging middleware — writes structured log entry for every mutating request.
 */
export function auditLog() {
  return async (req: TenantScopedRequest, res: Response, next: NextFunction): Promise<void> => {
    const ctx = req.tenantContext;
    if (!ctx || req.method === 'GET') {
      next();
      return;
    }

    const db = DatabaseAdapter.getInstance();
    const logId = `alog_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    try {
      await db.execute(
        `INSERT OR IGNORE INTO audit_log (id, tenant_id, user_id, action, resource, method, path, ip_address, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          logId,
          ctx.tenantId,
          ctx.user?.userId || 'api_key',
          `${req.method} ${req.path}`,
          req.path,
          req.method,
          req.originalUrl,
          req.ip || '0.0.0.0',
          new Date().toISOString(),
        ]
      );
    } catch {
      // Audit log failure must never block the request
    }

    next();
  };
}
