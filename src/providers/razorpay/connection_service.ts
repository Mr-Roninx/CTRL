import { DatabaseAdapter } from '../../db/adapter.js';
import { SecretsManager } from '../../security/secrets.js';
import { RazorpayClientFactory } from './client_factory.js';
import { RazorpayProviderAdapter } from './adapter.js';
import { RazorpayClientPool } from './client_pool.js';
import {
  ProviderConnectionRecord,
  ProviderType,
  ProviderEnvironment,
  ProviderCapability,
} from './types.js';

export class RazorpayConnectionService {
  /**
   * Registers or updates a tenant's Razorpay integration credentials securely.
   */
  public static async registerConnection(params: {
    tenantId: string;
    environment: ProviderEnvironment;
    keyId: string;
    keySecret: string;
    webhookSecret?: string;
  }): Promise<{ connectionId: string; credentialReference: string }> {
    const credRef = `ref_rzp_${params.tenantId}_${params.environment}`;

    // Store encrypted credentials in tenant_credentials
    await SecretsManager.storeTenantCredential({
      tenantId: params.tenantId,
      provider: 'razorpay',
      environment: params.environment,
      credentialReference: credRef,
      rawSecret: JSON.stringify({
        key_id: params.keyId,
        key_secret: params.keySecret,
        webhook_secret: params.webhookSecret,
      }),
    });

    // Invalidate client pool cache for immediate update
    RazorpayClientPool.invalidate(params.tenantId, params.environment);

    return {
      connectionId: `conn_${params.tenantId}_razorpay_${params.environment}`,
      credentialReference: credRef,
    };
  }

  /**
   * Verifies connectivity and discovers capabilities for a tenant's Razorpay connection.
   */
  public static async verifyConnection(
    tenantId: string,
    environment: ProviderEnvironment,
    credentialReference: string
  ): Promise<{
    verified: boolean;
    status: 'VERIFIED' | 'ERROR';
    capabilities: ProviderCapability[];
    error?: string;
  }> {
    try {
      const client = await RazorpayClientFactory.createClientForTenant(
        tenantId,
        credentialReference,
        environment
      );

      const adapter = new RazorpayProviderAdapter(client);
      const capabilities = await adapter.discoverCapabilities();

      return {
        verified: true,
        status: 'VERIFIED',
        capabilities,
      };
    } catch (err: any) {
      return {
        verified: false,
        status: 'ERROR',
        capabilities: [],
        error: err.message,
      };
    }
  }

  /**
   * Retrieves decrypted webhook secret for signature verification.
   * INVARIANT: Webhook secrets are never exposed outside the backend verification engine.
   */
  public static async getWebhookSecrets(
    tenantId: string,
    environment: ProviderEnvironment
  ): Promise<string[]> {
    const credRef = `ref_rzp_${tenantId}_${environment}`;
    const rawJson = await SecretsManager.getTenantCredential(tenantId, credRef);
    if (!rawJson) {
      return process.env.RAZORPAY_WEBHOOK_SECRET ? [process.env.RAZORPAY_WEBHOOK_SECRET] : [];
    }

    try {
      const parsed = JSON.parse(rawJson);
      const secrets: string[] = [];
      if (parsed.webhook_secret) secrets.push(parsed.webhook_secret);
      if (parsed.backup_webhook_secret) secrets.push(parsed.backup_webhook_secret);
      if (secrets.length === 0 && process.env.RAZORPAY_WEBHOOK_SECRET) {
        secrets.push(process.env.RAZORPAY_WEBHOOK_SECRET);
      }
      return secrets;
    } catch {
      return process.env.RAZORPAY_WEBHOOK_SECRET ? [process.env.RAZORPAY_WEBHOOK_SECRET] : [];
    }
  }

  /**
   * Lists all Razorpay connections for a given tenant.
   */
  public static async listConnections(tenantId: string): Promise<Array<{
    connectionId: string;
    environment: string;
    status: 'VERIFIED' | 'UNVERIFIED';
    createdAt: string;
  }>> {
    const credentials = await SecretsManager.listTenantCredentials(tenantId);
    
    return credentials
      .filter(c => c.provider === 'razorpay')
      .map(c => ({
        connectionId: `conn_${tenantId}_razorpay_${c.environment}`,
        environment: c.environment,
        status: 'VERIFIED', // Optimistic status, actual verification happens on-demand
        createdAt: c.createdAt,
      }));
  }

  /**
   * Deletes a Razorpay connection for a given tenant.
   */
  public static async deleteConnection(tenantId: string, environment: ProviderEnvironment): Promise<boolean> {
    const credRef = `ref_rzp_${tenantId}_${environment}`;
    return await SecretsManager.deleteTenantCredential(tenantId, credRef);
  }
}
