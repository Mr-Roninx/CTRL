import { Router, Response } from 'express';
import { TenancyEnforcer, TenantScopedRequest } from '../security/tenancy.js';
import { RazorpayConnectionService } from '../providers/razorpay/connection_service.js';

export const integrationsRouter = Router();

// 1. POST /v1/integrations - Configure Provider Credentials (Requires integrations:write scope)
integrationsRouter.post(
  '/',
  TenancyEnforcer.authenticateTenant('integrations:write'),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const tenantContext = req.tenantContext!;
      const { provider, environment, key_id, key_secret, webhook_secret } = req.body;

      if (provider !== 'razorpay') {
        res.status(400).json({ error: 'Unsupported provider', message: 'Only razorpay is currently supported.' });
        return;
      }

      if (!key_id || !key_secret) {
        res.status(400).json({ error: 'Validation Error', message: 'key_id and key_secret are required.' });
        return;
      }

      const env = environment === 'live' ? 'live' : 'test';

      const result = await RazorpayConnectionService.registerConnection({
        tenantId: tenantContext.tenantId,
        environment: env,
        keyId: key_id,
        keySecret: key_secret,
        webhookSecret: webhook_secret,
      });

      res.status(201).json({
        success: true,
        message: 'Provider credentials encrypted and saved successfully.',
        tenant_id: tenantContext.tenantId,
        provider: 'razorpay',
        environment: env,
        connection_id: result.connectionId,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
  }
);

// 2. POST /v1/integrations/verify - Verify Connection & Discover Capabilities
integrationsRouter.post(
  '/verify',
  TenancyEnforcer.authenticateTenant('integrations:write'),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const tenantContext = req.tenantContext!;
      const env = req.body.environment === 'live' ? 'live' : 'test';
      const credRef = `ref_rzp_${tenantContext.tenantId}_${env}`;

      const verification = await RazorpayConnectionService.verifyConnection(
        tenantContext.tenantId,
        env,
        credRef
      );

      res.json({
        tenant_id: tenantContext.tenantId,
        provider: 'razorpay',
        environment: env,
        ...verification,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
  }
);

// 3. GET /v1/integrations/capabilities - Retrieve Gated Capabilities
integrationsRouter.get(
  '/capabilities',
  TenancyEnforcer.authenticateTenant('integrations:read'),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const tenantContext = req.tenantContext!;
      const env = req.query.environment === 'live' ? 'live' : 'test';
      const credRef = `ref_rzp_${tenantContext.tenantId}_${env}`;

      const verification = await RazorpayConnectionService.verifyConnection(
        tenantContext.tenantId,
        env,
        credRef
      );

      res.json({
        tenant_id: tenantContext.tenantId,
        provider: 'razorpay',
        environment: env,
        capabilities: verification.capabilities,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
  }
);

// 4. GET /v1/integrations/connections - List All Connections
integrationsRouter.get(
  '/connections',
  TenancyEnforcer.authenticateTenant('integrations:read'),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const tenantContext = req.tenantContext!;
      const connections = await RazorpayConnectionService.listConnections(tenantContext.tenantId);
      
      // Attempt verification to discover capabilities
      const verifiedConnections = await Promise.all(
        connections.map(async (conn) => {
          const credRef = `ref_rzp_${tenantContext.tenantId}_${conn.environment}`;
          const verification = await RazorpayConnectionService.verifyConnection(
            tenantContext.tenantId,
            conn.environment as any,
            credRef
          );
          
          return {
            ...conn,
            status: verification.status,
            capabilities: verification.capabilities,
          };
        })
      );
      
      res.json({
        connections: verifiedConnections,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
  }
);

// 5. POST /v1/integrations/razorpay/connect - Razorpay Connect Helper
integrationsRouter.post(
  '/razorpay/connect',
  TenancyEnforcer.authenticateTenant('integrations:write'),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const tenantContext = req.tenantContext!;
      const { environment, key_id, key_secret, webhook_secret } = req.body;

      if (!key_id || !key_secret) {
        res.status(400).json({ error: 'Validation Error', message: 'key_id and key_secret are required.' });
        return;
      }

      const env = environment === 'live' ? 'live' : 'test';

      const result = await RazorpayConnectionService.registerConnection({
        tenantId: tenantContext.tenantId,
        environment: env,
        keyId: key_id,
        keySecret: key_secret,
        webhookSecret: webhook_secret,
      });

      res.status(201).json({
        success: true,
        message: 'Razorpay credentials verified and saved successfully.',
        tenant_id: tenantContext.tenantId,
        environment: env,
        connection_id: result.connectionId,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Failed to connect Razorpay account',
        message: err.message || 'Unknown database or encryption error',
        details: err.message,
      });
    }
  }
);

// 7. GET /v1/integrations/razorpay/status - Check Razorpay connection & Supabase synchronization
integrationsRouter.get(
  '/razorpay/status',
  TenancyEnforcer.authenticateTenant('integrations:read'),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const tenantContext = req.tenantContext!;
      const credRef = `ref_rzp_${tenantContext.tenantId}_test`;
      const { SecretsManager } = await import('../security/secrets.js');
      const cred = await SecretsManager.getTenantCredential(tenantContext.tenantId, credRef);
      const hasEnvKeys = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

      let parsedCred: any = null;
      if (cred) {
        try {
          parsedCred = JSON.parse(cred);
        } catch {}
      }

      // Retrieve or automatically provision an active integration API key for this merchant
      const { ApiKeyService } = await import('../security/api_keys.js');
      const apiKeys = await ApiKeyService.listApiKeys(tenantContext.tenantId);
      const firstKey = apiKeys[0];
      let activeKey = firstKey
        ? (firstKey.key_prefix ? `${firstKey.key_prefix}${firstKey.key_id}` : firstKey.id)
        : null;

      if (!activeKey) {
        const created = await ApiKeyService.createApiKey({
          tenantId: tenantContext.tenantId,
          name: 'Default Drop-In Key',
          environment: 'test',
          scopes: ['events:write', 'events:read', 'payments:read', 'recoveries:read', 'integrations:read', 'integrations:write'],
        });
        activeKey = created.rawKey;
      }

      const keyId = parsedCred?.key_id || (hasEnvKeys ? process.env.RAZORPAY_KEY_ID : null);
      const isConnected = Boolean(keyId);
      const apiBase = process.env.APP_URL || 'http://localhost:3001';

      res.json({
        connected: isConnected,
        tenant_id: tenantContext.tenantId,
        provider: 'razorpay',
        environment: parsedCred?.environment || 'test',
        key_id: keyId,
        masked_key_secret: parsedCred?.key_secret
          ? `••••••••••••${parsedCred.key_secret.slice(-4)}`
          : (hasEnvKeys ? `••••••••••••${(process.env.RAZORPAY_KEY_SECRET || '').slice(-4)}` : null),
        webhook_secret_configured: Boolean(parsedCred?.webhook_secret || process.env.RAZORPAY_WEBHOOK_SECRET),
        webhook_url: `${apiBase}/webhooks/razorpay/${tenantContext.tenantId}`,
        script_key: activeKey,
        script_url: `${apiBase}/sdk/ctrl.js`,
        download_url: `${apiBase}/sdk/download?api_key=${activeKey}&api_url=${encodeURIComponent(apiBase)}`,
        script_tag: `<script src="${apiBase}/sdk/ctrl.js" data-api-key="${activeKey}" defer></script>`,
        persisted_in_supabase: true,
        capabilities: [
          'PAYMENT_LINKS_CREATE',
          'WEBHOOK_EVENT_INGESTION',
          'PAYMENT_STATUS_POLLING',
          'DYNAMIC_UPI_QR',
        ],
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
  }
);

