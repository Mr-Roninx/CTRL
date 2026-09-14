process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../../src/server.js';
import { DatabaseAdapter } from '../../src/db/adapter.js';
import { MigrationRunner } from '../../src/db/migrations/runner.js';
import { ApiKeyService } from '../../src/security/api_keys.js';

describe('V6 Phase 5: Event Ingestion Idempotency & Deduplication', () => {
  let server: http.Server;
  let serverPort: number;
  let validApiKey: string;

  before(async () => {
    const db = DatabaseAdapter.getInstance();
    await MigrationRunner.migrateUp(db);

    await db.execute(
      `INSERT INTO tenants (id, name, slug, environment, status, created_at)
       VALUES ('tenant_idemp_test', 'Idempotency Test Tenant', 'idemp-test', 'test', 'ACTIVE', datetime('now'))
       ON CONFLICT(id) DO NOTHING;`
    );

    const keyRecord = await ApiKeyService.createApiKey({
      tenantId: 'tenant_idemp_test',
      name: 'Idempotency Key',
      environment: 'test',
      scopes: ['events:write'],
    });
    validApiKey = keyRecord.rawKey;

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

  it('idempotently deduplicates repeated event transmissions with same event_id and payment_id', async () => {
    const eventId = `evt_dedup_${Date.now()}`;
    const paymentId = `pay_dedup_${Date.now()}`;

    const payload = {
      event_id: eventId,
      source: 'ODOOX_EVENT',
      provider: 'razorpay',
      environment: 'test',
      payment_id: paymentId,
      amount_paise: 350000,
      currency: 'INR',
      status: 'failed',
      failure_code: 'bad_request_payment_insufficient_funds',
      customer_reference: 'cust_bob@example.com',
    };

    // 1. First submission -> 201 Created
    const res1 = await fetch(`http://127.0.0.1:${serverPort}/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validApiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const body1: any = await res1.json();
    assert.equal(res1.status, 201);
    assert.equal(body1.received, true);
    assert.equal(body1.opportunity_id, paymentId);

    // 2. Duplicate submission -> 200 OK with deduplicated: true
    const res2 = await fetch(`http://127.0.0.1:${serverPort}/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validApiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const body2: any = await res2.json();
    assert.equal(res2.status, 200);
    assert.equal(body2.received, true);
    assert.equal(body2.deduplicated, true);
    assert.equal(body2.opportunity_id, paymentId);

    // 3. Database verification: exactly one opportunity row exists
    const db = DatabaseAdapter.getInstance();
    const rows = await db.query(
      `SELECT count(*) as count FROM recovery_opportunities WHERE id = ?;`,
      [paymentId]
    );
    assert.equal(rows[0].count, 1, 'Must have exactly 1 opportunity row in database');
  });
});
