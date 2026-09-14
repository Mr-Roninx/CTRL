import { Router, Request, Response } from 'express';
import {
  getAllOpportunities,
  getOpportunityById,
  getLedgerEntriesByOpportunity,
  getCustomerById,
  getScoreByOpportunityId,
  getAllocationDecisionByOpportunityId,
  getAuthorityChecksByOpportunityId,
  getExecutionRecordByOpportunityId,
} from '../db/database.js';
import { scoreOpportunity } from '../economics/scorer.js';
import { evaluateOpportunity } from '../authority/gate.js';
import { explainOpportunityDecision } from '../llm/explainer.js';
import { resolveTenantId } from '../security/tenant_guard.js';

export const opportunitiesRouter = Router();

// GET all opportunities
opportunitiesRouter.get('/', (req: Request, res: Response) => {
  try {
    const tenantId = resolveTenantId(req) || undefined;
    const envQuery = req.query.environment as string | undefined;
    const environment = (envQuery === 'live' || envQuery === 'test') ? envQuery : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    let opportunities = getAllOpportunities(tenantId, environment);
    if (limit && limit > 0) {
      opportunities = opportunities.slice(0, limit);
    }
    const enriched = opportunities.map((opp) => {
      const score = getScoreByOpportunityId(opp.id);
      const decision = getAllocationDecisionByOpportunityId(opp.id);
      const execution = getExecutionRecordByOpportunityId(opp.id);
      return {
        ...opp,
        score,
        decision,
        execution,
      };
    });
    res.json({
      count: enriched.length,
      opportunities: enriched,
    });
  } catch (error) {
    console.error('Failed to fetch opportunities:', error);
    res.status(500).json({ error: 'Failed to fetch recovery opportunities' });
  }
});

// POST score all opportunities
opportunitiesRouter.post('/score-all', (req: Request, res: Response) => {
  try {
    const tenantId = resolveTenantId(req) || undefined;
    const opportunities = getAllOpportunities(tenantId);
    const scoredList = opportunities.map((opp) => scoreOpportunity(opp));
    res.json({
      success: true,
      count: scoredList.length,
      scores: scoredList,
    });
  } catch (error) {
    console.error('Failed to score opportunities:', error);
    res.status(500).json({ error: 'Failed to score opportunities' });
  }
});

// GET single opportunity score breakdown (Feature 3 & 7 "Why?" panel data source)
opportunitiesRouter.get('/:id/score', (req: Request, res: Response) => {
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

    let score = getScoreByOpportunityId(oppId);
    if (!score) {
      score = scoreOpportunity(opp);
    }

    res.json({
      opportunity_id: score.opportunity_id,
      amount_paise: opp.amount_paise,
      currency: opp.currency,
      decline_type: opp.decline_type,
      reason_code: opp.reason_code,
      attempt_count: opp.attempt_count,
      natural_recovery_prob: score.natural_recovery_prob,
      intervention_recovery_prob: score.intervention_recovery_prob,
      incremental_prob: score.incremental_prob,
      operational_cost_paise: score.operational_cost_paise,
      fatigue_cost_paise: score.fatigue_cost_paise,
      expected_incremental_value_paise: score.expected_incremental_value_paise,
      confidence: score.confidence,
      _labels: {
        natural_recovery_prob: 'model-estimated',
        intervention_recovery_prob: 'model-estimated',
        incremental_prob: 'model-estimated',
        expected_incremental_value_paise: 'model-estimated',
      },
    });
  } catch (error) {
    console.error('Failed to fetch opportunity score:', error);
    res.status(500).json({ error: 'Failed to fetch opportunity score' });
  }
});

// GET single opportunity authority checklist (Feature 5 & 7 "Why?" screen data source)
opportunitiesRouter.get('/:id/authority', (req: Request, res: Response) => {
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

    let checks = getAuthorityChecksByOpportunityId(oppId);
    let evalVerdict = 'AUTHORIZED';
    let summaryReason = 'all deterministic authority and compliance checks passed';

    if (checks.length === 0) {
      // Evaluate on the fly
      let score = getScoreByOpportunityId(oppId);
      if (!score) score = scoreOpportunity(opp);
      let decision = getAllocationDecisionByOpportunityId(oppId);
      if (!decision) {
        decision = {
          opportunity_id: oppId,
          decision: 'WAIT',
          rank_in_batch: 999,
          shadow_price_paise_at_decision: 0,
          reason: 'Initial unallocated evaluation',
        };
      }
      const evalResult = evaluateOpportunity(opp, decision, score);
      checks = evalResult.checks;
      evalVerdict = evalResult.verdict;
      summaryReason = evalResult.summary_reason;
    } else {
      const hardFail = checks.find((c) => c.check_name === 'hard_decline_check' && !c.passed);
      const retryCapFail = checks.find((c) => c.check_name === 'retry_cap_check' && !c.passed);
      const killSwitchFail = checks.find((c) => c.check_name === 'kill_switch_check' && !c.passed);
      const confidenceFail = checks.find((c) => c.check_name === 'confidence_recheck' && !c.passed);
      const capacityFail = checks.find((c) => c.check_name === 'capacity_recheck' && !c.passed);

      if (hardFail || retryCapFail || killSwitchFail) {
        evalVerdict = 'BLOCKED';
        summaryReason = (hardFail || retryCapFail || killSwitchFail)!.reason;
      } else if (confidenceFail) {
        evalVerdict = 'ABSTAIN';
        summaryReason = confidenceFail.reason;
      } else if (capacityFail) {
        evalVerdict = 'WAIT';
        summaryReason = capacityFail.reason;
      } else {
        evalVerdict = 'AUTHORIZED';
      }
    }

    const allPassed = checks.every((c) => c.passed);

    res.json({
      opportunity_id: opp.id,
      amount_paise: opp.amount_paise,
      currency: opp.currency,
      decline_type: opp.decline_type,
      reason_code: opp.reason_code,
      attempt_count: opp.attempt_count,
      verdict: evalVerdict,
      status: opp.status,
      summary_reason: summaryReason,
      all_passed: allPassed,
      checklist: checks.map((c) => ({
        check_name: c.check_name,
        passed: c.passed,
        symbol: c.passed ? '✓' : '✗',
        reason: c.reason,
      })),
    });
  } catch (error) {
    console.error('Failed to fetch authority checklist:', error);
    res.status(500).json({ error: 'Failed to fetch authority checklist' });
  }
});

// GET single opportunity with full details
opportunitiesRouter.get('/:id', (req: Request, res: Response) => {
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
    const authority_checks = getAuthorityChecksByOpportunityId(oppId);
    const customer = opp.customer_id ? getCustomerById(opp.customer_id, tenantId) : undefined;
    const ledger = getLedgerEntriesByOpportunity(oppId);

    res.json({
      opportunity: opp,
      score,
      decision,
      authority_checks,
      customer,
      ledger,
    });
  } catch (error) {
    console.error('Failed to fetch opportunity:', error);
    res.status(500).json({ error: 'Failed to fetch opportunity' });
  }
});

// GET / POST single opportunity AI explanation (NVIDIA NIM GPT-OSS-120B)
const handleExplainRequest = async (req: Request, res: Response): Promise<void> => {
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

    let score = getScoreByOpportunityId(oppId);
    if (!score) score = scoreOpportunity(opp);

    let decision = getAllocationDecisionByOpportunityId(oppId);
    let checks = getAuthorityChecksByOpportunityId(oppId);

    if (!decision || checks.length === 0) {
      const evalResult = evaluateOpportunity(
        opp,
        decision || {
          opportunity_id: oppId,
          decision: 'WAIT',
          rank_in_batch: 999,
          shadow_price_paise_at_decision: 0,
          reason: 'Unallocated evaluation',
        },
        score
      );
      checks = evalResult.checks;
    }

    const result = await explainOpportunityDecision(opp, score, decision, checks);
    res.json(result);
  } catch (error: any) {
    console.error('Failed to generate opportunity explanation:', error);
    res.status(500).json({ error: error?.message || 'Failed to generate opportunity explanation' });
  }
};

opportunitiesRouter.get('/:id/explain', handleExplainRequest);
opportunitiesRouter.post('/:id/explain', handleExplainRequest);

