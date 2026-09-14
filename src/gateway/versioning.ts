import { Request, Response, NextFunction, Router } from 'express';
import { BayesianProbabilityCalibrator } from '../economics/bayesian_calibration.js';
import { ThompsonSamplingBandit } from '../economics/bandit_policy.js';
import { CausalAttributionEngine } from '../economics/causal_attribution.js';
import { getAllOpportunities, getDatabase } from '../db/database.js';
import { resolveTenantId } from '../security/tenant_guard.js';

export type ApiVersion = 'v1' | 'v2';

declare global {
  namespace Express {
    interface Request {
      apiVersion?: ApiVersion;
    }
  }
}

/**
 * Middleware that inspects URL path and headers to determine and enforce API version.
 */
export function versionNegotiationMiddleware(req: Request, res: Response, next: NextFunction): void {
  let detectedVersion: ApiVersion = 'v1';

  if (req.path.startsWith('/v2')) {
    detectedVersion = 'v2';
  } else if (req.path.startsWith('/v1')) {
    detectedVersion = 'v1';
  } else {
    // Header-based version negotiation
    const headerVersion = req.header('Accept-Version') || req.header('X-API-Version');
    if (headerVersion && headerVersion.toLowerCase().includes('v2')) {
      detectedVersion = 'v2';
    }
  }

  req.apiVersion = detectedVersion;
  res.setHeader('X-API-Version', detectedVersion);
  next();
}

/**
 * Creates the V2 API Router with enterprise-grade endpoints.
 */
export function createV2Router(): Router {
  const router = Router();

  // GET /v2/economics/bayesian-priors
  router.get('/economics/bayesian-priors', async (req: Request, res: Response): Promise<void> => {
    try {
      const tenantId = resolveTenantId(req) || 'tenant_system_default';
      const priors = await BayesianProbabilityCalibrator.loadPriorsFromDatabase(tenantId);
      const db = getDatabase();
      const rows = db.prepare('SELECT * FROM bayesian_priors WHERE tenant_id = ?').all(tenantId);
      res.json({
        version: 'v2',
        tenant_id: tenantId,
        priors: rows,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to retrieve Bayesian priors', details: err.message });
    }
  });

  // GET /v2/economics/bandit-arms
  router.get('/economics/bandit-arms', (req: Request, res: Response): void => {
    try {
      const tenantId = resolveTenantId(req) || 'tenant_system_default';
      const bandit = ThompsonSamplingBandit.getInstance();
      const analytics = bandit.getArmAnalytics(tenantId);
      res.json({
        version: 'v2',
        tenant_id: tenantId,
        arms: analytics,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to retrieve bandit analytics', details: err.message });
    }
  });

  // GET /v2/economics/causal-attribution
  router.get('/economics/causal-attribution', (req: Request, res: Response): void => {
    try {
      const tenantId = resolveTenantId(req) || 'tenant_system_default';
      const opps = getAllOpportunities(tenantId);
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const result = CausalAttributionEngine.evaluateSyntheticHoldoutLift(opps, cutoff);

      res.json({
        version: 'v2',
        tenant_id: tenantId,
        evaluation_window: '7d',
        diff_in_diff: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to compute causal attribution', details: err.message });
    }
  });

  // GET /v2/agent/portfolio-state
  router.get('/agent/portfolio-state', (req: Request, res: Response): void => {
    try {
      const tenantId = resolveTenantId(req) || 'tenant_system_default';
      const opps = getAllOpportunities(tenantId);
      const pending = opps.filter((o) => o.status === 'pending' || o.status === 'scored').length;
      const executing = opps.filter((o) => o.status === 'executing').length;
      const recovered = opps.filter((o) => o.status === 'recovered').length;

      res.json({
        version: 'v2',
        tenant_id: tenantId,
        portfolio: {
          pending_count: pending,
          executing_count: executing,
          recovered_count: recovered,
          total_count: opps.length,
        },
        capacity: {
          batch_limit: 5, // Test Mode Invariant
          admission_shadow_price_paise: 3500,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to retrieve portfolio state', details: err.message });
    }
  });

  return router;
}
