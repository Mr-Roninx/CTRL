import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseAdapter } from '../../src/db/adapter.js';
import { MigrationRunner } from '../../src/db/migrations/runner.js';
import { ApiKeyService } from '../../src/security/api_keys.js';
import { RbacService, UserRole } from '../../src/security/rbac.js';

describe('V6 Phase 4: Scopes & Financial Boundary Enforcement', () => {
  before(async () => {
    const db = DatabaseAdapter.getInstance();
    await MigrationRunner.migrateUp(db);
  });

  it('prohibits financial:execute in API key scopes structurally', async () => {
    await assert.rejects(
      async () => {
        await ApiKeyService.createApiKey({
          tenantId: 'tenant_alpha',
          name: 'Illegal Key',
          environment: 'test',
          scopes: ['events:write', 'financial:execute' as any],
        });
      },
      /Financial execution scopes are structurally forbidden/,
      'Must reject financial:execute scope creation'
    );
  });

  it('enforces RBAC role boundaries: Analyst cannot configure integrations, Owner cannot mark recovery', () => {
    // Analyst role permissions
    assert.equal(RbacService.hasPermission('Analyst', 'canConfigureIntegrations'), false);
    assert.throws(
      () => RbacService.assertPermission('Analyst', 'canConfigureIntegrations', 'Provider Setup'),
      /Forbidden: Role 'Analyst' lacks permission 'canConfigureIntegrations'/
    );

    // Operator role permissions
    assert.equal(RbacService.hasPermission('Operator', 'canRotateOwnerCredentials'), false);
    assert.throws(
      () => RbacService.assertPermission('Operator', 'canRotateOwnerCredentials', 'Key Rotation'),
      /Forbidden: Role 'Operator' lacks permission 'canRotateOwnerCredentials'/
    );

    // Invariant: Zero role can manually mark provider recovery
    const allRoles: UserRole[] = ['Viewer', 'Analyst', 'Operator', 'Admin', 'Owner'];
    for (const role of allRoles) {
      assert.equal(
        RbacService.hasPermission(role, 'canMarkProviderRecovery'),
        false,
        `Role ${role} must NOT have canMarkProviderRecovery permission`
      );
    }
  });
});
