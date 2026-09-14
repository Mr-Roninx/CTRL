process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../../src/server.js';
import { DatabaseAdapter } from '../../src/db/adapter.js';
import { MigrationRunner } from '../../src/db/migrations/runner.js';
import { ApiKeyService } from '../../src/security/api_keys.js';

describe('V6 Phase 5: Canonical Event Ingestion', () => {
  let server: http.Server;
  let serverPort: number;
  let validApiKey: string;
  let readOnlyApiKey: string;

  before(async () => {
    const db = DatabaseAdapter.getInstance();
    await MigrationRunner.migrateUp(db);

    // Seed test tenant
    await db.execute(
      `INSERT INTO tenants (id, name, slug, environment, status, created_at)
       VALUES ('tenant_event_test', 'Event Test Tenant', 'event-test', 'test', 'ACTIVE', datetime('now'))
       ON CONFLICT(id) DO NOTHING;`
    );

    // Create API key with events:write
    const keyRecord = await ApiKeyService.createApiKey({
      tenantId: 'tenant_event_test',
      name: 'Event Write Key',
      environment: 'test',
      scopes: ['events:write', 'events:read'],
    });
    validApiKey = keyRecord.rawKey;

    // Create API key with payments:read only (missing events:write)
    const readKeyRecord = await ApiKeyService.createApiKey({
      tenantId: 'tenant_event_test',
      name: 'Read Only Key',
      environment: 'test',
      scopes: ['payments:read'],
    });
    readOnlyApiKey = readKeyRecord.rawKey;

    // Start ephemeral server
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as any;
        serverPort = addr.port;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('successfully ingests valid failed payment event from OdooX connector', async () => {
    const eventId = `evt_ingest_${Date.now()}`;
    const paymentId = `pay_ingest_${Date.now()}`;

    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validApiKey}`,
      },
      body: JSON.stringify({
        event_id: eventId,
        source: 'ODOOX_EVENT',
        provider: 'razorpay',
        environment: 'test',
        payment_id: paymentId,
        order_id: 'order_test_123',
        amount_paise: 500000,
        currency: 'INR',
        status: 'failed',
        failure_code: 'bad_request_payment_card_expired',
        failure_description: 'Card has expired',
        customer_reference: 'cust_ingest_alice@example.com',
        customer_email: 'alice@example.com',
      }),
    });

    const body: any = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.received, true);
    assert.equal(body.opportunity_id, paymentId);
    assert.equal(body.decline_type, 'soft');
    assert.ok(['pending', 'executing', 'deferred', 'abstained', 'authorized'].includes(body.status));
  });

  it('rejects event ingestion when API key lacks events:write scope', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${readOnlyApiKey}`,
      },
      body: JSON.stringify({
        event_id: `evt_unauth_${Date.now()}`,
        source: 'ODOOX_EVENT',
        provider: 'razorpay',
        environment: 'test',
        amount_paise: 250000,
        currency: 'INR',
        status: 'failed',
        customer_reference: 'cust_unauth',
      }),
    });

    const body: any = await res.json();
    assert.equal(res.status, 403);
    assert.match(body.message, /lacks required scope 'events:write'/);
  });

  it('rejects malformed event payload with 400 Bad Request', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validApiKey}`,
      },
      body: JSON.stringify({
        // Missing event_id, source, provider, amount_paise, customer_reference
        status: 'failed',
      }),
    });

    const body: any = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error, 'Validation Error');
    assert.ok(body.details.length > 0);
  });
});
