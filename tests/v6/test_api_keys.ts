import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseAdapter } from '../../src/db/adapter.js';
import { MigrationRunner } from '../../src/db/migrations/runner.js';
import { ApiKeyService } from '../../src/security/api_keys.js';

describe('V6 Phase 4: API Key Lifecycle & Verification', () => {
  before(async () => {
    const db = DatabaseAdapter.getInstance();
    await MigrationRunner.migrateUp(db);
  });

  it('generates API keys with standard prefixes, hashes secret in DB, and authenticates successfully', async () => {
    const created = await ApiKeyService.createApiKey({
      tenantId: 'tenant_alpha',
      name: 'OdooX Connector Key',
      environment: 'test',
      scopes: ['events:write', 'payments:read'],
      expiresInDays: 30,
    });

    assert.ok(created.rawKey.startsWith('ctrl_test_'), 'API key must start with ctrl_test_ prefix');
    assert.equal(created.record.tenant_id, 'tenant_alpha');

    // Authenticate with raw key
    const authResult = await ApiKeyService.authenticateKey(created.rawKey);
    assert.equal(authResult.valid, true);
    assert.equal(authResult.tenantId, 'tenant_alpha');
    assert.equal(authResult.environment, 'test');
    assert.deepEqual(authResult.scopes, ['events:write', 'payments:read']);

    // Authenticate with tampered secret fails
    const tamperedKey = created.rawKey.slice(0, -4) + 'ffff';
    const tamperedAuth = await ApiKeyService.authenticateKey(tamperedKey);
    assert.equal(tamperedAuth.valid, false);

    // Revoke key
    const revoked = await ApiKeyService.revokeApiKey('tenant_alpha', created.keyId);
    assert.equal(revoked, true);

    // Authenticate after revocation fails
    const postRevokeAuth = await ApiKeyService.authenticateKey(created.rawKey);
    assert.equal(postRevokeAuth.valid, false);
    assert.match(postRevokeAuth.errorReason || '', /revoked/);
  });
});
