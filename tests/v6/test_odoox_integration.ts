process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../../src/server.js';
import { DatabaseAdapter } from '../../src/db/adapter.js';
import { MigrationRunner } from '../../src/db/migrations/runner.js';
import { ApiKeyService } from '../../src/security/api_keys.js';
import { OdooXEventEmitter } from '../../src/connectors/odoox/odoox_event_emitter.ts';

describe('V6 Phase 5: OdooX Connector Client & Downtime Resilience', () => {
  let server: http.Server;
  let serverPort: number;
  let validApiKey: string;

  before(async () => {
    const db = DatabaseAdapter.getInstance();
    await MigrationRunner.migrateUp(db);

    await db.execute(
      `INSERT INTO tenants (id, name, slug, environment, status, created_at)
       VALUES ('tenant_odoox_client', 'OdooX Merchant', 'odoox-client', 'test', 'ACTIVE', datetime('now'))
       ON CONFLICT(id) DO NOTHING;`
    );

    const keyRecord = await ApiKeyService.createApiKey({
      tenantId: 'tenant_odoox_client',
      name: 'OdooX Client Key',
      environment: 'test',
      scopes: ['events:write', 'events:read'],
    });
    validApiKey = keyRecord.rawKey;

    // Start ephemeral express server for connector test
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

  it('OdooX connector successfully dispatches failed payment events to live CTRL endpoint', async () => {
    const emitter = new OdooXEventEmitter({
      ctrlBaseUrl: `http://127.0.0.1:${serverPort}`,
      apiKey: validApiKey,
    });

    const eventId = `evt_client_${Date.now()}`;
    const paymentId = `pay_client_${Date.now()}`;

    const result = await emitter.emitPaymentEvent({
      event_id: eventId,
      source: 'ODOOX_EVENT',
      provider: 'razorpay',
      environment: 'test',
      payment_id: paymentId,
      order_id: 'order_client_999',
      amount_paise: 750000,
      currency: 'INR',
      status: 'failed',
      failure_code: 'bad_request_payment_declined_by_bank',
      customer_reference: 'cust_charlie@example.com',
    });

    assert.equal(result.success, true);
    assert.equal(result.delivered, true);
    assert.equal(result.opportunityId, paymentId);
  });

  it('INVARIANT VERIFIED: OdooX payment flow is unaffected by CTRL downtime (non-blocking fail-safe)', async () => {
    // Point connector to unreachable offline port (simulating CTRL downtime)
    const deadPort = 59123;
    const offlineEmitter = new OdooXEventEmitter({
      ctrlBaseUrl: `http://127.0.0.1:${deadPort}`,
      apiKey: validApiKey,
      timeoutMs: 500, // Fast timeout
    });

    // Simulate merchant checkout flow executing during CTRL outage
    let checkoutCompletedSuccessfully = false;

    // Merchant checkout wraps payment dispatch in standard flow
    try {
      // 1. Merchant processes payment attempt (fails at bank)
      const merchantOrderState = {
        orderId: 'order_offline_sim_1001',
        paymentStatus: 'FAILED',
        items: ['Product A', 'Product B'],
      };

      // 2. Connector dispatches failure event to offline CTRL
      const emissionResult = await offlineEmitter.emitPaymentEvent({
        event_id: `evt_offline_${Date.now()}`,
        source: 'ODOOX_EVENT',
        provider: 'razorpay',
        environment: 'test',
        payment_id: `pay_offline_${Date.now()}`,
        order_id: merchantOrderState.orderId,
        amount_paise: 990000,
        currency: 'INR',
        status: 'failed',
        failure_code: 'bank_gateway_timeout',
        customer_reference: 'cust_david@example.com',
      });

      // Assert that connector cleanly reported delivery failure without throwing
      assert.equal(emissionResult.delivered, false, 'Should report delivery failed');
      assert.equal(emissionResult.success, false, 'Should report success false');

      // 3. Merchant ordinary flow continues uninterrupted!
      checkoutCompletedSuccessfully = true;
    } catch (unexpectedError) {
      assert.fail(`OdooX checkout crashed due to CTRL downtime: ${unexpectedError}`);
    }

    assert.equal(
      checkoutCompletedSuccessfully,
      true,
      'Merchant ordinary checkout flow MUST complete uninterrupted even when CTRL is offline'
    );
  });
});
