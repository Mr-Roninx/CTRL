import { Router, Request, Response } from 'express';

export function generateOpenAPISpec(): Record<string, any> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'CTRL Autonomous Recovery Control Plane API',
      version: '11.0.0',
      description:
        'Enterprise Autonomous Economic Control Plane for Razorpay Failed Payment Recovery. Integrates Bayesian continuous learning, greedy shadow price market allocation, and deterministic Action Authority compliance gating.',
      contact: {
        name: 'CTRL Engineering & Security Team',
        url: 'https://ctrl.dev',
      },
      license: {
        name: 'Proprietary',
      },
    },
    servers: [
      { url: 'http://localhost:3001', description: 'Local Development & Test Server' },
      { url: 'https://api.ctrl.dev', description: 'Production Gateway' },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Tenant JWT token with 15-minute rotation.',
        },
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'Scoped Merchant API Key (e.g. `events:write`, `recoveries:read`).',
        },
      },
      schemas: {
        ProblemDetails: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            title: { type: 'string' },
            status: { type: 'integer' },
            detail: { type: 'string' },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  message: { type: 'string' },
                  code: { type: 'string' },
                },
              },
            },
          },
        },
        RecoveryOpportunity: {
          type: 'object',
          required: ['id', 'amount_paise', 'reason_code', 'customer_id'],
          properties: {
            id: { type: 'string' },
            source: { type: 'string', enum: ['real', 'synthetic'] },
            amount_paise: { type: 'integer', minimum: 1 },
            currency: { type: 'string', default: 'INR' },
            reason_code: { type: 'string' },
            decline_type: { type: 'string', enum: ['hard', 'soft', 'unknown'] },
            attempt_count: { type: 'integer', default: 1 },
            customer_id: { type: 'string' },
            customer_trust_score: { type: 'number', minimum: 0, maximum: 1 },
            status: {
              type: 'string',
              enum: ['pending', 'scored', 'allocated', 'authorized', 'deferred', 'blocked', 'abstained', 'executing', 'recovered', 'not_recovered'],
            },
            tenant_id: { type: 'string' },
          },
        },
        Score: {
          type: 'object',
          properties: {
            opportunity_id: { type: 'string' },
            natural_recovery_prob: { type: 'number', description: '*Model-estimated counterfactual' },
            intervention_recovery_prob: { type: 'number', description: '*Model-estimated counterfactual' },
            incremental_prob: { type: 'number', description: '*Model-estimated counterfactual' },
            operational_cost_paise: { type: 'integer' },
            fatigue_cost_paise: { type: 'integer' },
            expected_incremental_value_paise: { type: 'integer' },
            confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
            iven_band: { type: 'string', enum: ['STRONG', 'MODERATE', 'WEAK', 'NEGATIVE'] },
          },
        },
      },
    },
    paths: {
      '/health': {
        get: {
          summary: 'Health Check & Connection Pool Telemetry',
          responses: {
            '200': {
              description: 'System operational status and pool metrics',
            },
          },
        },
      },
      '/v1/events': {
        post: {
          summary: 'Ingest payment failure webhook or event',
          security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/RecoveryOpportunity',
                },
              },
            },
          },
          responses: {
            '200': { description: 'Event ingested and opportunity created' },
            '400': { description: 'Validation error' },
            '429': { description: 'Rate limit exceeded' },
          },
        },
      },
      '/v1/opportunities': {
        get: {
          summary: 'List recovery opportunities for tenant',
          security: [{ BearerAuth: [] }],
          responses: {
            '200': { description: 'Opportunity records array' },
          },
        },
      },
      '/v1/market/run': {
        post: {
          summary: 'Run greedy shadow price market allocation',
          security: [{ BearerAuth: [] }],
          responses: {
            '200': { description: 'Market decisions (ACT / WAIT / ABSTAIN)' },
          },
        },
      },
      '/v1/audit/trail': {
        get: {
          summary: 'Retrieve durable audit trail and two-stage compliance logs',
          security: [{ BearerAuth: [] }],
          responses: {
            '200': { description: 'Audit timeline events' },
          },
        },
      },
      '/v2/economics/bayesian-priors': {
        get: {
          summary: 'V2: Continuous Learning Bayesian Beta priors and 95% credible intervals',
          security: [{ BearerAuth: [] }],
          responses: {
            '200': { description: 'Persisted Bayesian priors' },
          },
        },
      },
      '/v2/economics/causal-attribution': {
        get: {
          summary: 'V2: Difference-in-Differences causal lift and ATT metrics',
          security: [{ BearerAuth: [] }],
          responses: {
            '200': { description: 'Diff-in-Diff analysis results' },
          },
        },
      },
      '/v2/economics/bandit-arms': {
        get: {
          summary: 'V2: Contextual Thompson Sampling Multi-Armed Bandit analytics',
          security: [{ BearerAuth: [] }],
          responses: {
            '200': { description: 'Arm statistics and incremental lift' },
          },
        },
      },
    },
  };
}

export function createOpenAPIRouter(): Router {
  const router = Router();

  // JSON Specification endpoint
  router.get('/openapi.json', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.json(generateOpenAPISpec());
  });

  // Interactive HTML Documentation endpoint
  router.get('/docs', (_req: Request, res: Response) => {
    const spec = generateOpenAPISpec();
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CTRL V11 — API Gateway Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/@stoplight/elements/styles.min.css">
  <style>
    body { margin: 0; background: #090d16; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .top-header { background: #0f172a; padding: 16px 24px; border-bottom: 1px solid #1e293b; display: flex; align-items: center; justify-content: space-between; }
    .brand { font-weight: 700; font-size: 16px; display: flex; align-items: center; gap: 8px; color: #60a5fa; }
    .badge { background: #1e293b; color: #38bdf8; font-family: monospace; font-size: 12px; padding: 4px 8px; border-radius: 4px; border: 1px solid #334155; }
    .links a { color: #94a3b8; text-decoration: none; font-size: 13px; margin-left: 16px; }
    .links a:hover { color: #f8fafc; }
  </style>
</head>
<body>
  <div class="top-header">
    <div class="brand">
      <span>🛡️ CTRL Control Plane</span>
      <span class="badge">OpenAPI 3.1.0 • V11 Enterprise</span>
    </div>
    <div class="links">
      <a href="/openapi.json" target="_blank">Raw JSON Spec</a>
      <a href="/health" target="_blank">Health Telemetry</a>
    </div>
  </div>

  <elements-api
    apiDescriptionDocument='${JSON.stringify(spec).replace(/'/g, "&#39;")}'
    router="hash"
    layout="sidebar"
    logo="/favicon.ico"
  />

  <script src="https://unpkg.com/@stoplight/elements/web-components.min.js"></script>
</body>
</html>
    `;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });

  return router;
}
