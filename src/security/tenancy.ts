import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ApiKeyService, ApiKeyScope } from './api_keys.js';
import { SessionAuthService, SessionUser } from './session_auth.js';
import { verifySupabaseToken } from './supabase.js';
import { UserRole } from './rbac.js';

export interface TenantContext {
  tenantId: string;
  environment: 'live' | 'test';
  authType: 'API_KEY' | 'SESSION' | 'WEBHOOK';
  scopes?: ApiKeyScope[];
  user?: SessionUser;
}

export interface TenantScopedRequest extends Request {
  tenantContext?: TenantContext;
}

/**
 * Property-Level Protection Invariant:
 * List of critical fields that CANNOT be modified or injected via client payloads.
 */
export const PROTECTED_MUTATION_PROPERTIES = [
  'tenant_id',
  'environment',
  'authority_result',
  'recovered',
  'amount_paid',
  'provider_status',
  'ledger_state',
  'agent_role',
  'safety_ceilings',
];

export class TenancyEnforcer {
  /**
   * Asserts that a request body does not attempt to mutate protected properties.
   */
  public static validatePropertyLevelProtection(body: Record<string, any>, context?: TenantContext): void {
    if (!body || typeof body !== 'object') return;

    for (const prop of PROTECTED_MUTATION_PROPERTIES) {
      if (prop in body) {
        if (prop === 'environment' && context && body[prop] === context.environment) {
          continue;
        }
        if (prop === 'tenant_id' && context && body[prop] === context.tenantId) {
          continue;
        }
        throw new Error(`Security Violation: Client-supplied mutation of protected property '${prop}' is strictly rejected.`);
      }
    }
  }

  /**
   * Asserts that a requested resource belongs strictly to the authenticated tenant.
   */
  public static assertTenantOwnership(authenticatedTenantId: string, resourceTenantId: string, resourceId: string): void {
    if (!authenticatedTenantId || authenticatedTenantId !== resourceTenantId) {
      throw new Error(`Tenant Isolation Violation: Tenant '${authenticatedTenantId}' cannot access resource '${resourceId}' owned by '${resourceTenantId}'. Access Denied.`);
    }
  }

  /**
   * Express middleware to authenticate Bearer API keys OR Dashboard Sessions (Local JWT & Supabase).
   */
  public static authenticateTenant(requiredScope?: ApiKeyScope) {
    return async (req: TenantScopedRequest, res: Response, next: NextFunction): Promise<void> => {
      let authHeader = req.headers.authorization;
      if (!authHeader && typeof req.query.token === 'string') {
        authHeader = `Bearer ${req.query.token}`;
      } else if (!authHeader && typeof req.query.api_key === 'string') {
        authHeader = `Bearer ${req.query.api_key}`;
      }

      if (process.env.AUTH_REQUIRED === 'false' && (!authHeader || !authHeader.startsWith('Bearer '))) {
        req.tenantContext = {
          tenantId: 'tenant_system_default',
          environment: 'test',
          authType: 'SESSION',
          user: {
            userId: 'dev_operator',
            tenantId: 'tenant_system_default',
            email: 'dev@ctrl.internal',
            role: 'Owner',
            mfaVerified: true,
          },
        };
        return next();
      }

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Missing or malformed Authorization Bearer header or token parameter.',
        });
        return;
      }

      const token = authHeader.substring(7).trim();

      // 1. Try API Key Authentication (Machine-to-Machine)
      if (token.startsWith('ul_live_') || token.startsWith('ul_test_')) {
        const keyAuth = await ApiKeyService.authenticateKey(token);
        if (!keyAuth.valid || !keyAuth.tenantId) {
          res.status(401).json({ error: 'Unauthorized', message: keyAuth.errorReason || 'Invalid API key' });
          return;
        }

        // Scope check
        if (requiredScope && (!keyAuth.scopes || !keyAuth.scopes.includes(requiredScope))) {
          res.status(403).json({
            error: 'Forbidden',
            message: `API key lacks required scope '${requiredScope}'. Granted: [${keyAuth.scopes?.join(', ')}]`,
          });
          return;
        }

        req.tenantContext = {
          tenantId: keyAuth.tenantId,
          environment: keyAuth.environment || 'test',
          authType: 'API_KEY',
          scopes: keyAuth.scopes,
        };

        return next();
      }

      // 2. Try Dashboard Session Authentication (Local Signed JWT)
      const sessionAuth = await SessionAuthService.validateSession(token);
      if (sessionAuth.valid && sessionAuth.user) {
        req.tenantContext = {
          tenantId: sessionAuth.user.tenantId,
          environment: 'test',
          authType: 'SESSION',
          user: sessionAuth.user,
        };
        return next();
      }

      // 3. Try Supabase Auth Token (OAuth / Magic Link / Supabase Session)
      try {
        const sbAuth = await verifySupabaseToken(token);
        if (sbAuth.valid && sbAuth.user) {
          const tenantId = sbAuth.user.tenantId || `tnt_${sbAuth.user.id.slice(0, 8)}`;
          const sessionUser: SessionUser = {
            userId: sbAuth.user.id,
            tenantId: tenantId,
            email: sbAuth.user.email || 'merchant@supabase.auth',
            role: (sbAuth.user.role as UserRole) || 'Owner',
            mfaVerified: true,
          };

          req.tenantContext = {
            tenantId: tenantId,
            environment: 'test',
            authType: 'SESSION',
            user: sessionUser,
          };

          return next();
        }
      } catch {
        // Continue to fallback
      }

      // Reject any unverified or invalid token
      res.status(401).json({
        error: 'Unauthorized',
        message: sessionAuth.errorReason || 'Invalid or unverified authentication token.',
      });
    };
  }
}

