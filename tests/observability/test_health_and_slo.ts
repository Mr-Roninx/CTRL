import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import { HealthService } from '../../src/observability/health.js';
import { SLOTracker } from '../../src/observability/slo_tracker.js';
import { initDatabase } from '../../src/db/database.js';

describe('Phase 11: V11 Seal — Production Readiness & Runbook Verification', () => {
  before(() => {
    initDatabase();
  });

  describe('1. 3-Tier Kubernetes-Ready Health Check System', () => {
    test('liveness probe returns UP with uptime', () => {
      let statusCode = 0;
      let responseBody: any = null;

      const req: any = {};
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

      HealthService.liveness(req, res);
      assert.strictEqual(statusCode, 200);
      assert.strictEqual(responseBody.status, 'UP');
      assert.ok(typeof responseBody.uptime_seconds === 'number');
    });

    test('readiness probe verifies database and cache connectivity', async () => {
      let statusCode = 0;
      let responseBody: any = null;

      const req: any = {};
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

      await HealthService.readiness(req, res);
      assert.strictEqual(statusCode, 200);
      assert.strictEqual(responseBody.status, 'READY');
      assert.strictEqual(responseBody.checks.database.status, 'UP');
      assert.strictEqual(responseBody.checks.cache.status, 'UP');
    });

    test('deep diagnostic probe verifies ledger integrity, queue depths, and SLO status', async () => {
      let statusCode = 0;
      let responseBody: any = null;

      const req: any = {};
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

      await HealthService.deep(req, res);
      assert.strictEqual(statusCode, 200);
      assert.strictEqual(responseBody.status, 'HEALTHY');
      assert.ok(responseBody.checks.ledger_integrity);
      assert.ok(responseBody.checks.safety_controls);
      assert.ok(responseBody.checks.job_queues);
      assert.ok(responseBody.checks.slo_compliance);
      assert.strictEqual(responseBody.checks.slo_compliance.status, 'COMPLIANT');
    });
  });

  describe('2. Service Level Objective (SLO) Tracker & Error Budget Burn Rate', () => {
    const tracker = SLOTracker.getInstance();

    before(() => {
      tracker.reset();
    });

    test('computes availability and low burn rate under healthy traffic', () => {
      // Record 1000 fast, successful requests
      for (let i = 0; i < 999; i++) {
        tracker.recordRequest(200, 45); // 45ms latency
      }
      tracker.recordRequest(500, 55); // 1 failure out of 1000 (0.1% error rate)

      const status = tracker.getSLOStatus();
      assert.strictEqual(status.availability.target_pct, 99.9);
      assert.strictEqual(status.availability.current_pct, 99.9);
      assert.strictEqual(status.latency.current_pct_under_500ms, 100);
      // Burn rate = 0.001 / 0.001 = 1.0 (normal consumption)
      assert.strictEqual(status.availability.burn_rate_1h, 1.0);
      assert.strictEqual(status.availability.status, 'HEALTHY');
    });

    test('detects elevated burn rate when error budget is exhausted', () => {
      // Record consecutive 500 errors to spike burn rate
      for (let i = 0; i < 20; i++) {
        tracker.recordRequest(500, 60);
      }

      const status = tracker.getSLOStatus();
      assert.ok(status.availability.burn_rate_1h > 2.0, 'Burn rate should exceed warning threshold');
      assert.ok(['WARNING', 'BREACHED'].includes(status.availability.status));
    });
  });
});
