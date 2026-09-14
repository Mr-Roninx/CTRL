import crypto from 'node:crypto';
import { DatabaseAdapter } from '../db/adapter.js';

export type ApiKeyScope =
  | 'events:write'
  | 'events:read'
  | 'payments:read'
  | 'recoveries:read'
  | 'analytics:read'
  | 'agent:read'
  | 'integrations:read'
  | 'integrations:write';

export const VALID_API_KEY_SCOPES: ApiKeyScope[] = [
  'events:write',
  'events:read',
  'payments:read',
  'recoveries:read',
  'analytics:read',
  'agent:read',
  'integrations:read',
  'integrations:write',
];

/**
 * Explicit allowlist of demo key IDs. Only these exact IDs are accepted as demo keys.
 * Replaces wildcard .includes('demo') matching to prevent unintended auto-authentication.
 * Demo keys are ONLY valid when NODE_ENV !== 'production'.
 */
const ALLOWED_DEMO_KEY_IDS = new Set([
  'live_key_demo',
  'test_live_key_demo',
  'demo_merchant',
]);

export interface ApiKeyRecord {
  id: string;
  tenant_id: string;
  name: string;
  key_prefix: string;
  key_id: string;
  secret_hash: string;
  environment: 'live' | 'test';
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

export class ApiKeyService {
  /**
   * Generates a new cryptographically secure API key.
   * Format: ctrl_{environment}_{keyId}.{rawSecret}
   * Returns rawKey (shown once only) and stores SHA-256 hash.
   */
  public static async createApiKey(params: {
    tenantId: string;
    name: string;
    environment: 'live' | 'test';
    scopes: ApiKeyScope[];
    expiresInDays?: number;
  }): Promise<{
    id: string;
    keyId: string;
    rawKey: string;
    record: ApiKeyRecord;
  }> {
    // 1. Invariant: No scope may ever include financial:execute
    for (const scope of params.scopes) {
      if ((scope as string).includes('financial:execute') || !VALID_API_KEY_SCOPES.includes(scope)) {
        throw new Error(`Invalid scope: '${scope}'. Financial execution scopes are structurally forbidden.`);
      }
    }

    const keyPrefix = `ctrl_${params.environment}_`;
    const keyId = crypto.randomBytes(6).toString('hex'); // 12 chars
    const rawSecret = crypto.randomBytes(16).toString('hex'); // 32 chars
    const rawKey = `${keyPrefix}${keyId}.${rawSecret}`;
    const secretHash = crypto.createHash('sha256').update(rawSecret).digest('hex');

    const id = `apk_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    const expiresAt = params.expiresInDays
      ? new Date(Date.now() + params.expiresInDays * 86400000).toISOString()
      : null;

    const db = DatabaseAdapter.getInstance();
    await db.execute(
      `INSERT INTO api_keys (id, tenant_id, name, key_prefix, key_id, secret_hash, environment, scopes, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        id,
        params.tenantId,
        params.name,
        keyPrefix,
        keyId,
        secretHash,
        params.environment,
        JSON.stringify(params.scopes),
        now,
        expiresAt,
      ]
    );

    // Permanently sync and persist API key to Supabase
    try {
      const { SupabaseStore } = await import('./supabase_store.js');
      await SupabaseStore.saveApiKey({
        id,
        tenant_id: params.tenantId,
        name: params.name,
        key_prefix: keyPrefix,
        key_hash: secretHash,
        scopes: params.scopes,
        status: 'ACTIVE',
        created_at: now,
        expires_at: expiresAt,
      });
    } catch (sbErr: any) {
      console.warn('⚠️ Supabase API key sync warning:', sbErr.message);
    }

    const record: ApiKeyRecord = {
      id,
      tenant_id: params.tenantId,
      name: params.name,
      key_prefix: keyPrefix,
      key_id: keyId,
      secret_hash: secretHash,
      environment: params.environment,
      scopes: params.scopes,
      created_at: now,
      last_used_at: null,
      expires_at: expiresAt,
      revoked_at: null,
    };

    return {
      id,
      keyId,
      rawKey,
      record,
    };
  }

  /**
   * Authenticates a raw Bearer API key token (with Supabase fallback).
   */
  public static async authenticateKey(
    rawKey: string,
    requiredScope?: ApiKeyScope
  ): Promise<{
    valid: boolean;
    tenantId?: string;
    environment?: 'live' | 'test';
    scopes?: ApiKeyScope[];
    errorReason?: string;
  }> {
    const isCtrlKey = rawKey && (rawKey.startsWith('ctrl_live_') || rawKey.startsWith('ctrl_test_'));
    const isLegacyKey = rawKey && (rawKey.startsWith('ul_live_') || rawKey.startsWith('ul_test_'));
    if (!rawKey || (!isCtrlKey && !isLegacyKey)) {
      return { valid: false, errorReason: 'Malformed API key format' };
    }

    const dotIndex = rawKey.indexOf('.');
    const db = DatabaseAdapter.getInstance();

    if (dotIndex === -1) {
      // Client-side Publishable Key format for ctrl.js browser interceptors (e.g. ctrl_test_key_...)
      const cleanKeyId = rawKey.replace(/^(ctrl|ul)_(live|test)_/, '');

      // Allow built-in demo keys — ONLY in non-production environments
      const isDemoAllowed = process.env.NODE_ENV !== 'production';
      if (isDemoAllowed && ALLOWED_DEMO_KEY_IDS.has(cleanKeyId)) {
        const demoScopes: ApiKeyScope[] = [...VALID_API_KEY_SCOPES];
        if (requiredScope && !demoScopes.includes(requiredScope) && !demoScopes.includes('*' as any)) {
          return {
            valid: false,
            tenantId: 'tenant_system_default',
            environment: rawKey.includes('_live_') ? 'live' : 'test',
            scopes: demoScopes,
            errorReason: `Forbidden: API key lacks required scope '${requiredScope}'`,
          };
        }
        return {
          valid: true,
          tenantId: 'tenant_system_default',
          environment: rawKey.includes('_live_') ? 'live' : 'test',
          scopes: demoScopes,
        };
      } else if (!isDemoAllowed && ALLOWED_DEMO_KEY_IDS.has(cleanKeyId)) {
        return { valid: false, errorReason: 'Demo keys are disabled in production environment' };
      }

      const pubRows = await db.query<any>(
        `SELECT * FROM api_keys WHERE key_id = ? OR id = ? OR id LIKE ? OR key_id LIKE ?;`,
        [cleanKeyId, cleanKeyId, `${cleanKeyId}%`, `${cleanKeyId}%`]
      );

      if (pubRows && pubRows.length > 0) {
        const record = pubRows[0];
        if (record.revoked_at) return { valid: false, errorReason: 'API key has been revoked' };
        if (record.expires_at && new Date(record.expires_at).getTime() < Date.now()) {
          return { valid: false, errorReason: 'API key has expired' };
        }

        let scopes: ApiKeyScope[] = [];
        try {
          scopes = typeof record.scopes === 'string' ? JSON.parse(record.scopes) : record.scopes;
        } catch {
          scopes = ['events:write', 'events:read'];
        }

        if (requiredScope && !scopes.includes(requiredScope) && !scopes.includes('*' as any)) {
          return {
            valid: false,
            tenantId: record.tenant_id,
            environment: record.environment || 'test',
            scopes,
            errorReason: `Forbidden: API key lacks required scope '${requiredScope}'`,
          };
        }

        return {
          valid: true,
          tenantId: record.tenant_id,
          environment: record.environment || 'test',
          scopes,
        };
      }

      return { valid: false, errorReason: 'Missing API key secret component' };
    }

    const prefixAndId = rawKey.substring(0, dotIndex);
    const rawSecret = rawKey.substring(dotIndex + 1);
    const keyId = prefixAndId.replace(/^(ctrl|ul)_(live|test)_/, '');
    const computedHash = crypto.createHash('sha256').update(rawSecret).digest('hex');

    let rows = await db.query<any>(
      `SELECT * FROM api_keys WHERE key_id = ?;`,
      [keyId]
    );

    // If not found locally, query Supabase
    if (rows.length === 0) {
      try {
        const { SupabaseStore } = await import('./supabase_store.js');
        const sbKey = await SupabaseStore.fetchApiKeyByHash(computedHash);
        if (sbKey) {
          const now = new Date().toISOString();
          await db.execute(
            `INSERT OR REPLACE INTO api_keys (id, tenant_id, name, key_prefix, key_id, secret_hash, environment, scopes, created_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, 'test', ?, ?, ?);`,
            [
              sbKey.id,
              sbKey.tenant_id,
              sbKey.name,
              sbKey.key_prefix,
              keyId,
              sbKey.key_hash,
              JSON.stringify(sbKey.scopes),
              sbKey.created_at || now,
              sbKey.expires_at || null,
            ]
          ).catch(() => {});

          rows = [{
            id: sbKey.id,
            tenant_id: sbKey.tenant_id,
            name: sbKey.name,
            key_prefix: sbKey.key_prefix,
            key_id: keyId,
            secret_hash: sbKey.key_hash,
            environment: 'test',
            scopes: sbKey.scopes,
            created_at: sbKey.created_at || now,
            expires_at: sbKey.expires_at || null,
            revoked_at: sbKey.status === 'REVOKED' ? now : null,
          }];
        }
      } catch {
        // ignore
      }
    }

    if (rows.length === 0) {
      const isDemoAllowed = process.env.NODE_ENV !== 'production';
      if (ALLOWED_DEMO_KEY_IDS.has(keyId) || keyId === 'live_key_demo') {
        if (!isDemoAllowed) {
          return { valid: false, errorReason: 'Demo keys are disabled in production environment' };
        }
        const demoScopes: ApiKeyScope[] = [...VALID_API_KEY_SCOPES];
        return {
          valid: true,
          tenantId: 'tenant_system_default',
          environment: rawKey.includes('_live_') ? 'live' : 'test',
          scopes: demoScopes,
        };
      }
      return { valid: false, errorReason: 'API key not found' };
    }

    const record = rows[0];

    // Check revocation
    if (record.revoked_at) {
      return { valid: false, errorReason: 'API key has been revoked' };
    }

    // Check expiration
    if (record.expires_at && new Date(record.expires_at).getTime() < Date.now()) {
      return { valid: false, errorReason: 'API key has expired' };
    }

    // Verify secret hash
    const computedBuf = Buffer.from(computedHash, 'utf-8');
    const storedBuf = Buffer.from(record.secret_hash, 'utf-8');

    if (computedBuf.length !== storedBuf.length || !crypto.timingSafeEqual(computedBuf, storedBuf)) {
      return { valid: false, errorReason: 'Invalid API key secret' };
    }

    // Update last_used_at timestamp asynchronously
    db.execute(`UPDATE api_keys SET last_used_at = ? WHERE id = ?;`, [
      new Date().toISOString(),
      record.id,
    ]).catch(() => {});

    const scopes: ApiKeyScope[] = typeof record.scopes === 'string'
      ? JSON.parse(record.scopes)
      : record.scopes;

    if (requiredScope && !scopes.includes(requiredScope) && !scopes.includes('*' as any)) {
      return {
        valid: false,
        tenantId: record.tenant_id,
        environment: record.environment || 'test',
        scopes,
        errorReason: `Forbidden: API key lacks required scope '${requiredScope}'`,
      };
    }

    return {
      valid: true,
      tenantId: record.tenant_id,
      environment: record.environment || 'test',
      scopes,
    };
  }

  /**
   * Checks per-key rate limits in Redis or memory bucket.
   */
  public static async checkKeyRateLimit(
    keyId: string,
    limit: number = 1000,
    windowSec: number = 60
  ): Promise<{ allowed: boolean; remaining: number }> {
    const { DistributedRateLimiter } = await import('../cache/rate_limiter.js');
    return DistributedRateLimiter.checkLimit(`ratelimit:apikey:${keyId}`, limit, windowSec);
  }

  /**
   * Revokes an existing API key.
   */
  public static async revokeApiKey(tenantId: string, keyIdentifier: string): Promise<boolean> {
    const db = DatabaseAdapter.getInstance();
    const now = new Date().toISOString();
    const result = await db.execute(
      `UPDATE api_keys SET revoked_at = ? WHERE tenant_id = ? AND (key_id = ? OR id = ?) AND revoked_at IS NULL;`,
      [now, tenantId, keyIdentifier, keyIdentifier]
    );

    try {
      const { SupabaseStore } = await import('./supabase_store.js');
      await SupabaseStore.revokeApiKey(tenantId, keyIdentifier);
    } catch {}

    return (result?.rowCount ?? 0) > 0;
  }

  /**
   * Lists all API keys for a tenant (without returning raw secret, hydratable from Supabase).
   */
  public static async listApiKeys(tenantId: string): Promise<ApiKeyRecord[]> {
    const db = DatabaseAdapter.getInstance();
    let rows = await db.query<any>(
      `SELECT id, tenant_id, name, key_prefix, key_id, secret_hash, environment, scopes, created_at, last_used_at, expires_at, revoked_at
       FROM api_keys WHERE tenant_id = ? ORDER BY created_at DESC;`,
      [tenantId]
    );

    if (!rows || rows.length === 0) {
      try {
        const { SupabaseStore } = await import('./supabase_store.js');
        const sbKeys = await SupabaseStore.listApiKeys(tenantId);
        if (sbKeys.length > 0) {
          for (const k of sbKeys) {
            await db.execute(
              `INSERT OR REPLACE INTO api_keys (id, tenant_id, name, key_prefix, key_id, secret_hash, environment, scopes, created_at, expires_at)
               VALUES (?, ?, ?, ?, ?, ?, 'test', ?, ?, ?);`,
              [
                k.id,
                k.tenant_id,
                k.name,
                k.key_prefix,
                k.id.slice(0, 12),
                k.key_hash,
                JSON.stringify(k.scopes),
                k.created_at || new Date().toISOString(),
                k.expires_at || null,
              ]
            ).catch(() => {});
          }
          rows = await db.query<any>(
            `SELECT id, tenant_id, name, key_prefix, key_id, secret_hash, environment, scopes, created_at, last_used_at, expires_at, revoked_at
             FROM api_keys WHERE tenant_id = ? ORDER BY created_at DESC;`,
            [tenantId]
          );
        }
      } catch {}
    }

    return (rows || []).map((r: any) => ({
      id: r.id,
      tenant_id: r.tenant_id,
      name: r.name,
      key_prefix: r.key_prefix,
      key_id: r.key_id,
      secret_hash: r.secret_hash,
      environment: r.environment,
      scopes: typeof r.scopes === 'string' ? JSON.parse(r.scopes) : r.scopes,
      created_at: r.created_at,
      last_used_at: r.last_used_at,
      expires_at: r.expires_at,
      revoked_at: r.revoked_at,
    }));
  }
}
