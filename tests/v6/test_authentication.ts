import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseAdapter } from '../../src/db/adapter.js';
import { MigrationRunner } from '../../src/db/migrations/runner.js';
import { SessionAuthService } from '../../src/security/session_auth.js';
import { SecretsManager } from '../../src/security/secrets.js';

describe('V6 Phase 4: Authentication & Secrets Storage', () => {
  before(async () => {
    const db = DatabaseAdapter.getInstance();
    await MigrationRunner.migrateUp(db);

    await db.execute(
      `INSERT INTO tenants (id, name, slug, environment, status, created_at)
       VALUES ('tenant_alpha', 'Alpha Corp', 'alpha', 'test', 'ACTIVE', datetime('now'))
       ON CONFLICT(id) DO NOTHING;`
    );
    await db.execute(
      `INSERT INTO users (id, email, name, password_hash, created_at)
       VALUES ('usr_sarah_101', 'sarah@alphacorp.com', 'Sarah Connor', 'hash_123', datetime('now'))
       ON CONFLICT(id) DO NOTHING;`
    );
  });

  it('creates and validates JWT session tokens linked to database sessions', async () => {
    const session = await SessionAuthService.createSession({
      userId: 'usr_sarah_101',
      tenantId: 'tenant_alpha',
      email: 'sarah@alphacorp.com',
      role: 'Operator',
    });

    assert.ok(session.token, 'Session token must be returned');
    assert.ok(session.sessionId, 'Session ID must be returned');

    // Validate valid token
    const valResult = await SessionAuthService.validateSession(session.token);
    assert.equal(valResult.valid, true);
    assert.equal(valResult.user?.userId, 'usr_sarah_101');
    assert.equal(valResult.user?.tenantId, 'tenant_alpha');
    assert.equal(valResult.user?.role, 'Operator');

    // Revoke session
    const revoked = await SessionAuthService.revokeSession(session.sessionId);
    assert.equal(revoked, true);

    // Validate after revocation must fail
    const valAfterRevoke = await SessionAuthService.validateSession(session.token);
    assert.equal(valAfterRevoke.valid, false);
    assert.match(valAfterRevoke.errorReason || '', /revoked/);
  });

  it('resolves D6: encrypts and decrypts tenant credentials with AES-256-GCM authenticated envelope', async () => {
    const tenantId = 'tenant_alpha';
    const secret = 'rzp_live_secret_key_super_confidential_999';

    // Store encrypted credential
    await SecretsManager.storeTenantCredential({
      tenantId,
      provider: 'razorpay',
      environment: 'test',
      credentialReference: 'ref_rzp_alpha_primary',
      rawSecret: secret,
    });

    // Decrypt and verify
    const decrypted = await SecretsManager.getTenantCredential(tenantId, 'ref_rzp_alpha_primary');
    assert.equal(decrypted, secret, 'Decrypted secret must match original plaintext');

    // Cross-tenant access fails
    const crossTenantDecrypted = await SecretsManager.getTenantCredential('tenant_beta', 'ref_rzp_alpha_primary');
    assert.equal(crossTenantDecrypted, null, 'Tenant Beta cannot access Tenant Alpha credentials');
  });
});
