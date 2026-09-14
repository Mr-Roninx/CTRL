const http = require('http');

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, 'http://localhost:3001');
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Starting End-to-End API Health & Functional Test Suite...\n');
  let failures = 0;

  async function check(name, fn) {
    try {
      const res = await fn();
      if (res) {
        console.log(`✅ [PASS] ${name}`);
      } else {
        console.error(`❌ [FAIL] ${name}`);
        failures++;
      }
    } catch (err) {
      console.error(`❌ [ERROR] ${name}:`, err.message);
      failures++;
    }
  }

  // 1. Health & Root
  await check('GET /health (HTTP 200)', async () => {
    const res = await request('GET', '/health');
    return res.status === 200 && (res.body.status === 'healthy' || res.body.status === 'HEALTHY');
  });

  // 2. Demo Login & Auth Token
  let token = '';
  await check('POST /v1/auth/demo-login (HTTP 200)', async () => {
    const res = await request('POST', '/v1/auth/demo-login', { role: 'analyst' });
    const tokenCandidate = res.body?.session?.token || res.body?.token;
    if (res.status === 200 && tokenCandidate) {
      token = tokenCandidate;
      return true;
    }
    return false;
  });

  const authHeader = { 'Authorization': `Bearer ${token}` };

  // 3. User Me
  await check('GET /v1/auth/me (HTTP 200)', async () => {
    const res = await request('GET', '/v1/auth/me', null, authHeader);
    return res.status === 200 && res.body.user && res.body.tenant;
  });

  // 4. Live Dashboard Summary
  await check('GET /dashboard/summary?environment=live (HTTP 200, clean ₹0.00)', async () => {
    const res = await request('GET', '/dashboard/summary?environment=live', null, authHeader);
    return res.status === 200 && res.body.total_at_risk_display === '₹0.00' && res.body.total_opportunities === 0;
  });

  // 5. Test Dashboard Summary
  await check('GET /dashboard/summary?environment=test (HTTP 200)', async () => {
    const res = await request('GET', '/dashboard/summary?environment=test', null, authHeader);
    return res.status === 200 && typeof res.body.total_opportunities === 'number';
  });

  // 6. Live Opportunities Partitioning
  await check('GET /v1/opportunities?environment=live (HTTP 200, count 0)', async () => {
    const res = await request('GET', '/v1/opportunities?environment=live', null, authHeader);
    return res.status === 200 && res.body.count === 0 && res.body.opportunities.length === 0;
  });

  // 7. Test Opportunities
  await check('GET /v1/opportunities?environment=test (HTTP 200)', async () => {
    const res = await request('GET', '/v1/opportunities?environment=test', null, authHeader);
    return res.status === 200 && Array.isArray(res.body.opportunities);
  });

  // 8. Notifications List
  await check('GET /v1/notifications (HTTP 200)', async () => {
    const res = await request('GET', '/v1/notifications', null, authHeader);
    return res.status === 200 && Array.isArray(res.body.notifications);
  });

  // 9. Mark All Notifications Read
  await check('POST /v1/notifications/mark-all-read (HTTP 200)', async () => {
    const res = await request('POST', '/v1/notifications/mark-all-read', {}, authHeader);
    return res.status === 200 && res.body.success === true;
  });

  // 10. API Keys Management
  await check('GET /v1/api-keys (HTTP 200)', async () => {
    const res = await request('GET', '/v1/api-keys', null, authHeader);
    return res.status === 200 && Array.isArray(res.body.api_keys);
  });

  // 11. Razorpay Integration Status
  await check('GET /v1/integrations/razorpay/status (HTTP 200)', async () => {
    const res = await request('GET', '/v1/integrations/razorpay/status', null, authHeader);
    return res.status === 200 && typeof res.body.connected === 'boolean';
  });

  // 12. Switch Environment to Live and back
  await check('POST /v1/auth/switch-environment (HTTP 200)', async () => {
    const resLive = await request('POST', '/v1/auth/switch-environment', { environment: 'live' }, authHeader);
    const okLive = resLive.status === 200 && resLive.body.tenant.environment === 'live';
    const resTest = await request('POST', '/v1/auth/switch-environment', { environment: 'test' }, authHeader);
    const okTest = resTest.status === 200 && resTest.body.tenant.environment === 'test';
    return okLive && okTest;
  });

  // 13. Deleted routes return 404 on frontend
  await check('Deleted frontend routes return 404', async () => {
    const resCc = await new Promise(resolve => http.get('http://localhost:3000/dashboard/command-center', r => resolve(r.statusCode)));
    const resEco = await new Promise(resolve => http.get('http://localhost:3000/dashboard/economics', r => resolve(r.statusCode)));
    const resAud = await new Promise(resolve => http.get('http://localhost:3000/dashboard/audit', r => resolve(r.statusCode)));
    return resCc === 404 && resEco === 404 && resAud === 404;
  });

  // 14. Demo store route returns 200
  await check('Demo Store returns HTTP 200', async () => {
    const status = await new Promise(resolve => http.get('http://localhost:3001/demo-store', r => resolve(r.statusCode)));
    return status === 200;
  });

  // 15. SDK script tag returns 200
  await check('SDK ctrl.js returns HTTP 200', async () => {
    const status = await new Promise(resolve => http.get('http://localhost:3001/sdk/ctrl.js', r => resolve(r.statusCode)));
    return status === 200;
  });

  console.log(`\n==================================================`);
  console.log(`End-to-End API Health Test Summary: ${failures === 0 ? 'ALL PASSED ✅' : `${failures} FAILURES ❌`}`);
  console.log(`==================================================`);
  process.exit(failures === 0 ? 0 : 1);
}

runTests();
