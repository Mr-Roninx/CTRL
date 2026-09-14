import { rzpClient } from '../src/execution/executor.js';

async function investigateRazorpayCheckout() {
  // Create a brand new payment link
  const uniqueId = `opp_audit_proof_${Date.now()}`;
  console.log(`Creating fresh payment link for ${uniqueId}...`);
  
  const plink: any = await rzpClient.paymentLink.create({
    amount: 150000, // ₹1,500.00
    currency: 'INR',
    accept_partial: false,
    reference_id: uniqueId,
    description: `CTRL real recovery proof for ${uniqueId}`,
    customer: {
      name: 'Dr. Ananya Iyer',
      email: 'ananya@example.com',
      contact: '+919876543210',
    },
    notes: {
      audit: 'Fix 2 real recovery verification',
      system: 'CTRL Economic Recovery Control Plane',
    },
  });

  console.log('Created link:', {
    id: plink.id,
    order_id: plink.order_id,
    short_url: plink.short_url,
    status: plink.status,
    amount: plink.amount,
  });

  // Fetch hosted page content
  const pageRes = await fetch(plink.short_url);
  const html = await pageRes.text();
  console.log('Fetched hosted checkout page HTML length:', html.length);

  // Extract JSON configuration from HTML
  const match = html.match(/var data = (\{.+?\});/s);
  if (match) {
    const data = JSON.parse(match[1]);
    console.log('Extracted Razorpay checkout config:', {
      is_test_mode: data.is_test_mode,
      order_id: data.payment_link?.order_id,
      plink_id: data.payment_link?.id,
      amount: data.payment_link?.amount,
      keyless_header: data.keyless_header ? data.keyless_header.slice(0, 30) + '...' : null,
    });

    // Let's test paying this test link via Razorpay's checkout API
    const payPayload = {
      keyless_header: data.keyless_header,
      order_id: data.payment_link?.order_id,
      payment_link_id: data.payment_link?.id,
      amount: data.payment_link?.amount,
      currency: 'INR',
      method: 'upi',
      vpa: 'success@razorpay',
      email: 'ananya@example.com',
      contact: '+919876543210',
      '_[flow]': 'payment_link',
    };

    console.log('Attempting payment submission to Razorpay checkout API...');
    try {
      const payRes = await fetch('https://api.razorpay.com/v1/payments/create/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Referer': plink.short_url,
        },
        body: JSON.stringify(payPayload),
      });

      console.log('Checkout API Response Status:', payRes.status);
      const payJson = await payRes.json();
      console.log('Checkout API Response Body:', payJson);
    } catch (e) {
      console.error('Checkout API error:', e);
    }
  }

  // Check link status on Razorpay API directly
  const checkPlink: any = await rzpClient.paymentLink.fetch(plink.id);
  console.log('\nRazorpay API direct fetch result:', {
    id: checkPlink.id,
    status: checkPlink.status,
    amount_paid: checkPlink.amount_paid,
    payments: checkPlink.payments,
  });
}

investigateRazorpayCheckout().catch(console.error);
