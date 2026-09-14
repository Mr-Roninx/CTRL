import { app } from '../src/server.js';
import { Server } from 'node:http';

async function testSdkRoute() {
  console.log('🚀 Testing /sdk/ctrl.js route...');

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(3097, () => {
      console.log('📡 Test Server on http://127.0.0.1:3097');
      resolve(s);
    });
  });

  try {
    const res = await fetch('http://127.0.0.1:3097/sdk/ctrl.js');
    console.log(`Status: ${res.status}, Content-Type: ${res.headers.get('content-type')}`);
    const text = await res.text();
    console.log(`SDK Content length: ${text.length} chars`);
    if (!text.includes('CTRL Autonomous Payment Recovery')) {
      throw new Error('SDK Content missing header string');
    }
    console.log('✅ /sdk/ctrl.js served successfully!');
  } finally {
    server.close();
  }
}

testSdkRoute().catch((e) => {
  console.error('❌ Failed:', e.message);
  process.exit(1);
});
