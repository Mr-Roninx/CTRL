async function testOtpFlow() {
  const baseUrl = 'http://127.0.0.1:3001';

  try {
    const testEmail = `merchant_otp_${Date.now()}@example.com`;
    console.log(`\n1. Testing /v1/auth/send-otp for ${testEmail}...`);
    const sendRes = await fetch(`${baseUrl}/v1/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail }),
    });

    const sendData = await sendRes.json();
    console.log('Send OTP Status:', sendRes.status, 'Response:', sendData);
    if (!sendData.success || !sendData.dev_otp) {
      throw new Error(`Failed to send OTP: ${JSON.stringify(sendData)}`);
    }

    const otpCode = sendData.dev_otp;
    console.log(`✅ Generated OTP Code: ${otpCode}`);

    console.log('\n2. Testing invalid OTP rejection...');
    const invalidRes = await fetch(`${baseUrl}/v1/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, otp: '000000' }),
    });
    console.log('Invalid OTP Status (expected 401):', invalidRes.status);
    if (invalidRes.status !== 401) {
      throw new Error('Invalid OTP did not return 401');
    }

    console.log('\n3. Testing valid OTP verification & auto-provisioning...');
    const verifyRes = await fetch(`${baseUrl}/v1/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, otp: otpCode }),
    });

    const verifyData = await verifyRes.json();
    console.log('Verify Status:', verifyRes.status, 'Success:', verifyData.success);
    if (!verifyData.session?.token) {
      throw new Error(`Verify failed: ${JSON.stringify(verifyData)}`);
    }

    const token = verifyData.session.token;
    console.log('✅ Session Token Received:', token.slice(0, 25) + '...');
    console.log('✅ Auto-provisioned Tenant:', verifyData.tenant?.name, 'ID:', verifyData.tenant?.id);

    console.log('\n4. Testing /dashboard/summary access with new session token...');
    const dashRes = await fetch(`${baseUrl}/dashboard/summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    console.log('Dashboard summary status (expected 200):', dashRes.status);
    if (dashRes.status !== 200) {
      const err = await dashRes.text();
      throw new Error(`Dashboard access rejected: HTTP ${dashRes.status}: ${err}`);
    }

    console.log('✅ Dashboard summary accessible with Owner privileges!');

    console.log('\n5. Testing Master Bypass OTP (123456)...');
    const bypassRes = await fetch(`${baseUrl}/v1/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@ctrl.app', otp: '123456' }),
    });
    const bypassData = await bypassRes.json();
    console.log('Master Bypass Status:', bypassRes.status, 'Success:', bypassData.success);
    if (!bypassData.session?.token) {
      throw new Error('Master bypass 123456 failed');
    }

    console.log('\n🎉 ALL OTP AUTHENTICATION & ONBOARDING CHECKS PASSED PERFECTLY!\n');
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }
}

testOtpFlow();
