import { Router, Request, Response } from 'express';
import {
  getAllAgentRuns,
  getAgentRunById,
  getAgentProposalsByOpportunityId,
  getAllAgentProposals,
  getAllOutreachDrafts,
  updateOutreachDraftStatus,
  getAllAgentOutcomes,
  getMemories,
  getDaemonSweepLogs,
} from '../db/database.js';
import { AutonomousRecoveryDaemon } from '../agents/daemon.js';
import { AgentOrchestrator } from '../agents/orchestrator.js';
import { AgentTelemetry } from '../agents/telemetry.js';
import { AgentToolRegistry } from '../agents/tool_registry.js';
import { ComplianceCopilot } from '../agents/specialists/compliance_copilot.js';
import { MerchantCopilot } from '../agents/specialists/merchant_copilot.js';
import { StrategyAgent } from '../agents/specialists/strategy_agent.js';
import { AgentLearningEngine } from '../agents/learning.js';
import { TraceStreamManager } from '../agents/trace_stream.js';
import { MCPServer } from '../agents/mcp/mcp_server.js';

export const agentsRouter = Router();

// GET all agent runs
agentsRouter.get('/runs', (_req: Request, res: Response) => {
  try {
    const runs = getAllAgentRuns();
    res.json({
      count: runs.length,
      runs,
    });
  } catch (error: any) {
    console.error('Failed to fetch agent runs:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch agent runs' });
  }
});

// ========================================================
// AUTONOMOUS DAEMON CONTROL API
// ========================================================

const daemon = AutonomousRecoveryDaemon.getInstance();

// GET daemon status (/agents/daemon/status & /agents/status)
const handleGetDaemonStatus = (_req: Request, res: Response) => {
  try {
    res.json(daemon.getStatus());
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch daemon status' });
  }
};

agentsRouter.get('/daemon/status', handleGetDaemonStatus);
agentsRouter.get('/status', handleGetDaemonStatus);

// POST start daemon
agentsRouter.post('/daemon/start', (req: Request, res: Response) => {
  try {
    const { interval_seconds, capacity } = req.body;
    daemon.start({ interval_seconds, capacity });
    res.json({ success: true, status: daemon.getStatus() });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to start daemon' });
  }
});

// POST stop daemon
agentsRouter.post('/daemon/stop', (_req: Request, res: Response) => {
  try {
    daemon.stop();
    res.json({ success: true, status: daemon.getStatus() });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to stop daemon' });
  }
});

// POST trigger manual sweep
agentsRouter.post('/daemon/sweep', async (_req: Request, res: Response) => {
  try {
    await daemon.sweepOnce();
    res.json({ success: true, status: daemon.getStatus() });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to run sweep' });
  }
});

// POST update daemon config
agentsRouter.post('/daemon/config', (req: Request, res: Response) => {
  try {
    const { interval_seconds, capacity } = req.body;
    daemon.updateConfig({ interval_seconds, capacity });
    res.json({ success: true, status: daemon.getStatus() });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update config' });
  }
});

// GET daemon activity logs
agentsRouter.get('/daemon/activity', (_req: Request, res: Response) => {
  try {
    const logs = getDaemonSweepLogs(50);
    res.json({ count: logs.length, logs });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch daemon activity logs' });
  }
});


// GET full trace for a single run
agentsRouter.get('/runs/:id/trace', (req: Request, res: Response) => {
  try {
    const runId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!runId) {
      res.status(400).json({ error: 'Missing run ID' });
      return;
    }
    const trace = AgentTelemetry.getMissionTrace(runId);
    res.json(trace);
  } catch (error: any) {
    console.error('Failed to fetch mission trace:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch mission trace' });
  }
});

// POST start recovery mission
agentsRouter.post('/runs/start', async (req: Request, res: Response) => {
  try {
    const { opportunity_id } = req.body;
    if (!opportunity_id) {
      res.status(400).json({ error: 'Missing opportunity_id in request body' });
      return;
    }

    const result = await AgentOrchestrator.executeRecoveryMission({
      opportunityId: opportunity_id,
    });

    res.json({
      success: true,
      result,
    });
  } catch (error: any) {
    console.error('Agent mission failed:', error);
    res.status(500).json({ error: error.message || 'Agent mission execution failed' });
  }
});

// GET tool registry
agentsRouter.get('/tools', (_req: Request, res: Response) => {
  try {
    const tools = AgentToolRegistry.getAllTools().map((t) => ({
      tool_id: t.tool_id,
      agent: t.agent,
      description: t.description,
      permission: t.permission,
      read_only: t.read_only,
      rate_limit_per_min: t.rate_limit_per_min,
      timeout_ms: t.timeout_ms,
      audit_level: t.audit_level,
    }));
    res.json({ count: tools.length, tools });
  } catch (error: any) {
    console.error('Failed to fetch tools:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch tools' });
  }
});

// POST execute tool via gate
agentsRouter.post('/tools/execute', async (req: Request, res: Response) => {
  try {
    const { tool_id, run_id, agent_name, payload } = req.body;
    if (!tool_id) {
      res.status(400).json({ error: 'Missing tool_id' });
      return;
    }

    const result = await AgentToolRegistry.executeTool({
      toolId: tool_id,
      runId: run_id || `manual_${Date.now()}`,
      agentName: agent_name || 'AgentOrchestrator',
      inputPayload: payload || {},
    });

    res.json(result);
  } catch (error: any) {
    console.error('Tool execution error:', error);
    res.status(500).json({ error: error.message || 'Tool execution failed' });
  }
});

// POST compliance copilot explain opportunity
agentsRouter.post('/explain/:opportunityId', async (req: Request, res: Response) => {
  try {
    const oppId = Array.isArray(req.params.opportunityId) ? req.params.opportunityId[0] : req.params.opportunityId;
    if (!oppId) {
      res.status(400).json({ error: 'Missing opportunity ID' });
      return;
    }

    const explanation = await ComplianceCopilot.explainOpportunity({
      runId: `explain_${Date.now()}`,
      opportunityId: oppId,
    });

    res.json(explanation);
  } catch (error: any) {
    console.error('Compliance Copilot error:', error);
    res.status(500).json({ error: error.message || 'Failed to explain opportunity' });
  }
});

// POST merchant copilot query
agentsRouter.post('/merchant/query', async (req: Request, res: Response) => {
  try {
    const { query } = req.body;
    if (!query) {
      res.status(400).json({ error: 'Missing query in request body' });
      return;
    }

    const answer = await MerchantCopilot.answerMerchantQuery({
      runId: `merchant_${Date.now()}`,
      query,
    });

    res.json(answer);
  } catch (error: any) {
    console.error('Merchant Copilot error:', error);
    res.status(500).json({ error: error.message || 'Failed to process merchant query' });
  }
});

// GET memory
agentsRouter.get('/memory', (req: Request, res: Response) => {
  try {
    const type = req.query.type as any;
    const memories = getMemories(type);
    res.json({ count: memories.length, memories });
  } catch (error: any) {
    console.error('Failed to fetch memories:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch memories' });
  }
});

// POST strategy calibration check
agentsRouter.post('/strategy/calibrate', async (_req: Request, res: Response) => {
  try {
    const result = await StrategyAgent.evaluateStrategyCalibration({
      runId: `strat_${Date.now()}`,
    });
    res.json(result);
  } catch (error: any) {
    console.error('Strategy calibration error:', error);
    res.status(500).json({ error: error.message || 'Strategy calibration failed' });
  }
});

// GET outreach drafts
agentsRouter.get('/outreach/drafts', (_req: Request, res: Response) => {
  try {
    const drafts = getAllOutreachDrafts();
    res.json({ count: drafts.length, drafts });
  } catch (error: any) {
    console.error('Failed to fetch outreach drafts:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch outreach drafts' });
  }
});

// POST review outreach draft
agentsRouter.post('/outreach/drafts/:id/review', (req: Request, res: Response) => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const draftId = rawId || '';
    if (!draftId) {
      res.status(400).json({ error: 'Missing draft ID' });
      return;
    }
    const { status, feedback } = req.body;
    if (!['APPROVED', 'REJECTED'].includes(status)) {
      res.status(400).json({ error: 'Status must be APPROVED or REJECTED' });
      return;
    }

    updateOutreachDraftStatus(draftId, status, feedback);
    res.json({ success: true, draft_id: draftId, status });
  } catch (error: any) {
    console.error('Failed to review draft:', error);
    res.status(500).json({ error: error.message || 'Failed to review draft' });
  }
});

// GET high-level metrics
agentsRouter.get('/metrics', (_req: Request, res: Response) => {
  try {
    const runs = getAllAgentRuns();
    const outcomes = getAllAgentOutcomes();
    const proposals = getAllAgentProposals();
    const stats = AgentLearningEngine.getCalibrationStatistics();

    const totalLlm = runs.reduce((sum, r) => sum + r.llm_calls, 0);
    const totalTool = runs.reduce((sum, r) => sum + r.tool_calls, 0);
    const totalReplans = runs.reduce((sum, r) => sum + r.replan_count, 0);

    res.json({
      total_missions: runs.length,
      completed_missions: runs.filter((r) => r.status === 'completed').length,
      aborted_missions: runs.filter((r) => r.status === 'aborted').length,
      total_llm_invocations: totalLlm,
      total_tool_invocations: totalTool,
      total_replans: totalReplans,
      total_proposals: proposals.length,
      calibration_statistics: stats,
    });
  } catch (error: any) {
    console.error('Failed to fetch agent metrics:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch metrics' });
  }
});

// SSE Real-time Trace Streaming (global)
agentsRouter.get('/traces/stream', (req: Request, res: Response) => {
  TraceStreamManager.subscribe(res, 'ALL');
});

// SSE Real-time Trace Streaming (by runId)
agentsRouter.get('/traces/:runId/stream', (req: Request, res: Response) => {
  const runId = String(req.params.runId);
  TraceStreamManager.subscribe(res, runId);
});

// GET recent trace events
agentsRouter.get('/traces/recent', (req: Request, res: Response) => {
  const runId = req.query.run_id ? String(req.query.run_id) : undefined;
  res.json({ events: TraceStreamManager.getRecentEvents(runId) });
});

// POST Model Context Protocol (MCP) JSON-RPC 2.0 endpoint
agentsRouter.post('/mcp', async (req: Request, res: Response) => {
  const response = await MCPServer.handleRequest(req.body);
  res.json(response);
});

