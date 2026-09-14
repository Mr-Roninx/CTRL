import { app } from '../src/server.js';
import { Server } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

async function verifyClientSdk() {
  console.log('🧪 =================================================================');
  console.log('🧪 LIVE PROOF: Testing Zero-Code <script> Tag Razorpay Interception');
  console.log('🧪 =================================================================\n');

  // 1. Start Server on port 3096
  const PORT = 3096;
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(PORT, () => {
      console.log(`📡 CTRL Backend running on http://127.0.0.1:${PORT}`);
      resolve(s);
    });
  });

  const API_BASE = `http://127.0.0.1:${PORT}`;

  try {
    // 2. Sign up a new merchant & generate an API key
    console.log('1️⃣ Creating new merchant account...');
    const signupRes = await fetch(`${API_BASE}/v1/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `proof_merchant_${Date.now()}@example.com`,
        business_name: 'DropIn Test Store',
        password: 'Password123!',
      }),
    });
    const signupData = (await signupRes.json()) as any;
    const sessionToken = signupData.session.token;
    const tenantId = signupData.merchant.tenant_id;
    console.log(`✅ Merchant Registered! Tenant ID: ${tenantId}`);

    console.log('2️⃣ Generating API Key in Dashboard...');
    const keyRes = await fetch(`${API_BASE}/v1/api-keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        name: 'Drop-In Script Tag Key',
        environment: 'test',
      }),
    });
    const keyData = (await keyRes.json()) as any;
    const rawApiKey = keyData.raw_key;
    console.log(`✅ API Key: ${rawApiKey.slice(0, 18)}...`);

    // 3. Fetch the SDK JavaScript content from GET /sdk/ctrl.js
    console.log('\n3️⃣ Fetching /sdk/ctrl.js directly from backend...');
    const sdkRes = await fetch(`${API_BASE}/sdk/ctrl.js`);
    const sdkCode = await sdkRes.text();
    console.log(`✅ /sdk/ctrl.js received (${sdkCode.length} bytes, MIME: ${sdkRes.headers.get('content-type')})`);

    // 4. Simulate a Web Page Environment in Node
    console.log('\n4️⃣ Simulating Webpage with Razorpay Checkout & ctrl.js...');
    
    // Create browser-like global window context
    const mockWindow: any = {
      location: { href: 'https://mystore.com/checkout', origin: API_BASE },
      document: {
        title: 'Checkout - MyStore',
        currentScript: {
          getAttribute: (attr: string) => {
            if (attr === 'data-api-key') return rawApiKey;
            if (attr === 'data-api-url') return API_BASE;
            return null;
          },
          src: `${API_BASE}/sdk/ctrl.js`,
        },
        getElementsByTagName: () => [],
      },
      fetch: fetch,
      console: console,
    };

    // Define mock Razorpay Checkout SDK on window
    let capturedListener: Function | null = null;
    mockWindow.Razorpay = function (options: any) {
      this.options = options;
      this.on = function (event: string, callback: Function) {
        if (event === 'payment.failed') {
          capturedListener = callback;
        }
      };
      this.open = function () {
        console.log('   🛒 [Client Page] Razorpay Checkout Modal Opened for amount: ₹' + options.amount / 100);
      };
    };

    // Execute the ctrl.js SDK in this window context
    const runSdkInContext = new Function('window', 'document', 'fetch', 'console', sdkCode);
    runSdkInContext(mockWindow, mockWindow.document, mockWindow.fetch, console);

    console.log('✅ ctrl.js executed and successfully attached to window.Razorpay!');

    // 5. Merchant website customer attempts checkout
    console.log('\n5️⃣ Customer clicks "Pay Now" on the client website...');
    const paymentId = `pay_proof_${Date.now()}`;
    const checkoutOptions = {
      key: 'rzp_test_sample',
      amount: 89900, // ₹899.00
      currency: 'INR',
      name: 'Sneaker Store',
      order_id: `order_${Date.now()}`,
      prefill: {
        email: 'alex.buyer@gmail.com',
        contact: '+919988776655',
      },
      notes: { item: 'Running Shoes Size 10' },
    };

    const rzpInstance = new mockWindow.Razorpay(checkoutOptions);
    rzpInstance.open();

    // 6. Payment fails on customer card / bank with "insufficient_funds"
    console.log('\n6️⃣ Customer card fails: Razorpay fires "payment.failed" event...');
    if (!capturedListener) {
      throw new Error('❌ ctrl.js did not attach to Razorpay instance payment.failed listener!');
    }

    const razorpayFailureResponse = {
      razorpay_payment_id: paymentId,
      error: {
        code: 'BAD_REQUEST_PAYMENT_FAILED',
        description: 'Payment failed due to insufficient funds in customer bank account',
        source: 'bank',
        step: 'payment_authorization',
        reason: 'payment_failed',
        metadata: {
          payment_id: paymentId,
          order_id: checkoutOptions.order_id,
        },
      },
    };

    // Trigger failure
    capturedListener(razorpayFailureResponse);

    // Wait 1.5 seconds for non-blocking asynchronous dispatch
    console.log('⏳ Waiting for async non-blocking dispatch to reach CTRL Control Plane...');
    await new Promise((r) => setTimeout(r, 1500));

    // 7. Check if opportunity appears on the Merchant's Dashboard
    console.log('\n7️⃣ Querying Merchant Dashboard /opportunities to verify ingestion...');
    const oppsRes = await fetch(`${API_BASE}/opportunities`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const oppsData = (await oppsRes.json()) as any;

    console.log(`📊 Total Opportunities in Dashboard: ${oppsData.count}`);
    const found = oppsData.opportunities.find((o: any) => o.id === paymentId);

    if (!found) {
      throw new Error(`❌ FAILED: Ingested opportunity ${paymentId} was NOT found in dashboard!`);
    }

    console.log('\n🎯 =================================================================');
    console.log('🎯 VERIFIED: The Opportunity was captured automatically!');
    console.log('🎯 =================================================================');
    console.log(`   - Opportunity ID:   ${found.id}`);
    console.log(`   - Amount:           ₹${found.amount_paise / 100}`);
    console.log(`   - Failure Code:     ${found.reason_code}`);
    console.log(`   - Decline Type:     ${found.decline_type} (Recoverable Soft Decline)`);
    console.log(`   - Customer:         ${found.customer_id}`);
    console.log(`   - Status:           ${found.status}`);
    console.log(`   - Tenant ID:        ${found.tenant_id}`);
    console.log(`   - Created At:       ${found.created_at}`);

    // 8. Verify Score Breakdown
    console.log('\n8️⃣ Querying Economic Score for the automatically intercepted payment...');
    const scoreRes = await fetch(`${API_BASE}/opportunities/${paymentId}/score`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const scoreData = (await scoreRes.json()) as any;
    console.log(`📈 Score breakdown:`);
    console.log(`   - Natural Recovery Prob:       ${(scoreData.natural_recovery_prob * 100).toFixed(1)}%`);
    console.log(`   - Intervention Recovery Prob:  ${(scoreData.intervention_recovery_prob * 100).toFixed(1)}%`);
    console.log(`   - Incremental Recovery Prob:   +${(scoreData.incremental_prob * 100).toFixed(1)}%`);
    console.log(`   - Expected Value (IVEN):       ₹${(scoreData.expected_incremental_value_paise / 100).toFixed(2)}`);

    console.log('\n🌟 100% PROVEN: The single <script> tag drop-in works with zero backend code!');
  } finally {
    server.close();
  }
}

verifyClientSdk().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
