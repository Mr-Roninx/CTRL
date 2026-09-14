process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseAdapter } from '../../src/db/adapter.js';
import { MigrationRunner } from '../../src/db/migrations/runner.js';
import { RazorpayConnectionService } from '../../src/providers/razorpay/connection_service.js';
import { RazorpayClientFactory } from '../../src/providers/razorpay/client_factory.js';
import { SecretsManager } from '../../src/security/secrets.js';

describe('V6 Phase 6: Razorpay Provider Connection & Capability Discovery', () => {
  before(async () => {
    const db = DatabaseAdapter.getInstance();
    await MigrationRunner.migrateUp(db);

    await db.execute(
      `INSERT INTO tenants (id, name, slug, environment, status, created_at)
       VALUES ('tenant_rzp_provider', 'Provider Test Corp', 'rzp-provider', 'test', 'ACTIVE', datetime('now'))
       ON CONFLICT(id) DO NOTHING;`
    );
  });

  it('registers connection credentials and stores them with authenticated envelope encryption', async () => {
    const tenantId = 'tenant_rzp_provider';
    const keyId = 'rzp_test_mockKeyId123';
    const keySecret = 'mockSecretKeyString456';
    const webhookSecret = 'mockWebhookSecret789';

    const result = await RazorpayConnectionService.registerConnection({
      tenantId,
      environment: 'test',
      keyId,
      keySecret,
      webhookSecret,
    });

    assert.ok(result.connectionId.includes(tenantId));
    assert.equal(result.credentialReference, `ref_rzp_${tenantId}_test`);

    // Verify secret is encrypted in database
    const db = DatabaseAdapter.getInstance();
    const rows = await db.query(
      `SELECT * FROM tenant_credentials WHERE credential_reference = ?;`,
      [result.credentialReference]
    );
    assert.equal(rows.length, 1);
    assert.ok(rows[0].encrypted_data, 'Encrypted data column must be populated');
    assert.ok(rows[0].auth_tag, 'Auth tag column must be populated');
    assert.ok(!rows[0].encrypted_data.includes(keySecret), 'Plaintext secret must never be stored');

    // Verify decrypted retrieval
    const retrievedSecrets = await RazorpayConnectionService.getWebhookSecrets(tenantId, 'test');
    assert.deepEqual(retrievedSecrets, [webhookSecret]);
  });

  it('probes and discovers supported Razorpay capabilities', async () => {
    const tenantId = 'tenant_rzp_provider';
    const credRef = `ref_rzp_${tenantId}_test`;

    const verification = await RazorpayConnectionService.verifyConnection(
      tenantId,
      'test',
      credRef
    );

    assert.equal(verification.verified, true);
    assert.equal(verification.status, 'VERIFIED');
    assert.ok(verification.capabilities.length >= 3);

    const paymentLinksCap = verification.capabilities.find((c) => c.capability === 'payment_links');
    assert.equal(paymentLinksCap?.supported, true);
    assert.equal(paymentLinksCap?.status, 'VERIFIED');

    const smartRoutingCap = verification.capabilities.find((c) => c.capability === 'smart_routing');
    assert.equal(smartRoutingCap?.requires_live, true);
  });

  it('INVARIANT: Client instantiation requires explicit environment and refuses key-prefix inference alone', () => {
    // Missing/invalid explicit environment
    assert.throws(
      () => {
        RazorpayClientFactory.createClientFromConfig({
          keyId: 'rzp_live_abc',
          keySecret: 'secret_123',
          environment: 'staging' as any,
        });
      },
      /Invalid environment: 'staging'/,
      'Must reject invalid explicit environment'
    );
  });
});
