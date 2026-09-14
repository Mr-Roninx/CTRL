import { CanonicalPaymentEventSchema, WebAppPingSchema } from '../src/security/schemas.js';
import { upsertWebAppConnection, getWebAppConnections, insertOpportunity, getAllOpportunities, initDatabase } from '../src/db/database.js';
import { normalizeOpportunity } from '../src/perception/normalizer.js';

async function runTests() {
  console.log('🧪 Starting Web App Integration & Fix Verification Suite...\n');

  initDatabase();

  // Test 1: CanonicalPaymentEventSchema on realistic browser payload with nulls
  console.log('Test 1: Validating CanonicalPaymentEventSchema with null/empty fields from client SDK...');
  const clientPayloadWithNulls = {
    event_id: `evt_test_${Date.now()}`,
    tenant_id: 'tenant_test_123',
    source: 'CLIENT_SDK',
    provider: 'razorpay',
    environment: 'test',
    payment_id: `pay_test_${Date.now()}`,
    order_id: null,
    amount_paise: 50000,
    currency: 'INR',
    status: 'failed',
    failure_code: 'BAD_REQUEST_PAYMENT_FAILED',
    failure_description: 'Payment was declined by bank',
    customer_reference: 'cust_anonymous',
    customer_email: null,
    customer_phone: null,
    occurred_at: new Date().toISOString(),
    metadata: { url: 'http://localhost:3000/checkout', title: 'Test Store' },
  };

  const parseResult = CanonicalPaymentEventSchema.safeParse(clientPayloadWithNulls);
  if (!parseResult.success) {
    console.error('❌ Test 1 FAILED: Schema rejected payload:', parseResult.error.errors);
    process.exit(1);
  }
  console.log('✅ Test 1 PASSED: CanonicalPaymentEventSchema accepted payload with nulls successfully.\n');

  // Test 2: WebAppPingSchema and Connection Registration
  console.log('Test 2: Testing Web App Connection Handshake & Registry...');
  const pingData = {
    app_origin: 'http://localhost:3000',
    app_url: 'http://localhost:3000/checkout',
    app_name: 'Acme Test Storefront',
    sdk_version: '6.1.0',
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    timestamp: new Date().toISOString(),
  };

  const pingParse = WebAppPingSchema.safeParse(pingData);
  if (!pingParse.success) {
    console.error('❌ Test 2 FAILED: Ping schema parse error:', pingParse.error.errors);
    process.exit(1);
  }

  const registered = upsertWebAppConnection({
    tenant_id: 'tenant_test_123',
    app_origin: pingData.app_origin,
    app_url: pingData.app_url,
    app_name: pingData.app_name,
    sdk_version: pingData.sdk_version,
  });

  if (!registered || registered.status !== 'ONLINE') {
    console.error('❌ Test 2 FAILED: Connection record not ONLINE:', registered);
    process.exit(1);
  }

  const connections = getWebAppConnections('tenant_test_123');
  const matched = connections.find((c) => c.app_origin === 'http://localhost:3000');
  if (!matched || matched.status !== 'ONLINE') {
    console.error('❌ Test 2 FAILED: getWebAppConnections did not return ONLINE connection:', connections);
    process.exit(1);
  }
  console.log(`✅ Test 2 PASSED: Web app connection registered: ${matched.app_origin} (${matched.status}).\n`);

  // Test 3: Normalizing and Ingesting Opportunity from Client Event
  console.log('Test 3: Normalizing opportunity and querying via tenant_id...');
  const opp = normalizeOpportunity(
    {
      id: parseResult.data.payment_id!,
      amount: parseResult.data.amount_paise,
      currency: parseResult.data.currency,
      error_code: parseResult.data.failure_code || 'UNKNOWN_ERROR',
      error_description: parseResult.data.failure_description || 'Payment failed',
      customer_id: parseResult.data.customer_reference,
      email: parseResult.data.customer_email || undefined,
      contact: parseResult.data.customer_phone || undefined,
    },
    parseResult.data.event_id,
    { source: 'synthetic', tenantId: 'tenant_test_123' }
  );

  insertOpportunity(opp);

  const tenantOpps = getAllOpportunities('tenant_test_123');
  const found = tenantOpps.find((o) => o.id === opp.id);
  if (!found) {
    console.error('❌ Test 3 FAILED: Opportunity not found for tenant_test_123:', tenantOpps);
    process.exit(1);
  }
  console.log(`✅ Test 3 PASSED: Opportunity ${found.id} (₹${found.amount_paise / 100}) successfully retrieved for tenant.\n`);

  console.log('🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((e) => {
  console.error('Fatal error running tests:', e);
  process.exit(1);
});
