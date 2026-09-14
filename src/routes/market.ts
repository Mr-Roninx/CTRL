import { Router, Request, Response } from 'express';
import { runMarketAllocation } from '../market/allocator.js';
import { getAllAllocationDecisions } from '../db/database.js';
import { resolveTenantId } from '../security/tenant_guard.js';

export const marketRouter = Router();

// GET /market/run?capacity=5
marketRouter.get('/run', (req: Request, res: Response) => {
  try {
    const tenantId = resolveTenantId(req) || undefined;
    const capacityParam = req.query.capacity as string | undefined;
    const capacity = capacityParam ? parseInt(capacityParam, 10) : undefined;

    const result = runMarketAllocation({ capacity, tenantId });
    res.json(result);
  } catch (error) {
    console.error('Failed to run market allocation:', error);
    res.status(500).json({ error: 'Failed to run market allocation' });
  }
});

// POST /market/run
marketRouter.post('/run', (req: Request, res: Response) => {
  try {
    const tenantId = resolveTenantId(req) || undefined;
    const capacity = req.body.capacity !== undefined ? Number(req.body.capacity) : undefined;
    const result = runMarketAllocation({ capacity, tenantId });
    res.json(result);
  } catch (error) {
    console.error('Failed to execute market allocation:', error);
    res.status(500).json({ error: 'Failed to execute market allocation' });
  }
});

// GET /market/decisions
marketRouter.get('/decisions', (req: Request, res: Response) => {
  try {
    const tenantId = resolveTenantId(req) || undefined;
    const decisions = getAllAllocationDecisions(tenantId);
    res.json({
      count: decisions.length,
      decisions,
    });
  } catch (error) {
    console.error('Failed to fetch allocation decisions:', error);
    res.status(500).json({ error: 'Failed to fetch allocation decisions' });
  }
});
