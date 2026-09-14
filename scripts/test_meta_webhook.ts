async function testMetaWebhook() {
  const challenge = 'test_challenge_' + Date.now();
  const token = 'ctrl_meta_verify_token_2026';
  const url = `http://localhost:3001/webhooks/whatsapp?hub.mode=subscribe&hub.challenge=${challenge}&hub.verify_token=${token}`;

  console.log('Testing Meta GET Webhook Challenge...');
  const res = await fetch(url);
  const text = await res.text();

  console.log('Status:', res.status);
  console.log('Response body:', text);

  if (res.status === 200 && text === challenge) {
    console.log('✅ Meta Webhook Challenge Verification PASSED!');
  } else {
    console.log('❌ Failed');
  }
}

testMetaWebhook();
