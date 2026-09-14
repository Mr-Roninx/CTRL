import Razorpay from 'razorpay';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const key_id = process.env.RAZORPAY_KEY_ID;
const key_secret = process.env.RAZORPAY_KEY_SECRET;
const webhook_secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'rzp_whsec_ctrl_test';
const PORT = process.env.PORT || 3001;

async function runRealSpike() {
  console.log('⚡ Running Real Razorpay Test Mode Spike...');
  console.log(`🔑 Using Key ID: ${key_id ? key_id.slice(0, 12) + '...' : 'MISSING'}`);

  if (!key_id || !key_secret) {
    throw new Error('Razorpay API keys missing from .env');
  }

  const rzp = new Razorpay({
    key_id,
    key_secret,
  });

  // Step 1: Create a real test-mode order via Razorpay API
  console.log('📦 Creating real test-mode order in Razorpay API...');
  const orderAmountPaise = 249900; // ₹2,499.00
  const receipt = `rcpt_${Date.now()}`;

  const order = await rzp.orders.create({
    amount: orderAmountPaise,
    currency: 'INR',
    receipt,
    notes: {
      source: 'ctrl_event_fabric_spike',
      channel: 'test_mode',
    },
  });

  console.log(`✅ Real Razorpay Order created: ${order.id}, Status: ${order.status}, Amount: ₹${orderAmountPaise / 100}`);

  // Step 2: Construct a realistic failed payment webhook referencing the real order
  const realPaymentId = `pay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const webhookPayload = {
    entity: 'event',
    account_id: 'acc_ctrl_live_spike',
    event: 'payment.failed',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: realPaymentId,
          entity: 'payment',
          amount: orderAmountPaise,
          currency: 'INR',
          status: 'failed',
          order_id: order.id,
          invoice_id: null,
          international: false,
          method: 'card',
          amount_refunded: 0,
          refund_status: null,
          captured: false,
          description: `Spike test payment for ${receipt}`,
          card_id: 'card_spike_test_01',
          bank: null,
          wallet: null,
          vpa: null,
          email: 'test_shopper@example.com',
          contact: '+919988776655',
          customer_id: 'cust_spike_real_01',
          notes: {
            source: 'ctrl_spike',
            order_id: order.id,
          },
          fee: null,
          tax: null,
          error_code: 'BAD_REQUEST_PAYMENT_CARD_INSUFFICIENT_FUNDS',
          error_description: 'Payment failed due to insufficient funds in the account.',
          error_source: 'customer',
          error_step: 'payment_authorization',
          error_reason: 'insufficient_funds',
          attempts: 1,
          created_at: Math.floor(Date.now() / 1000),
        },
      },
    },
    created_at: Math.floor(Date.now() / 1000),
  };

  const payloadString = JSON.stringify(webhookPayload);
  const signature = crypto
    .createHmac('sha256', webhook_secret)
    .update(payloadString)
    .digest('hex');

  // Step 3: Send the webhook to the CTRL Event Fabric simulation endpoint
  console.log('📡 Dispatching webhook to POST http://localhost:' + PORT + '/internal/simulate-webhook...');
  const res = await fetch(`http://localhost:${PORT}/internal/simulate-webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': signature,
    },
    body: payloadString,
  });

  const body = await res.json();
  console.log(`Status: ${res.status}, Response:`, body);

  if (res.status === 200 && body.received && body.opportunity_id === realPaymentId) {
    console.log(`\n🎉 Spike Success! Real Razorpay Order [${order.id}] and Failed Payment [${realPaymentId}] successfully ingested into CTRL.`);
  } else {
    console.error('❌ Spike Failed to land webhook in CTRL:', body);
    process.exit(1);
  }
}

runRealSpike().catch((err) => {
  console.error('Spike error:', err);
  process.exit(1);
});
