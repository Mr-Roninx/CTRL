/**
 * Razorpay Tenant Client Pool
 *
 * Maintains a per-tenant LRU cache of Razorpay SDK client instances.
 * Each tenant has their own Razorpay account credentials stored in
 * tenant_credentials (AES-256-GCM encrypted via SecretsManager).
 *
 * Instead of reading keys from .env, all execution now goes through here.
 */
import Razorpay from 'razorpay';
import { SecretsManager } from '../../security/secrets.js';

interface PoolEntry {
  client: Razorpay;
  expiresAt: number;
  tenantId: string;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_POOL_SIZE = 100;

export class RazorpayClientPool {
  private static pool: Map<string, PoolEntry> = new Map();

  /**
   * Returns a Razorpay client for the given tenant, creating one if needed.
   * Falls back to environment variables for the system default tenant.
   */
  public static async getClient(tenantId: string, environment: 'test' | 'live' = 'test'): Promise<Razorpay> {
    const cacheKey = `${tenantId}:${environment}`;
    const now = Date.now();

    // Return cached client if still valid
    const cached = this.pool.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.client;
    }

    // Resolve credentials
    let keyId: string;
    let keySecret: string;

    if (tenantId === 'tenant_system_default') {
      // Fall back to env vars for system/legacy data
      if (environment === 'live') {
        keyId = process.env.RAZORPAY_LIVE_KEY_ID || '';
        keySecret = process.env.RAZORPAY_LIVE_KEY_SECRET || '';
      } else {
        keyId = process.env.RAZORPAY_KEY_ID || '';
        keySecret = process.env.RAZORPAY_KEY_SECRET || '';
      }

      if (!keyId || !keySecret) {
        throw new Error(`Razorpay credentials not configured for system default tenant in environment '${environment}'.`);
      }
    } else {
      // Resolve from encrypted tenant credential store
      const credRef = `ref_rzp_${tenantId}_${environment}`;
      const rawJson = await SecretsManager.getTenantCredential(tenantId, credRef);

      if (rawJson) {
        const creds = JSON.parse(rawJson);
        keyId = creds.key_id;
        keySecret = creds.key_secret;
      } else if (environment === 'live' && process.env.RAZORPAY_LIVE_KEY_ID && process.env.RAZORPAY_LIVE_KEY_SECRET) {
        // Fallback to system live credentials if configured
        keyId = process.env.RAZORPAY_LIVE_KEY_ID;
        keySecret = process.env.RAZORPAY_LIVE_KEY_SECRET;
      } else if (environment === 'test' && process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
        // Graceful fallback to default system test keys for evaluation in test mode
        keyId = process.env.RAZORPAY_KEY_ID;
        keySecret = process.env.RAZORPAY_KEY_SECRET;
      } else {
        throw new Error(
          `No Razorpay credentials found for tenant '${tenantId}' in environment '${environment}'. ` +
          `Please connect a Razorpay account in Settings → Integrations.`
        );
      }
    }

    // Strict Environmental Boundary Assertion
    if (environment === 'test' && keyId.startsWith('rzp_live_')) {
      throw new Error(`Security Boundary Violation: Live Razorpay key '${keyId.slice(0, 12)}...' cannot be initialized in 'test' environment.`);
    }
    if (environment === 'live' && keyId.startsWith('rzp_test_')) {
      throw new Error(`Security Boundary Violation: Test Razorpay key '${keyId.slice(0, 12)}...' cannot be initialized in 'live' production environment.`);
    }

    // Evict oldest entry if pool is full
    if (this.pool.size >= MAX_POOL_SIZE) {
      const oldest = [...this.pool.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
      if (oldest) this.pool.delete(oldest[0]);
    }

    const client = new Razorpay({ key_id: keyId, key_secret: keySecret });

    this.pool.set(cacheKey, {
      client,
      expiresAt: now + CACHE_TTL_MS,
      tenantId,
    });

    return client;
  }

  /**
   * Invalidates a tenant's cached client (e.g. after key rotation).
   */
  public static invalidate(tenantId: string, environment: 'test' | 'live' = 'test'): void {
    this.pool.delete(`${tenantId}:${environment}`);
  }

  /**
   * Returns pool size for monitoring.
   */
  public static getPoolSize(): number {
    return this.pool.size;
  }
}
