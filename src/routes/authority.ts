import { Router, Request, Response } from 'express';
import {
  isKillSwitchActive,
  setKillSwitch,
  runAuthorityPipeline,
  evaluateOpportunity,
} from '../authority/gate.js';
import {
  getOpportunityById,
  getScoreByOpportunityId,
  getAllocationDecisionByOpportunityId,
} from '../db/database.js';
import { resolveTenantId } from '../security/tenant_guard.js';

export const authorityRouter = Router();

// GET /authority/kill-switch
authorityRouter.get('/kill-switch', (_req: Request, res: Response) => {
  res.json({
    kill_switch_active: isKillSwitchActive(),
    status: isKillSwitchActive() ? 'ENGAGED (ALL ACTIONS BLOCKED)' : 'DISENGAGED (NORMAL OPERATION)',
  });
});

// POST /authority/kill-switch
authorityRouter.post('/kill-switch', (req: Request, res: Response) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'Missing or invalid boolean "enabled" in request body' });
      return;
    }

    const state = setKillSwitch(enabled);
    res.json({
      success: true,
      kill_switch_active: state,
      status: state ? 'ENGAGED (ALL ACTIONS BLOCKED)' : 'DISENGAGED (NORMAL OPERATION)',
    });
  } catch (error) {
    console.error('Failed to toggle kill switch:', error);
    res.status(500).json({ error: 'Failed to toggle kill switch' });
  }
});

// GET /authority/run?capacity=5
authorityRouter.get('/run', (req: Request, res: Response) => {
  try {
    const tenantId = resolveTenantId(req) || undefined;
    const capacityParam = req.query.capacity as string | undefined;
    const capacity = capacityParam ? parseInt(capacityParam, 10) : undefined;
    const environment = (req.query.environment === 'live' || req.query.environment === 'test') ? req.query.environment : undefined;

    const result = runAuthorityPipeline({ capacity, tenantId, environment });
    res.json(result);
  } catch (error) {
    console.error('Failed to run authority pipeline:', error);
    res.status(500).json({ error: 'Failed to run authority pipeline' });
  }
});

// POST /authority/run
authorityRouter.post('/run', (req: Request, res: Response) => {
  try {
    const tenantId = resolveTenantId(req) || undefined;
    const capacity = req.body.capacity !== undefined ? Number(req.body.capacity) : undefined;
    const environment = (req.body.environment === 'live' || req.query.environment === 'live') ? 'live'
                      : (req.body.environment === 'test' || req.query.environment === 'test') ? 'test'
                      : undefined;
    const result = runAuthorityPipeline({ capacity, tenantId, environment });
    res.json(result);
  } catch (error) {
    console.error('Failed to execute authority pipeline:', error);
    res.status(500).json({ error: 'Failed to execute authority pipeline' });
  }
});

// POST & GET /authority/evaluate/:id (Evaluates deterministic compliance checks on single opportunity)
const handleEvaluateSingleOpportunity = (req: Request, res: Response): void => {
  try {
    const oppId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!oppId) {
      res.status(400).json({ error: 'Missing opportunity ID' });
      return;
    }

    const tenantId = resolveTenantId(req) || undefined;
    const opp = getOpportunityById(oppId, tenantId);
    if (!opp) {
      res.status(404).json({ error: 'Opportunity not found' });
      return;
    }

    const score = getScoreByOpportunityId(oppId);
    const decision = getAllocationDecisionByOpportunityId(oppId);
    const result = evaluateOpportunity(opp, decision || undefined, score || undefined);
    res.json(result);
  } catch (error: any) {
    console.error('Failed to evaluate opportunity compliance:', error);
    res.status(500).json({ error: error?.message || 'Failed to evaluate opportunity compliance' });
  }
};

authorityRouter.post('/evaluate/:id', handleEvaluateSingleOpportunity);
authorityRouter.get('/evaluate/:id', handleEvaluateSingleOpportunity);
