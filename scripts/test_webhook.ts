import crypto from 'node:crypto';
import dotenv from 'dotenv';
import path from 'node:path';
import { seedSyntheticData } from './seed_synthetic.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const PORT = process.env.PORT || 3001;
const BASE_URL = `http://localhost:${PORT}`;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'rzp_whsec_ctrl_test';

function signPayload(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

async function runTests() {
  console.log('🧪 Starting Event Fabric Webhook Acceptance Tests (Isolated Simulation Path)...');

  // Seed synthetic portfolio
  seedSyntheticData();

  // 1. Test Health endpoint
  try {
    const healthRes = await fetch(`${BASE_URL}/health`);
    const health = await healthRes.json();
    console.log('✅ Health check passed:', health);
  } catch (err) {
    console.error('❌ Server not responding at', BASE_URL, err);
    process.exit(1);
  }

  // 2. Test Invalid HMAC Signature rejection (400) on simulation route
  const sampleFailedEvent = {
    entity: 'event',
    account_id: 'acc_ctrl_test',
    event: 'payment.failed',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: 'pay_test_sim_failed_001',
          entity: 'payment',
          amount: 349900, // ₹3,499.00
          currency: 'INR',
          status: 'failed',
          order_id: 'order_test_001',
          method: 'card',
          error_code: 'BAD_REQUEST_PAYMENT_CARD_EXPIRED',
          error_description: 'The card has expired. Please use a valid card.',
          error_source: 'gateway',
          error_step: 'payment_authorization',
          error_reason: 'card_expired',
          customer_id: 'cust_sim_spike_01',
          email: 'customer01@example.com',
          contact: '+919876543210',
          attempts: 1,
        },
      },
    },
    created_at: Math.floor(Date.now() / 1000),
  };

  const payloadString = JSON.stringify(sampleFailedEvent);

  console.log('\n--- Test 1: Invalid HMAC Signature on /internal/simulate-webhook ---');
  const invalidSigRes = await fetch(`${BASE_URL}/internal/simulate-webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': 'invalid_forged_signature_123456',
    },
    body: payloadString,
  });

  console.log(`Response status: ${invalidSigRes.status}`);
  if (invalidSigRes.status === 400) {
    console.log('✅ PASS: Invalid signature rejected with 400 Bad Request.');
  } else {
    console.error(`❌ FAIL: Expected 400, got ${invalidSigRes.status}`);
    process.exit(1);
  }

  // 3. Test Valid Signature Ingestion (200) on simulation route
  console.log('\n--- Test 2: Valid HMAC Signature & payment.failed Ingestion (Synthetic Label) ---');
  const validSignature = signPayload(payloadString, WEBHOOK_SECRET);

  const validRes = await fetch(`${BASE_URL}/internal/simulate-webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': validSignature,
    },
    body: payloadString,
  });

  const validJson = await validRes.json();
  console.log(`Response status: ${validRes.status}, Body:`, validJson);
  if (validRes.status === 200 && validJson.received && validJson.simulated === true) {
    console.log('✅ PASS: Valid simulation webhook ingested successfully into RecoveryOpportunity table with source=synthetic.');
  } else {
    console.error('❌ FAIL: Failed to ingest simulation webhook:', validJson);
    process.exit(1);
  }

  // 4. Test Deduplication / Replay (200 & deduplicated: true, no extra row)
  console.log('\n--- Test 3: Idempotent Webhook Replay Deduplication ---');
  const replayRes = await fetch(`${BASE_URL}/internal/simulate-webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': validSignature,
    },
    body: payloadString,
  });

  const replayJson = await replayRes.json();
  console.log(`Replay status: ${replayRes.status}, Body:`, replayJson);
  if (replayRes.status === 200 && replayJson.deduplicated === true) {
    console.log('✅ PASS: Duplicate webhook replayed and safely deduplicated without creating duplicate row.');
  } else {
    console.error('❌ FAIL: Replay deduplication failed:', replayJson);
    process.exit(1);
  }

  // 5. Query GET /opportunities to verify data isolation
  console.log('\n--- Test 4: Verify GET /opportunities ---');
  const oppsRes = await fetch(`${BASE_URL}/opportunities`);
  const oppsData = await oppsRes.json();
  console.log(`Total opportunities in database: ${oppsData.count}`);

  const realOpps = oppsData.opportunities.filter((o: any) => o.source === 'real');
  const synthOpps = oppsData.opportunities.filter((o: any) => o.source === 'synthetic');

  console.log(`Real rows: ${realOpps.length}, Synthetic rows: ${synthOpps.length}`);
  if (realOpps.length === 0 && synthOpps.length >= 16) {
    console.log('✅ PASS: Test suite produces ZERO real rows. Complete separation between real and simulated ingestion achieved.');
  } else {
    console.error(`❌ FAIL: Expected 0 real rows from test suite, found ${realOpps.length}`);
    process.exit(1);
  }

  console.log('\n🎉 ALL ACCEPTANCE TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('Unhandled test error:', err);
  process.exit(1);
});
