import { Request, Response, NextFunction } from 'express';
import { DatabaseAdapter } from '../db/adapter.js';

export const auditLogger = (action: string, resourceType: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // We bind a function to run on response finish to log the outcome
    res.on('finish', async () => {
      // Only log successful mutating actions (e.g., POST, PUT, DELETE) or explicit audit actions
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          const tenantId = req.headers['x-tenant-id'] as string || req.params.tenant_id || (req as any).user?.tenant_id || 'tenant_system_default';
          const actorId = (req as any).user?.id || 'anonymous';
          const actorType = (req as any).user?.role ? 'USER' : 'SYSTEM';
          const resourceId = req.params.id || req.body.id || 'N/A';
          const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
          
          const db = DatabaseAdapter.getInstance();
          await db.execute(
            `INSERT INTO audit_records (
              id, tenant_id, actor_id, actor_type, action, 
              resource_type, resource_id, payload, ip_address, timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              `adt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
              tenantId,
              actorId,
              actorType,
              action,
              resourceType,
              resourceId,
              req.method === 'GET' ? null : JSON.stringify(req.body),
              ipAddress,
              new Date().toISOString()
            ]
          );
        } catch (error) {
          console.error('Failed to write audit log:', error);
        }
      }
    });

    next();
  };
};
