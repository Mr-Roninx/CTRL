import test from 'node:test';
import assert from 'node:assert';
import { AgentLoop } from '../../src/agents/agent_loop.js';
import { ReasoningEngine } from '../../src/agents/reasoning_engine.js';
import { AgentToolRegistry } from '../../src/agents/tool_registry.js';
import { MCPToolsAdapter } from '../../src/agents/mcp/mcp_tools_adapter.js';
import { MCPServer } from '../../src/agents/mcp/mcp_server.js';
import { SpecialistRouter } from '../../src/agents/specialist_router.js';
import { PerceptionAgent } from '../../src/agents/specialists/perception_agent.js';
import { ComplianceCopilot } from '../../src/agents/specialists/compliance_copilot.js';
import { ProviderRouter } from '../../src/agents/llm/providers/provider_router.js';
import { LLMProvider } from '../../src/agents/llm_provider.js';
import { EmbeddingStore } from '../../src/agents/memory/embedding_store.js';
import { AgentMemoryStore } from '../../src/agents/memory.js';
import { HITLManager } from '../../src/agents/hitl/hitl_manager.js';
import { TraceStreamManager } from '../../src/agents/trace_stream.js';
import { AutonomousGoalDecomposer } from '../../src/agents/autonomous/goal_decomposition.js';
import { ProactiveAlertsEngine } from '../../src/agents/autonomous/proactive_alerts.js';
import { insertOpportunity, getOpportunityById, initDatabase } from '../../src/db/database.js';
import { RecoveryOpportunity } from '../../src/types/index.js';

initDatabase();
process.env.CTRL_LLM_ENABLED = 'false';

test('CTRL v6.0 Autonomous AI Agent Architecture', async (t) => {
  // Setup fixture opportunities
  const normalOpp: RecoveryOpportunity = {
    id: `opp_auto_norm_${Date.now()}`,
    source: 'synthetic',
    amount_paise: 450000, // ₹4,500
    currency: 'INR',
    reason_code: 'GATEWAY_TIMEOUT',
    decline_type: 'soft',
    attempt_count: 1,
    customer_id: 'cust_auto_norm_01',
    customer_trust_score: 0.85,
    status: 'pending',
    created_at: new Date().toISOString(),
  };
  insertOpportunity(normalOpp);

  const hardDeclineOpp: RecoveryOpportunity = {
    id: `opp_auto_hard_${Date.now()}`,
    source: 'synthetic',
    amount_paise: 950000, // ₹9,500
    currency: 'INR',
    reason_code: 'STOLEN_CARD',
    decline_type: 'hard',
    attempt_count: 1,
    customer_id: 'cust_auto_hard_02',
    customer_trust_score: 0.15,
    status: 'pending',
    created_at: new Date().toISOString(),
  };
  insertOpportunity(hardDeclineOpp);

  const highTicketOpp: RecoveryOpportunity = {
    id: `opp_auto_vip_${Date.now()}`,
    source: 'synthetic',
    amount_paise: 3500000, // ₹35,000 (exceeds ₹25,000 HITL threshold)
    currency: 'INR',
    reason_code: 'INSUFFICIENT_FUNDS',
    decline_type: 'soft',
    attempt_count: 1,
    customer_id: 'cust_auto_vip_03',
    customer_trust_score: 0.90,
    status: 'pending',
    created_at: new Date().toISOString(),
  };
  insertOpportunity(highTicketOpp);

  await t.test('Phase 1: Agent Loop & Reasoning Engine executes iterative cycle', async () => {
    const runId = `run_test_loop_${Date.now()}`;
    const loop = new AgentLoop(runId, { max_steps: 25, max_tools: 10 });

    const result = await loop.run({
      opportunityId: normalOpp.id,
      environment: 'SYNTHETIC',
    });

    assert.ok(result);
    assert.strictEqual(result.opportunity_id, normalOpp.id);
    assert.ok(['completed', 'aborted', 'budget_exceeded'].includes(result.status));
    assert.ok(['ACT', 'WAIT', 'ABSTAIN'].includes(result.final_decision));
    assert.ok(result.iterations_executed >= 1);
    assert.ok(result.reasoning_trace.length >= 1);

    // Hard decline invariant: MUST resolve to ABSTAIN
    const hardLoop = new AgentLoop(`run_test_hard_${Date.now()}`);
    const hardResult = await hardLoop.run({
      opportunityId: hardDeclineOpp.id,
      environment: 'SYNTHETIC',
    });
    assert.strictEqual(hardResult.final_decision, 'ABSTAIN');
  });

  await t.test('Phase 2: MCP Tool Architecture & Investigation Tools', async () => {
    // 1. Tool adapter verification
    const allTools = AgentToolRegistry.getAllTools();
    const mcpTools = MCPToolsAdapter.toMCPTools(allTools);
    assert.ok(mcpTools.length >= 10);
    const networkTool = mcpTools.find((t) => t.name === 'check_card_network_status');
    assert.ok(networkTool);
    assert.strictEqual(networkTool.inputSchema.type, 'object');

    // 2. MCP JSON-RPC Server
    const initRes = await MCPServer.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
    });
    assert.strictEqual(initRes.result.serverInfo.name, 'ctrl-autonomous-agent');

    const toolsRes = await MCPServer.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });
    assert.ok(Array.isArray(toolsRes.result.tools));
    assert.ok(toolsRes.result.tools.length >= 10);

    // 3. Tool execution via MCP
    const callRes = await MCPServer.handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'check_card_network_status',
        arguments: { network: 'VISA', bank_code: 'HDFC' },
      },
    });
    assert.ok(!callRes.error);
    assert.ok(!callRes.result.isError);
    assert.ok(callRes.result.content[0].text.includes('OPERATIONAL'));
  });

  await t.test('Phase 3: Specialist Router & Enhanced Domain Specialists', async () => {
    // 1. Perception Agent bank translation & temporal analysis
    const translation = PerceptionAgent.translateBankDeclineCode('DECLINE_05');
    assert.strictEqual(translation.normalized_reason, 'INSUFFICIENT_FUNDS');
    assert.strictEqual(translation.category, 'INSUFFICIENT_FUNDS');

    const temporal = PerceptionAgent.extractTemporalSignals();
    assert.ok(typeof temporal.is_salary_window === 'boolean');
    assert.ok(typeof temporal.liquidity_multiplier === 'number');

    // 2. Compliance pre-check
    const hardCheck = ComplianceCopilot.checkPreExecutionCompliance(hardDeclineOpp);
    assert.strictEqual(hardCheck.can_proceed, false);
    assert.strictEqual(hardCheck.hard_decline_blocked, true);

    // 3. Multi-agent coordination via SpecialistRouter
    const ensemble = await SpecialistRouter.coordinateSpecialists({
      runId: `run_router_${Date.now()}`,
      opportunity: normalOpp,
    });
    assert.ok(ensemble);
    assert.strictEqual(ensemble.opportunity_id, normalOpp.id);
    assert.ok(['ACT', 'WAIT', 'ABSTAIN'].includes(ensemble.ensemble_action_recommendation));

    // Hard decline coordination MUST override to ABSTAIN
    const hardEnsemble = await SpecialistRouter.coordinateSpecialists({
      runId: `run_router_hard_${Date.now()}`,
      opportunity: hardDeclineOpp,
    });
    assert.strictEqual(hardEnsemble.ensemble_action_recommendation, 'ABSTAIN');
  });

  await t.test('Phase 4: Multi-Provider LLM Routing & Fallback Cascade', async () => {
    const orderDiag = ProviderRouter.getProviderOrder('DIAGNOSIS');
    assert.deepStrictEqual(orderDiag, ['claude', 'gemini', 'openai', 'nvidia']);

    const orderPercept = ProviderRouter.getProviderOrder('PERCEPTION');
    assert.deepStrictEqual(orderPercept, ['gemini', 'openai', 'claude', 'nvidia']);

    // When external keys are absent, fallback gracefully to deterministic policy
    const intentResult = await LLMProvider.generateAgentIntent({
      runId: `run_llm_${Date.now()}`,
      opportunityId: normalOpp.id,
      context: {
        opportunity: normalOpp,
        customer_trust_score: 0.85,
        gateway_health: 0.98,
        prior_observations: [],
        memory_fragments: [],
      },
    });
    assert.ok(intentResult.success);
    assert.ok(intentResult.intent);
    assert.ok(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(intentResult.intent.diagnosis.severity));
  });

  await t.test('Phase 5: Vector Memory & Cosine Similarity Search', async () => {
    EmbeddingStore.clear();

    // Add documents
    EmbeddingStore.addDocument('doc_1', 'HDFC gateway timeout debit card switch latency', { tag: 'gateway' });
    EmbeddingStore.addDocument('doc_2', 'Insufficient balance salary crediting end of month', { tag: 'funds' });
    EmbeddingStore.addDocument('doc_3', 'Fraud stop stolen card security freeze', { tag: 'fraud' });

    assert.strictEqual(EmbeddingStore.count(), 3);

    // Search similar
    const search1 = EmbeddingStore.searchSimilar('HDFC network timeout error', 2);
    assert.ok(search1.length > 0);
    assert.strictEqual(search1[0].id, 'doc_1');
    assert.ok(search1[0].similarity > 0.4);

    // Search via AgentMemoryStore
    AgentMemoryStore.recordEpisode({
      runId: `run_ep_${Date.now()}`,
      opportunityId: normalOpp.id,
      failureType: 'GATEWAY_TIMEOUT',
      summary: 'Payment recovered using WhatsApp retry link within 15 minutes',
      actionTaken: 'SEND_PAYMENT_LINK',
      predictedOutcome: 'HIGH',
      actualOutcome: 'SUCCESS',
      provenance: 'unit_test',
    });

    const memoryMatches = AgentMemoryStore.searchSimilarMemories({
      query: 'WhatsApp retry link recovery',
      topK: 3,
    });
    assert.ok(memoryMatches.length > 0);
  });

  await t.test('Phase 6: Human-in-the-Loop (HITL) Approval Workflow', async () => {
    // 1. Trigger evaluation
    const reviewReq = HITLManager.shouldRequireReview(highTicketOpp, 0.9);
    assert.strictEqual(reviewReq.requires_review, true);
    assert.strictEqual(reviewReq.reason, 'HIGH_TICKET_VALUE');

    // 2. Create review request
    const hitlReq = HITLManager.createRequest({
      opportunity: highTicketOpp,
      proposedAction: 'ACT',
      reason: reviewReq.reason!,
      explanation: reviewReq.explanation!,
    });
    assert.strictEqual(hitlReq.status, 'PENDING');
    assert.strictEqual(hitlReq.amount_paise, 3500000);

    // 3. Resolve request with operator approval
    const resolveRes = HITLManager.resolveRequest({
      requestId: hitlReq.id,
      decision: 'APPROVE',
      operatorId: 'merchant_finance_officer',
      feedback: 'Approved for VIP recovery with customized payment link',
    });
    assert.strictEqual(resolveRes.success, true);
    assert.strictEqual(resolveRes.request?.status, 'APPROVED');
    assert.strictEqual(resolveRes.request?.operator_id, 'merchant_finance_officer');
  });

  await t.test('Phase 7: Real-Time Trace Streaming Engine', async () => {
    const testRunId = `run_stream_${Date.now()}`;
    let receivedEvent = false;

    // Fake SSE response mock
    const fakeRes: any = {
      setHeader: () => {},
      flushHeaders: () => {},
      write: (chunk: string) => {
        if (chunk.includes('TEST_STEP_EXECUTED')) {
          receivedEvent = true;
        }
      },
      on: () => {},
    };

    const cleanup = TraceStreamManager.subscribe(fakeRes, testRunId);

    TraceStreamManager.broadcast({
      run_id: testRunId,
      event_type: 'AGENT_STEP',
      payload: { note: 'TEST_STEP_EXECUTED', step: 1 },
    });

    assert.strictEqual(receivedEvent, true);
    cleanup();
  });

  await t.test('Phase 8: Autonomous Goal Decomposition & Proactive Alerts', async () => {
    // 1. Goal decomposition
    const plan = AutonomousGoalDecomposer.decomposeGoal('MAXIMIZE_RECOVERED_REVENUE', 5);
    assert.ok(plan.goal_id);
    assert.strictEqual(plan.capacity_limit, 5);
    assert.strictEqual(plan.tasks.length, 5);
    assert.strictEqual(plan.tasks[0].stage_name, 'OPPORTUNITY_DISCOVERY');

    // 2. Proactive alert generation
    const alerts = ProactiveAlertsEngine.generateAlerts();
    assert.ok(Array.isArray(alerts));
    assert.ok(alerts.length >= 1);
    const alert = alerts[0];
    assert.ok(['INFO', 'WARNING', 'CRITICAL'].includes(alert.severity));
    assert.ok(alert.title.length > 0);
    assert.ok(alert.actionable_recommendation.length > 0);
  });
});
