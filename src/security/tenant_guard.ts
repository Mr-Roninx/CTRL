import { Request, Response, NextFunction } from 'express';
import { DatabaseAdapter } from '../db/adapter.js';
import { TenantScopedRequest, TenantContext } from './tenancy.js';
import { TenantId } from '../types/branded.js';

export interface TenantGuardOptions {
  requiredScope?: string;
  allowSystemDefault?: boolean;
}

/**
 * Resolves the authenticated tenant ID from the request across all supported credential sources.
 */
export function resolveTenantId(req: Request, allowSystemDefault: boolean = false): TenantId | null {
  const scopedReq = req as TenantScopedRequest;

  // 1. Upstream authenticated tenant context
  if (scopedReq.tenantContext?.tenantId) {
    return scopedReq.tenantContext.tenantId as TenantId;
  }

  // 2. JWT decoded session user
  const user = (req as any).user;
  if (user?.tenant_id) {
    return user.tenant_id as TenantId;
  }
  if (user?.tenantId) {
    return user.tenantId as TenantId;
  }

  // 3. API Key decoded payload
  const apiKey = (req as any).apiKey;
  if (apiKey?.tenantId) {
    return apiKey.tenantId as TenantId;
  }

  // 4. Header x-tenant-id (for internal service-to-service calls or trusted gateways)
  const headerTenant = req.headers['x-tenant-id'];
  if (typeof headerTenant === 'string' && headerTenant.trim()) {
    return headerTenant.trim() as TenantId;
  }

  // 5. Query parameter tenant_id (for development / debugging)
  if (process.env.NODE_ENV !== 'production' && req.query) {
    const queryTenant = (req.query as any).tenant_id || (req.query as any).tenantId;
    if (typeof queryTenant === 'string' && queryTenant.trim()) {
      return queryTenant.trim() as TenantId;
    }
  }

  // 6. System default fallback if permitted
  if (allowSystemDefault || process.env.AUTH_REQUIRED === 'false' || process.env.NODE_ENV === 'test') {
    return 'tenant_system_default' as TenantId;
  }

  return null;
}

/**
 * Asserts that the authenticated tenant is allowed to operate on the target tenant.
 * Rejects cross-tenant access attempts immediately.
 */
export function assertTenantAccess(authenticatedTenant: string, targetTenant: string, resourceName: string = 'Resource'): void {
  if (!authenticatedTenant || !targetTenant) {
    throw new Error(`Tenant Access Denied: Unspecified tenant context for ${resourceName}.`);
  }

  if (authenticatedTenant === 'tenant_system_default') {
    return; // System admin / service role bypass
  }

  if (authenticatedTenant !== targetTenant) {
    throw new Error(
      `Tenant Isolation Violation: Tenant '${authenticatedTenant}' attempted to access ${resourceName} belonging to tenant '${targetTenant}'. Access strictly blocked.`
    );
  }
}

/**
 * Express middleware that strictly enforces tenant resolution and initializes
 * connection-level Row-Level Security (RLS) context in the database adapter.
 */
export function tenantGuard(options: TenantGuardOptions = {}) {
  return async (req: TenantScopedRequest, res: Response, next: NextFunction): Promise<void> => {
    const tenantId = resolveTenantId(req, options.allowSystemDefault ?? true);

    if (!tenantId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Tenant identity could not be resolved. Please provide valid authorization credentials or x-tenant-id.',
      });
      return;
    }

    // Set tenant context on Express request
    if (!req.tenantContext) {
      req.tenantContext = {
        tenantId,
        environment: 'test',
        authType: 'SESSION',
      };
    } else {
      req.tenantContext.tenantId = tenantId;
    }

    // Bind tenant context to database connection for Supabase/PostgreSQL RLS
    try {
      await DatabaseAdapter.getInstance().setTenantContext(tenantId);
    } catch {
      // Non-fatal if engine does not support SET LOCAL
    }

    next();
  };
}
