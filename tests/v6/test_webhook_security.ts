process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { RazorpayProviderAdapter } from '../../src/providers/razorpay/adapter.js';

describe('V6 Phase 6: Webhook Security & Multi-Secret Rotation', () => {
  const secretA = 'rzp_sec_primary_live_webhook_secret_991';
  const secretB = 'rzp_sec_backup_live_webhook_secret_992';

  it('verifies valid HMAC-SHA256 signature against primary secret', () => {
    const rawPayload = JSON.stringify({
      entity: 'event',
      account_id: 'acc_test_123',
      event: 'payment.failed',
      payload: { payment: { entity: { id: 'pay_fail_001', amount: 50000 } } },
    });

    const validSignature = crypto
      .createHmac('sha256', secretA)
      .update(rawPayload)
      .digest('hex');

    const isValid = RazorpayProviderAdapter.verifyWebhookSignature(
      rawPayload,
      validSignature,
      secretA
    );
    assert.equal(isValid, true, 'Valid signature must be verified successfully');
  });

  it('rejects tampered webhook payload with invalid signature', () => {
    const rawPayload = JSON.stringify({
      entity: 'event',
      event: 'payment.failed',
      payload: { payment: { entity: { id: 'pay_fail_001', amount: 50000 } } },
    });

    const validSignature = crypto
      .createHmac('sha256', secretA)
      .update(rawPayload)
      .digest('hex');

    const tamperedPayload = JSON.stringify({
      entity: 'event',
      event: 'payment.captured', // Tampered event
      payload: { payment: { entity: { id: 'pay_fail_001', amount: 50000 } } },
    });

    const isValid = RazorpayProviderAdapter.verifyWebhookSignature(
      tamperedPayload,
      validSignature,
      secretA
    );
    assert.equal(isValid, false, 'Tampered payload must fail signature verification');
  });

  it('supports seamless secret rotation across multi-secret lists', () => {
    const payload = JSON.stringify({ event: 'payment.authorized', id: 'pay_rot_123' });

    // Signature created using backup secret B
    const signatureWithSecretB = crypto
      .createHmac('sha256', secretB)
      .update(payload)
      .digest('hex');

    // Verification against dual secret list [secretA, secretB]
    const isValidWithRotation = RazorpayProviderAdapter.verifyWebhookSignature(
      payload,
      signatureWithSecretB,
      [secretA, secretB]
    );

    assert.equal(
      isValidWithRotation,
      true,
      'Multi-secret verification must accept signatures signed with backup secret during rotation'
    );
  });
});
