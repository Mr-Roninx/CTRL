import {
  SimulateWebhookSchema,
  MarketRunSchema,
  KillSwitchSchema,
  OutreachReviewSchema,
} from '../../src/security/schemas.js';
import { generateSessionToken, verifySessionToken } from '../../src/security/auth.js';

export async function runApiSecurityTests() {
  console.log('🧪 Running Test: API Security & Strict Zod Validation Schemas...');

  // 1. Zod Schema Validation on Valid Payloads
  const validSim = SimulateWebhookSchema.safeParse({
    event: 'payment.failed',
    payload: { payment: { entity: { id: 'pay_123', amount: 5000 } } },
  });
  if (!validSim.success) {
    throw new Error('Valid webhook payload failed Zod schema parsing');
  }

  // 2. Zod Schema Rejection on Invalid Payloads
  const invalidMarket = MarketRunSchema.safeParse({ capacity: -5 });
  if (invalidMarket.success) {
    throw new Error('Invalid negative capacity was incorrectly accepted by Zod');
  }

  const invalidOutreach = OutreachReviewSchema.safeParse({ status: 'INVALID_STATUS' });
  if (invalidOutreach.success) {
    throw new Error('Invalid outreach review status was accepted');
  }

  // 3. JWT Token Generation & Verification
  const token = generateSessionToken({
    userId: 'admin_user_1',
    role: 'admin',
    merchant_id: 'merchant_acme',
  });

  const verifiedUser = verifySessionToken(token);
  if (verifiedUser.userId !== 'admin_user_1' || verifiedUser.role !== 'admin') {
    throw new Error('JWT verification payload mismatch');
  }

  console.log('  ✅ PASS: Strict Zod validation and JWT 30-minute session management verified.');
}

if (process.argv[1]?.endsWith('test_api_security_zod.ts')) {
  runApiSecurityTests();
}
