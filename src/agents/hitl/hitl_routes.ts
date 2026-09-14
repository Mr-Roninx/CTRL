import { Router, Request, Response } from 'express';
import { HITLManager } from './hitl_manager.js';
import { getOpportunityById } from '../../db/database.js';

export const hitlRouter = Router();

// GET all requests or filter by ?status=
hitlRouter.get('/', (req: Request, res: Response) => {
  try {
    const status = req.query.status as string;
    let requests = HITLManager.getAllRequests();
    if (status) {
      requests = requests.filter((r) => r.status.toUpperCase() === status.toUpperCase());
    }
    res.json({
      total: requests.length,
      requests,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to list HITL requests' });
  }
});

// GET request by ID
hitlRouter.get('/:id', (req: Request, res: Response) => {
  try {
    const reqId = String(req.params.id);
    const request = HITLManager.getRequestById(reqId);
    if (!request) {
      return res.status(404).json({ error: `HITL request '${reqId}' not found` });
    }
    res.json(request);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch HITL request' });
  }
});

// POST approve
hitlRouter.post('/:id/approve', (req: Request, res: Response) => {
  try {
    const { operator_id, feedback } = req.body;
    const operator = (req as any).user?.userId || (req as any).user?.email || operator_id || 'merchant_admin';
    const result = HITLManager.resolveRequest({
      requestId: String(req.params.id),
      decision: 'APPROVE',
      operatorId: operator,
      feedback,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ message: 'Request approved successfully', request: result.request });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Approval failed' });
  }
});

// POST reject
hitlRouter.post('/:id/reject', (req: Request, res: Response) => {
  try {
    const { operator_id, feedback } = req.body;
    const operator = (req as any).user?.userId || (req as any).user?.email || operator_id || 'merchant_admin';
    const result = HITLManager.resolveRequest({
      requestId: String(req.params.id),
      decision: 'REJECT',
      operatorId: operator,
      feedback: feedback || 'Rejected by merchant operator',
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ message: 'Request rejected successfully', request: result.request });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Rejection failed' });
  }
});

// POST override
hitlRouter.post('/:id/override', (req: Request, res: Response) => {
  try {
    const { operator_id, overridden_action, feedback } = req.body;
    const operator = (req as any).user?.userId || (req as any).user?.email || operator_id || 'merchant_admin';

    if (!['ACT', 'WAIT', 'ABSTAIN'].includes(overridden_action)) {
      return res.status(400).json({
        error: 'Invalid overridden_action. Must be ACT, WAIT, or ABSTAIN.',
      });
    }

    const result = HITLManager.resolveRequest({
      requestId: String(req.params.id),
      decision: 'OVERRIDE',
      operatorId: operator,
      feedback,
      overriddenAction: overridden_action,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ message: 'Request overridden successfully', request: result.request });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Override failed' });
  }
});

// POST evaluate opportunity for HITL requirement
hitlRouter.post('/evaluate', (req: Request, res: Response) => {
  try {
    const { opportunity_id, confidence } = req.body;
    if (!opportunity_id) {
      return res.status(400).json({ error: 'opportunity_id is required' });
    }

    const opp = getOpportunityById(opportunity_id);
    if (!opp) {
      return res.status(404).json({ error: `Opportunity '${opportunity_id}' not found` });
    }

    const evaluation = HITLManager.shouldRequireReview(opp, confidence ?? 0.8);
    res.json({
      opportunity_id,
      ...evaluation,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Evaluation failed' });
  }
});
