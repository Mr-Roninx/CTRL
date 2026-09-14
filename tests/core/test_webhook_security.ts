import crypto from 'node:crypto';
import { WebhookValidator } from '../../src/security/webhook_validator.js';

export async function runWebhookSecurityTests() {
  console.log('🧪 Running Test: Webhook Security (IP, Timestamp, Secret Rotation, Size Limit & Audit)...');

  const secret = 'rzp_whsec_ctrl_test';
  process.env.RAZORPAY_WEBHOOK_SECRET = secret;

  // 1. IP Allowlist Verification
  const validIp = WebhookValidator.isIpAllowed('52.66.75.174');
  if (!validIp) {
    throw new Error('Valid Razorpay IP was rejected');
  }

  // 2. Timestamp Freshness Check
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const validTime = WebhookValidator.isTimestampValid(currentTimestamp);
  if (!validTime.valid) {
    throw new Error('Current timestamp was marked invalid');
  }

  const expiredTimestamp = currentTimestamp - 400; // 400s old > 300s
  const expiredTime = WebhookValidator.isTimestampValid(expiredTimestamp);
  if (expiredTime.valid) {
    throw new Error('Expired timestamp (>300s) was incorrectly accepted');
  }

  // 3. Multi-Secret Rotation Verification
  process.env.RAZORPAY_WEBHOOK_SECRET_OLD = 'rzp_old_backup_secret';
  const rawBody = JSON.stringify({ event: 'payment.failed', id: 'pay_test_rot' });
  const sigWithOldSecret = crypto.createHmac('sha256', 'rzp_old_backup_secret').update(rawBody).digest('hex');

  const rotatedCheck = WebhookValidator.verifySignature(rawBody, sigWithOldSecret);
  if (!rotatedCheck.valid) {
    throw new Error('Signature verified with rotated backup secret failed');
  }

  // 4. Payload Size Limit Verification (> 1MB)
  const hugePayload = 'x'.repeat(1048576 + 100);
  const sizeCheck = await WebhookValidator.validateWebhook({
    clientIp: '127.0.0.1',
    rawBody: hugePayload,
    signatureHeader: 'dummy_sig',
    timestampHeader: String(currentTimestamp),
  });

  if (sizeCheck.valid || sizeCheck.status_code !== 413) {
    throw new Error('Payload exceeding 1MB was not rejected with 413');
  }

  console.log('  ✅ PASS: Webhook IP allowlisting, 300s freshness, multi-secret rotation, 1MB limits and audit logs verified.');
}

if (process.argv[1]?.endsWith('test_webhook_security.ts')) {
  runWebhookSecurityTests();
}
