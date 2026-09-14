import dotenv from 'dotenv';
import path from 'node:path';
import { rzpClient } from '../src/execution/executor.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function testPaymentJson() {
  const plinkId = 'plink_TWMLNbZbfzFp7C';
  const pageRes = await fetch('https://rzp.io/rzp/rGGhYnto');
  const html = await pageRes.text();
  const match = html.match(/var data = (\{.+?\});/s);
  if (!match) throw new Error('No config found');
  const data = JSON.parse(match[1]);

  const rawOrderId = data.payment_link?.order_id;
  const fullOrderId = rawOrderId.startsWith('order_') ? rawOrderId : `order_${rawOrderId}`;

  console.log('Testing createPaymentJson for order:', fullOrderId);

  try {
    const payRes = await (rzpClient.payments as any).createPaymentJson({
      amount: data.payment_link?.amount,
      currency: 'INR',
      order_id: fullOrderId,
      email: 'ananya@example.com',
      contact: '+919876543210',
      method: 'upi',
      vpa: 'success@razorpay',
    });

    console.log('createPaymentJson result:', payRes);
  } catch (err: any) {
    console.error('createPaymentJson error:', err);
  }

  // Check link status
  const checkPlink: any = await rzpClient.paymentLink.fetch(plinkId);
  console.log('\nFinal Razorpay link status:', {
    id: checkPlink.id,
    status: checkPlink.status,
    amount_paid: checkPlink.amount_paid,
  });
}

testPaymentJson().catch(console.error);
