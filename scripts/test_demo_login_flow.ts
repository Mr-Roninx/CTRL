import { app } from '../src/server.js';
import http from 'node:http';

async function testDemoLogin() {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  try {
    console.log('Testing /v1/auth/login with demo credentials...');
    const loginRes = await fetch(`${baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@ctrl.app', password: 'Ctrl@2026' }),
    });

    const loginData = await loginRes.json();
    console.log('Login Status:', loginRes.status, 'Success:', loginData.success);
    if (!loginData.session?.token) {
      throw new Error(`Login failed: ${JSON.stringify(loginData)}`);
    }

    const token = loginData.session.token;
    console.log('✅ Received session token:', token.slice(0, 20) + '...');

    // Test /dashboard/summary with this token
    console.log('Testing /dashboard/summary with authenticated token...');
    const dashRes = await fetch(`${baseUrl}/dashboard/summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    console.log('Dashboard summary status:', dashRes.status);
    if (dashRes.status !== 200) {
      const errText = await dashRes.text();
      throw new Error(`Dashboard request failed: HTTP ${dashRes.status}: ${errText}`);
    }

    const dashData = await dashRes.json();
    console.log('✅ Dashboard summary loaded successfully! Opportunities count:', dashData.opportunities?.length);

    // Test /v1/auth/demo-login
    console.log('Testing 1-click /v1/auth/demo-login...');
    const demoRes = await fetch(`${baseUrl}/v1/auth/demo-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const demoData = await demoRes.json();
    console.log('Demo Login Status:', demoRes.status, 'Success:', demoData.success);
    if (!demoData.session?.token) {
      throw new Error(`Demo login failed: ${JSON.stringify(demoData)}`);
    }

    console.log('🎉 ALL LOGIN & DASHBOARD ACCESS CHECKS PASSED!');
  } finally {
    server.close();
    process.exit(0);
  }
}

testDemoLogin().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
