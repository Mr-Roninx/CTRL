import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseAdapter } from '../../src/db/adapter.js';
import { MigrationRunner } from '../../src/db/migrations/runner.js';
import { TenancyEnforcer } from '../../src/security/tenancy.js';

describe('V6 Phase 4: Tenant Isolation & Boundary Security', () => {
  before(async () => {
    const db = DatabaseAdapter.getInstance();
    await MigrationRunner.migrateUp(db);

    // Seed test tenants
    await db.execute(
      `INSERT INTO tenants (id, name, slug, environment, status, created_at)
       VALUES ('tenant_alpha', 'Alpha Corp', 'alpha', 'test', 'ACTIVE', datetime('now'))
       ON CONFLICT(id) DO NOTHING;`
    );
    await db.execute(
      `INSERT INTO tenants (id, name, slug, environment, status, created_at)
       VALUES ('tenant_beta', 'Beta Corp', 'beta', 'test', 'ACTIVE', datetime('now'))
       ON CONFLICT(id) DO NOTHING;`
    );
  });

  it('enforces strict tenant isolation: fails closed when tenant tries to access another tenant resource', () => {
    const tenantAlpha = 'tenant_alpha';
    const tenantBeta = 'tenant_beta';
    const resourceOwnedByBeta = 'opp_beta_999';

    // Access by owner should succeed
    assert.doesNotThrow(() => {
      TenancyEnforcer.assertTenantOwnership(tenantBeta, tenantBeta, resourceOwnedByBeta);
    });

    // Cross-tenant access must throw
    assert.throws(
      () => {
        TenancyEnforcer.assertTenantOwnership(tenantAlpha, tenantBeta, resourceOwnedByBeta);
      },
      /Tenant Isolation Violation/,
      'Cross-tenant resource access must throw isolation violation error'
    );
  });

  it('enforces property-level protection: rejects client-supplied mutation of protected properties', () => {
    // Attempting to overwrite tenant_id
    assert.throws(
      () => {
        TenancyEnforcer.validatePropertyLevelProtection({ tenant_id: 'tenant_hacked', amount: 5000 });
      },
      /Security Violation: Client-supplied mutation of protected property 'tenant_id'/,
      'Mutating tenant_id must be rejected'
    );

    // Attempting to overwrite recovered state or amount_paid
    assert.throws(
      () => {
        TenancyEnforcer.validatePropertyLevelProtection({ recovered: true, status: 'completed' });
      },
      /Security Violation: Client-supplied mutation of protected property 'recovered'/
    );

    assert.throws(
      () => {
        TenancyEnforcer.validatePropertyLevelProtection({ amount_paid: 100000 });
      },
      /Security Violation: Client-supplied mutation of protected property 'amount_paid'/
    );

    // Safe payload should pass
    assert.doesNotThrow(() => {
      TenancyEnforcer.validatePropertyLevelProtection({ customer_notes: 'Urgent renewal', contact_phone: '+919999999999' });
    });
  });
});
