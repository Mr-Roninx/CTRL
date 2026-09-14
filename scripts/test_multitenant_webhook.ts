import axios from 'axios';
import crypto from 'node:crypto';

async function generateSimulatedWebhookPayload(tenantId: string, paymentId: string, secret: string) {
  const payload = {
    entity: 'event',
    event: 'payment.failed',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: paymentId,
          entity: 'payment',
          amount: 5000,
          currency: 'INR',
          status: 'failed',
          error_code: 'BAD_REQUEST_ERROR',
          error_description: 'Payment failed due to an unknown error',
          error_source: 'customer',
          error_step: 'payment_authentication',
          error_reason: 'payment_authentication_failed',
          bank: 'HDFC',
          method: 'card',
          email: 'test@example.com',
          contact: '+919999999999',
          created_at: Math.floor(Date.now() / 1000)
        }
      }
    },
    created_at: Math.floor(Date.now() / 1000)
  };

  const rawBody = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  return { payload, rawBody, signature };
}

async function testWebhookRouting() {
  console.log('Testing Multi-Tenant Webhook Routing...');

  // 1. Simulate webhook for Tenant A
  const tenantA = 'tenant_system_default';
  const secretA = 'rzp_whsec_ctrl_test'; 
  const paymentIdA = `pay_sim_${Date.now()}_A`;
  
  console.log(`\nSending webhook for ${tenantA}...`);
  const webhookA = await generateSimulatedWebhookPayload(tenantA, paymentIdA, secretA);
  
  try {
    const resA = await axios.post(`http://localhost:3001/internal/simulate-webhook/${tenantA}`, webhookA.payload, {
      headers: {
        'x-razorpay-signature': webhookA.signature,
        'Content-Type': 'application/json'
      }
    });
    console.log(`Tenant A Webhook Response:`, resA.data);
  } catch (err: any) {
    console.error(`Tenant A Webhook Error:`, err.response?.data || err.message);
  }

  // 2. Simulate webhook for Tenant B (assuming they share the default secret for testing, or we expect a 400 if missing secret)
  const tenantB = 'tenant_demo_2';
  const paymentIdB = `pay_sim_${Date.now()}_B`;
  
  console.log(`\nSending webhook for ${tenantB}...`);
  const webhookB = await generateSimulatedWebhookPayload(tenantB, paymentIdB, secretA);
  
  try {
    const resB = await axios.post(`http://localhost:3001/internal/simulate-webhook/${tenantB}`, webhookB.payload, {
      headers: {
        'x-razorpay-signature': webhookB.signature,
        'Content-Type': 'application/json'
      }
    });
    console.log(`Tenant B Webhook Response:`, resB.data);
  } catch (err: any) {
    console.error(`Tenant B Webhook Error (Expected if no credentials set):`, err.response?.data || err.message);
  }
}

testWebhookRouting().catch(console.error);
