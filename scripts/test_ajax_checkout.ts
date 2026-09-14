import { rzpClient } from '../src/execution/executor.js';

async function testAjaxCheckout() {
  const pageRes = await fetch('https://rzp.io/rzp/rGGhYnto');
  const html = await pageRes.text();
  const match = html.match(/var data = (\{.+?\});/s);
  if (!match) throw new Error('No config found');
  const data = JSON.parse(match[1]);

  const rawOrderId = data.payment_link?.order_id;
  const fullOrderId = rawOrderId.startsWith('order_') ? rawOrderId : `order_${rawOrderId}`;
  const keylessHeader = data.keyless_header;
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  console.log('Using Full Order ID:', fullOrderId);

  // Payload for Razorpay AJAX payment creation
  const payload = {
    key_id,
    order_id: fullOrderId,
    payment_link_id: data.payment_link?.id,
    amount: data.payment_link?.amount,
    currency: 'INR',
    method: 'upi',
    vpa: 'success@razorpay',
    email: 'ananya@example.com',
    contact: '+919876543210',
    '_': keylessHeader,
    '_v': '1.0.0',
    'library': 'checkoutjs',
  };

  const res = await fetch('https://api.razorpay.com/v1/payments/create/ajax', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Razorpay-Keyless': keylessHeader || '',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Referer': 'https://rzp.io/rzp/rGGhYnto',
    },
    body: new URLSearchParams(payload as any).toString(),
  });

  console.log('Status:', res.status);
  const json = await res.json();
  console.log('Response JSON:', JSON.stringify(json, null, 2));

  // Also check if payment ID returned needs capture/otp confirmation in test mode
  if (json?.razorpay_payment_id) {
    console.log('Received payment ID:', json.razorpay_payment_id);
    // In test mode, UPI payment is auto-completed or callback endpoint is called
    const payCheck = await rzpClient.payments.fetch(json.razorpay_payment_id);
    console.log('Payment status:', payCheck.status, 'Captured:', payCheck.captured);
  }

  // Check link status on Razorpay API
  const checkPlink: any = await rzpClient.paymentLink.fetch('plink_TWMLNbZbfzFp7C');
  console.log('\nFinal Razorpay link status from API:', {
    id: checkPlink.id,
    status: checkPlink.status,
    amount_paid: checkPlink.amount_paid,
    payments: checkPlink.payments,
  });
}

testAjaxCheckout().catch(console.error);
