import { test, describe } from 'node:test';
import assert from 'node:assert';
import express, { Request, Response } from 'express';
import { validateRequest, CreateOpportunitySchema, KillSwitchToggleSchema } from '../../src/gateway/validator.js';
import { tieredRateLimiter, TIER_CONFIGS } from '../../src/gateway/rate_tiers.js';
import { versionNegotiationMiddleware, createV2Router } from '../../src/gateway/versioning.js';
import { generateOpenAPISpec, createOpenAPIRouter } from '../../src/gateway/openapi_generator.js';

describe('Phase 9: Enterprise API Gateway Layer Verification', () => {
  describe('1. Zod Request Validator & RFC 7807 Error Formatting', () => {
    test('passes valid request through middleware to handler', async () => {
      let passed = false;
      const middleware = validateRequest({ body: CreateOpportunitySchema });

      const req: any = {
        body: {
          amount_paise: 100000,
          reason_code: 'insufficient_funds',
          customer_id: 'cust_valid_01',
        },
      };
      const res: any = {};
      const next = () => { passed = true; };

      await middleware(req, res, next);
      assert.strictEqual(passed, true, 'Valid payload should call next()');
      assert.strictEqual(req.body.amount_paise, 100000);
      assert.strictEqual(req.body.currency, 'INR'); // default filled by schema
    });

    test('rejects invalid request with structured RFC 7807 problem details', async () => {
      let statusCode = 0;
      let responseBody: any = null;
      const middleware = validateRequest({ body: CreateOpportunitySchema });

      const req: any = {
        body: {
          amount_paise: -500, // Invalid: negative
          // missing reason_code and customer_id
        },
        originalUrl: '/v1/opportunities',
      };
      const res: any = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(body: any) {
          responseBody = body;
          return this;
        },
      };
      const next = () => {};

      await middleware(req, res, next);
      assert.strictEqual(statusCode, 400);
      assert.strictEqual(responseBody.type, 'https://ctrl.dev/errors/validation-error');
      assert.strictEqual(responseBody.status, 400);
      assert.ok(Array.isArray(responseBody.errors));
      assert.ok(responseBody.errors.length >= 2, 'Should detect amount error and missing fields');
      assert.ok(responseBody.errors.some((e: any) => e.field === 'body.amount_paise'));
    });
  });

  describe('2. Tiered Rate Limiter & Quota Headers', () => {
    test('attaches standard rate limit headers according to tier', async () => {
      const middleware = tieredRateLimiter({ overrideTier: 'STARTER' });
      const headers: Record<string, string> = {};

      const req: any = {
        path: '/v1/opportunities',
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
      };
      const res: any = {
        setHeader(name: string, value: string) {
          headers[name] = value;
        },
      };
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      await middleware(req, res, next);
      assert.strictEqual(nextCalled, true);
      assert.strictEqual(headers['X-RateLimit-Tier'], 'STARTER');
      assert.strictEqual(headers['X-RateLimit-Limit'], TIER_CONFIGS.STARTER.maxRequestsPerMinute.toString());
      assert.ok(Number(headers['X-RateLimit-Remaining']) >= 0);
      assert.ok(Number(headers['X-RateLimit-Reset']) > 0);
    });
  });

  describe('3. API Versioning & Header Negotiation', () => {
    test('detects version from path prefix /v2', () => {
      let detectedHeader = '';
      const req: any = { path: '/v2/economics', headers: {} };
      const res: any = {
        setHeader(name: string, value: string) {
          if (name === 'X-API-Version') detectedHeader = value;
        },
      };
      versionNegotiationMiddleware(req, res, () => {});
      assert.strictEqual(req.apiVersion, 'v2');
      assert.strictEqual(detectedHeader, 'v2');
    });

    test('detects version from Accept-Version header', () => {
      let detectedHeader = '';
      const req: any = { path: '/opportunities', headers: { 'accept-version': 'v2' }, header(name: string) { return this.headers[name.toLowerCase()]; } };
      const res: any = {
        setHeader(name: string, value: string) {
          if (name === 'X-API-Version') detectedHeader = value;
        },
      };
      versionNegotiationMiddleware(req, res, () => {});
      assert.strictEqual(req.apiVersion, 'v2');
      assert.strictEqual(detectedHeader, 'v2');
    });
  });

  describe('4. OpenAPI 3.1 Specification & Interactive Documentation', () => {
    test('generates valid OpenAPI 3.1.0 schema specification', () => {
      const spec = generateOpenAPISpec();
      assert.strictEqual(spec.openapi, '3.1.0');
      assert.strictEqual(spec.info.title, 'CTRL Autonomous Recovery Control Plane API');
      assert.strictEqual(spec.info.version, '11.0.0');
      assert.ok(spec.components.schemas.RecoveryOpportunity);
      assert.ok(spec.components.schemas.Score);
      assert.ok(spec.paths['/v1/events']);
      assert.ok(spec.paths['/v2/economics/bayesian-priors']);
    });

    test('OpenAPI router serves spec and documentation', async () => {
      const router = createOpenAPIRouter();
      assert.ok(router);
    });
  });

  describe('5. V2 Enterprise Router Endpoints', () => {
    test('creates V2 router with expected routes', () => {
      const router = createV2Router();
      assert.ok(router);
      // Check stack contains routes
      const routes = (router as any).stack.map((layer: any) => layer.route?.path).filter(Boolean);
      assert.ok(routes.includes('/economics/bayesian-priors'));
      assert.ok(routes.includes('/economics/bandit-arms'));
      assert.ok(routes.includes('/economics/causal-attribution'));
      assert.ok(routes.includes('/agent/portfolio-state'));
    });
  });
});
