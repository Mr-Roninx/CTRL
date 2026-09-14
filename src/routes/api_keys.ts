import { Router, Response } from 'express';
import { TenancyEnforcer, TenantScopedRequest } from '../security/tenancy.js';
import { ApiKeyService, ApiKeyScope } from '../security/api_keys.js';

export const apiKeysRouter = Router();

/**
 * POST /v1/api-keys
 * Creates a new API key for the authenticated merchant/tenant.
 * The raw secret is returned ONCE only.
 */
apiKeysRouter.post(
  '/',
  TenancyEnforcer.authenticateTenant(),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const tenantContext = req.tenantContext!;
      const { name, scopes, environment, expires_in_days } = req.body;

      if (!name) {
        res.status(400).json({ error: 'Validation Error', message: 'name is required for API key.' });
        return;
      }

      const env = environment === 'live' ? 'live' : 'test';
      const keyScopes = (Array.isArray(scopes) && scopes.length > 0)
        ? (scopes as ApiKeyScope[])
        : ['events:write', 'events:read', 'payments:read', 'recoveries:read', 'analytics:read', 'agent:read', 'integrations:read', 'integrations:write'] as ApiKeyScope[];

      const created = await ApiKeyService.createApiKey({
        tenantId: tenantContext.tenantId,
        name,
        environment: env,
        scopes: keyScopes,
        expiresInDays: expires_in_days,
      });

      res.status(201).json({
        success: true,
        message: 'API key created. Store the raw_key securely as it will not be displayed again.',
        key_id: created.keyId,
        id: created.id,
        raw_key: created.rawKey,
        name: created.record.name,
        environment: created.record.environment,
        scopes: created.record.scopes,
        created_at: created.record.created_at,
        expires_at: created.record.expires_at,
      });
    } catch (err: any) {
      res.status(400).json({ error: 'Failed to create API key', details: err.message });
    }
  }
);

/**
 * GET /v1/api-keys
 * Lists all active API keys for the authenticated tenant with secrets hashed/masked.
 */
apiKeysRouter.get(
  '/',
  TenancyEnforcer.authenticateTenant(),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const tenantContext = req.tenantContext!;
      const keys = await ApiKeyService.listApiKeys(tenantContext.tenantId);

      const keyList = keys.map((k) => ({
        id: k.id,
        name: k.name,
        key_prefix: k.key_prefix,
        key_id: k.key_id,
        environment: k.environment,
        scopes: k.scopes,
        created_at: k.created_at,
        last_used_at: k.last_used_at,
        expires_at: k.expires_at,
        revoked: Boolean(k.revoked_at),
      }));

      res.json({
        tenant_id: tenantContext.tenantId,
        api_keys: keyList,
        keys: keyList,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
  }
);

/**
 * DELETE /v1/api-keys/:id
 * Revokes an API key.
 */
apiKeysRouter.delete(
  '/:id',
  TenancyEnforcer.authenticateTenant(),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const tenantContext = req.tenantContext!;
      const rawKeyId = req.params.id;
      const keyId = (Array.isArray(rawKeyId) ? rawKeyId[0] : rawKeyId) || '';
      if (!keyId) {
        res.status(400).json({ error: 'Bad Request', message: 'Missing API key ID.' });
        return;
      }

      const revoked = await ApiKeyService.revokeApiKey(tenantContext.tenantId, keyId);
      if (!revoked) {
        res.status(404).json({ error: 'Not Found', message: 'API key not found or already revoked.' });
        return;
      }

      res.json({ success: true, message: `API key '${keyId}' revoked successfully.` });
    } catch (err: any) {
      res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
  }
);
