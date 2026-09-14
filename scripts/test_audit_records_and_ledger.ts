import { app } from '../src/server.js';
import { initDatabase, db, insertOpportunity, insertLedgerEntry } from '../src/db/database.js';
import { ApiKeyService } from '../src/security/api_keys.js';
import { normalizeOpportunity } from '../src/perception/normalizer.js';
import http from 'node:http';

async function testAuditAndLedgerEndpoint() {
  console.log('🧪 Starting Audit Records & Financial Ledger Test Suite...\n');

  initDatabase();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  try {
    const testTenantId = `tnt_audit_test_${Date.now()}`;
    const oppId = `pay_audit_${Date.now()}`;

    // 1. Create tenant and API key
    const insertTenant = db.prepare(`
      INSERT INTO tenants (id, name, slug, environment, status, created_at)
      VALUES (?, ?, ?, 'test', 'ACTIVE', ?)
    `);
    insertTenant.run(testTenantId, 'Audit Store', `audit-store-${Date.now()}`, new Date().toISOString());

    const keyResult = await ApiKeyService.createApiKey({
      tenantId: testTenantId,
      name: 'Audit Test Key',
      environment: 'test',
      scopes: ['events:read', 'events:write'],
    });
    const apiKey = keyResult.rawKey;

    // 2. Create opportunity and ledger entries
    const opp = normalizeOpportunity(
      {
        id: oppId,
        amount: 85000, // ₹850
        currency: 'INR',
        error_code: 'INSUFFICIENT_FUNDS',
        customer_id: 'audit_customer@example.com',
      },
      `evt_audit_${Date.now()}`,
      { source: 'synthetic', tenantId: testTenantId }
    );
    insertOpportunity(opp);

    // Insert 2 ledger entries for this opportunity
    insertLedgerEntry({
      id: `led_rec_test_${Date.now()}_1`,
      opportunity_id: oppId,
      event_type: 'webhook_received',
      amount_paise: 85000,
      timestamp: new Date().toISOString(),
      raw_payload_ref: JSON.stringify({ step: 'ingestion' }),
    });

    insertLedgerEntry({
      id: `led_rec_test_${Date.now()}_2`,
      opportunity_id: oppId,
      event_type: 'recovered',
      amount_paise: 85000,
      timestamp: new Date().toISOString(),
      raw_payload_ref: JSON.stringify({ step: 'settlement', payment_id: 'pay_rzp_mock' }),
    });

    // 3. Query GET /audit/records
    const res = await fetch(`${baseUrl}/audit/records`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const data = await res.json();
    console.log(`Response status: ${res.status}, records count: ${data.records?.length}, ledger count: ${data.ledger?.length}`);

    if (res.status !== 200 || !Array.isArray(data.ledger) || data.ledger.length < 2) {
      throw new Error(`Expected at least 2 ledger entries, got: ${JSON.stringify(data)}`);
    }

    const recoveredEntry = data.ledger.find((l: any) => l.event_type === 'recovered');
    if (!recoveredEntry || recoveredEntry.amount_paise !== 85000) {
      throw new Error('Ledger entry data mismatch');
    }

    console.log(`✅ Test 1 Passed: Successfully fetched ${data.ledger.length} immutable ledger entries`);
    console.log(`✅ Test 2 Passed: Recovered entry verified with amount ₹${(recoveredEntry.amount_paise / 100).toFixed(2)}`);

    console.log('\n🎉 ALL AUDIT & FINANCIAL LEDGER TESTS PASSED CLEANLY!');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

testAuditAndLedgerEndpoint().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
