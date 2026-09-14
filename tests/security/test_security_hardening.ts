import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { inputSanitizerMiddleware, validateRequestBody } from '../../src/security/input_sanitizer.js';
import { generateTokenPair, verifySessionToken, revokeToken, isTokenRevoked, UserRole } from '../../src/security/auth.js';
import { ApiKeyService } from '../../src/security/api_keys.js';

test('CTRL V11 Advanced Security Hardening', async (t) => {
  await t.test('1. Input Sanitizer strips null bytes and control chars', () => {
    const req: any = {
      body: {
        normal: 'Valid text',
        malicious: 'Attack\0Payload\x07Injection',
        nested: { field: 'Safe\0Here' },
      },
      query: {},
      params: {},
    };

    inputSanitizerMiddleware(req, {} as any, () => {});

    assert.equal(req.body.normal, 'Valid text');
    assert.equal(req.body.malicious, 'AttackPayloadInjection');
    assert.equal(req.body.nested.field, 'SafeHere');
  });

  await t.test('2. Zod request validator accepts valid payload and blocks invalid', () => {
    const schema = z.object({
      email: z.string().email(),
      amount_paise: z.number().int().positive(),
    });

    const middleware = validateRequestBody(schema);

    // Valid case
    let nextCalled = false;
    const validReq: any = { body: { email: 'merchant@example.com', amount_paise: 50000 } };
    middleware(validReq, {} as any, () => { nextCalled = true; });
    assert.equal(nextCalled, true);

    // Invalid case
    let statusCode = 0;
    let jsonResponse: any = null;
    const invalidRes: any = {
      status: (code: number) => {
        statusCode = code;
        return {
          json: (data: any) => { jsonResponse = data; },
        };
      },
    };
    const invalidReq: any = { body: { email: 'not-an-email', amount_paise: -100 } };
    middleware(invalidReq, invalidRes, () => {});
    assert.equal(statusCode, 400);
    assert.equal(jsonResponse.error, 'Validation Failed');
    assert.equal(jsonResponse.details.length, 2);
  });

  await t.test('3. JWT token rotation and blacklist revocation', async () => {
    const user = {
      userId: 'usr_test_1101',
      role: UserRole.ADMIN,
      tenantId: 'tnt_test_1101',
    };

    const tokens = generateTokenPair(user);
    assert.ok(tokens.accessToken, 'Access token generated');
    assert.ok(tokens.refreshToken, 'Refresh token generated');
    assert.ok(tokens.jti, 'Unique JTI generated');

    const decoded = verifySessionToken(tokens.accessToken);
    assert.equal(decoded.userId, 'usr_test_1101');
    assert.equal(decoded.jti, tokens.jti);

    // Verify not revoked initially
    assert.equal(await isTokenRevoked(tokens.jti), false);

    // Revoke token
    await revokeToken(tokens.jti, 3600);
    assert.equal(await isTokenRevoked(tokens.jti), true);
  });

  await t.test('4. API Key scope enforcement', async () => {
    const created = await ApiKeyService.createApiKey({
      tenantId: 'tenant_system_default',
      name: 'Scope Test Key',
      environment: 'test',
      scopes: ['events:read', 'events:write'],
    });

    // Valid with allowed scope
    const authSuccess = await ApiKeyService.authenticateKey(created.rawKey, 'events:read');
    assert.equal(authSuccess.valid, true);

    // Forbidden with unauthorized scope
    const authForbidden = await ApiKeyService.authenticateKey(created.rawKey, 'integrations:write');
    assert.equal(authForbidden.valid, false);
    assert.match(authForbidden.errorReason || '', /Forbidden: API key lacks required scope/);
  });
});
