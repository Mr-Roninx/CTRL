import { app } from '../src/server.js';
import crypto from 'node:crypto';
import { Server } from 'node:http';

async function testWebhook() {
  console.log('🚀 Testing Razorpay Webhook Ingestion & HMAC Verification...');

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(3098, () => {
      console.log('📡 Webhook Test Server listening on http://127.0.0.1:3098');
      resolve(s);
    });
  });

  const API_BASE = 'http://127.0.0.1:3098';

  try {
    // 1. Signup merchant
    const testEmail = `webhook_merchant_${Date.now()}@example.com`;
    const signupRes = await fetch(`${API_BASE}/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        business_name: 'Webhook Merchant Store',
        password: 'Password123!',
      }),
    });
    const signupData = (await signupRes.json()) as any;
    const sessionToken = signupData.session.token;
    const tenantId = signupData.merchant.tenant_id;

    // 2. Connect Razorpay with custom webhook secret
    const webhookSecret = 'rzp_whsec_super_secret_test_2026';
    const connectRes = await fetch(`${API_BASE}/v1/integrations/razorpay/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        key_id: 'rzp_test_sample123',
        key_secret: 'sample_secret_key',
        webhook_secret: webhookSecret,
        environment: 'test',
      }),
    });
    console.log(`✅ Razorpay Connected for tenant: ${tenantId}`);

    // 3. Craft Razorpay payment.failed payload
    const paymentId = `pay_wh_${Date.now()}`;
    const payload = {
      entity: 'event',
      account_id: 'acc_sample_rzp',
      event: 'payment.failed',
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: paymentId,
            entity: 'payment',
            amount: 750000, // ₹7,500.00
            currency: 'INR',
            status: 'failed',
            order_id: `order_wh_${Date.now()}`,
            error_code: 'BAD_REQUEST_PAYMENT_FAILED',
            error_description: 'Payment failed due to insufficient balance in account',
            error_source: 'bank',
            error_step: 'payment_authorization',
            customer_id: 'cust_webhook_user_01',
            email: 'customer01@example.com',
            contact: '+919876543210',
            attempts: 1,
            created_at: Math.floor(Date.now() / 1000),
          },
        },
      },
      created_at: Math.floor(Date.now() / 1000),
    };

    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

    // 4. Send webhook to /internal/simulate-webhook/:tenant_id
    console.log(`📡 Dispatching simulation webhook to /internal/simulate-webhook/${tenantId}...`);
    const whRes = await fetch(`${API_BASE}/internal/simulate-webhook/${tenantId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signature,
        'x-razorpay-event-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-forwarded-for': '198.51.100.45', // non-whitelisted public proxy IP to test relaxed IP check
      },
      body: rawBody,
    });

    if (!whRes.ok) {
      throw new Error(`Webhook failed: ${whRes.status} ${await whRes.text()}`);
    }

    const whData = (await whRes.json()) as any;
    console.log(`✅ Webhook processed successfully: Opportunity ID=${whData.opportunity_id}, Decline Type=${whData.decline_type}`);

    // 5. Query Opportunities for the Merchant Dashboard
    const oppsRes = await fetch(`${API_BASE}/opportunities`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const oppsData = (await oppsRes.json()) as any;
    const matched = oppsData.opportunities.find((o: any) => o.id === paymentId);

    if (!matched) {
      throw new Error(`❌ Webhook payment ${paymentId} was NOT found in merchant opportunities!`);
    }

    console.log(`🎉 SUCCESS! Webhook Opportunity visible in merchant dashboard: ID=${matched.id}, Amount=₹${matched.amount_paise / 100}, Source=${matched.source}`);
  } finally {
    server.close();
  }
}

testWebhook().catch((err) => {
  console.error('\n❌ WEBHOOK TEST FAILED:', err.message);
  process.exit(1);
});
