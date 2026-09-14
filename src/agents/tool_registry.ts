import crypto from 'node:crypto';
import { SpecialistAgentName, ToolPermission } from './types.js';
import { AgentAuthorityGate } from './gate.js';
import { AgentTelemetry } from './telemetry.js';
import { MissionBudgetTracker } from './budget.js';
import { LoopGuard } from './loop_guard.js';
import * as readTools from './tools/read_tools.js';
import * as proposalTools from './tools/proposal_tools.js';
import { InvestigationTools } from './tools/investigation_tools.js';
import { MCPToolsAdapter } from './mcp/mcp_tools_adapter.js';
import { MCPTool } from './mcp/mcp_types.js';

export interface ToolDefinition {
  tool_id: string;
  agent: SpecialistAgentName | 'ALL';
  description: string;
  input_schema: Record<string, any>;
  output_schema: Record<string, any>;
  permission: ToolPermission;
  read_only: boolean;
  rate_limit_per_min: number;
  timeout_ms: number;
  audit_level: 'STANDARD' | 'HIGH' | 'CRITICAL';
  handler: (params: any, ctx?: any) => Promise<any>;
}

export class AgentToolRegistry {
  private static tools: Map<string, ToolDefinition> = new Map();

  public static registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.tool_id, tool);
  }

  public static getTool(toolId: string): ToolDefinition | undefined {
    return this.tools.get(toolId);
  }

  public static getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public static getToolsForAgent(agentName: SpecialistAgentName): ToolDefinition[] {
    return Array.from(this.tools.values()).filter(
      (t) => t.agent === 'ALL' || t.agent === agentName
    );
  }

  /**
   * Export all registered tools formatted as Model Context Protocol (MCP) tools.
   */
  public static toMCPTools(): MCPTool[] {
    return MCPToolsAdapter.toMCPTools(this.getAllTools());
  }

  /**
   * Register a tool using an MCP tool definition and handler.
   */
  public static registerMCPTool(
    mcpTool: MCPTool,
    handler: (params: any, ctx?: any) => Promise<any>,
    options?: Partial<ToolDefinition>
  ): void {
    this.registerTool({
      tool_id: mcpTool.name,
      agent: options?.agent ?? 'ALL',
      description: mcpTool.description ?? mcpTool.name,
      input_schema: mcpTool.inputSchema,
      output_schema: options?.output_schema ?? { type: 'object' },
      permission: options?.permission ?? 'READ',
      read_only: options?.read_only ?? true,
      rate_limit_per_min: options?.rate_limit_per_min ?? 60,
      timeout_ms: options?.timeout_ms ?? 3000,
      audit_level: options?.audit_level ?? 'STANDARD',
      handler,
    });
  }

  /**
   * Dispatches a tool execution with mandatory AgentAuthorityGate evaluation and telemetry recording.
   */
  public static async executeTool(params: {
    toolId: string;
    runId: string;
    agentName: SpecialistAgentName;
    inputPayload: Record<string, any>;
    budgetTracker?: MissionBudgetTracker;
    loopGuard?: LoopGuard;
    environment?: 'SYNTHETIC' | 'FIXTURE' | 'RAZORPAY_TEST' | 'PROVIDER_VERIFIED';
  }): Promise<{ success: boolean; data?: any; error?: string; denied?: boolean; latency_ms: number }> {
    const startTime = Date.now();
    const toolCallId = `tc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const tool = this.getTool(params.toolId);

    if (!tool) {
      const err = `Tool '${params.toolId}' is not registered in the AgentToolRegistry.`;
      AgentTelemetry.logToolCall({
        id: toolCallId,
        runId: params.runId,
        toolName: params.toolId,
        agentName: params.agentName,
        inputPayload: params.inputPayload,
        outputPayload: { error: err },
        status: 'FAILED',
        latencyMs: Date.now() - startTime,
        errorMessage: err,
        permissionLevel: 'READ',
      });
      return { success: false, error: err, latency_ms: Date.now() - startTime };
    }

    // 1. Mandatory Authority Gate Evaluation
    const gateVerdict = AgentAuthorityGate.evaluate({
      runId: params.runId,
      agentName: params.agentName,
      toolName: tool.tool_id,
      inputPayload: params.inputPayload,
      permissionLevel: tool.permission,
      budgetTracker: params.budgetTracker,
      loopGuard: params.loopGuard,
      environment: params.environment,
    });

    if (!gateVerdict.allowed) {
      const denyMsg = `Agent Authority Gate DENIED execution: ${gateVerdict.reason} (failed check: ${gateVerdict.failed_check})`;
      AgentTelemetry.logToolCall({
        id: toolCallId,
        runId: params.runId,
        toolName: tool.tool_id,
        agentName: params.agentName,
        inputPayload: params.inputPayload,
        outputPayload: { verdict: 'DENIED', reason: gateVerdict.reason },
        status: 'DENIED',
        latencyMs: Date.now() - startTime,
        errorMessage: denyMsg,
        permissionLevel: tool.permission,
      });

      if (params.loopGuard) {
        params.loopGuard.recordToolExecution(tool.tool_id, params.inputPayload, false);
      }

      return {
        success: false,
        denied: true,
        error: denyMsg,
        latency_ms: Date.now() - startTime,
      };
    }

    // Record tool call in budget tracker
    if (params.budgetTracker) {
      params.budgetTracker.recordToolCall();
    }

    // 2. Execute Handler with timeout
    try {
      const handlerPromise = tool.handler(params.inputPayload, { runId: params.runId, agentName: params.agentName });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Tool execution timeout after ${tool.timeout_ms}ms`)), tool.timeout_ms)
      );

      const result: any = await Promise.race([handlerPromise, timeoutPromise]);
      const latencyMs = Date.now() - startTime;

      AgentTelemetry.logToolCall({
        id: toolCallId,
        runId: params.runId,
        toolName: tool.tool_id,
        agentName: params.agentName,
        inputPayload: params.inputPayload,
        outputPayload: result,
        status: result?.success !== false ? 'SUCCESS' : 'FAILED',
        latencyMs,
        errorMessage: result?.error || null,
        permissionLevel: tool.permission,
      });

      if (params.loopGuard) {
        params.loopGuard.recordToolExecution(tool.tool_id, params.inputPayload, result?.success !== false);
      }

      return {
        success: result?.success !== false,
        data: result?.data || result,
        error: result?.error,
        latency_ms: latencyMs,
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      const errorMsg = err?.message || 'Tool execution encountered an unexpected error';

      AgentTelemetry.logToolCall({
        id: toolCallId,
        runId: params.runId,
        toolName: tool.tool_id,
        agentName: params.agentName,
        inputPayload: params.inputPayload,
        outputPayload: { error: errorMsg },
        status: 'FAILED',
        latencyMs,
        errorMessage: errorMsg,
        permissionLevel: tool.permission,
      });

      if (params.loopGuard) {
        params.loopGuard.recordToolExecution(tool.tool_id, params.inputPayload, false);
      }

      return {
        success: false,
        error: errorMsg,
        latency_ms: latencyMs,
      };
    }
  }
}

// ========================================================
// INITIALIZE & REGISTER ALL TOOLS
// ========================================================

// 1. Read-Only Tools
AgentToolRegistry.registerTool({
  tool_id: 'get_opportunity',
  agent: 'ALL',
  description: 'Retrieve raw details of a single recovery opportunity by ID',
  input_schema: { type: 'object', properties: { opportunity_id: { type: 'string' } }, required: ['opportunity_id'] },
  output_schema: { type: 'object' },
  permission: 'READ',
  read_only: true,
  rate_limit_per_min: 60,
  timeout_ms: 3000,
  audit_level: 'STANDARD',
  handler: readTools.getOpportunityTool,
});

AgentToolRegistry.registerTool({
  tool_id: 'get_payment_context',
  agent: 'ALL',
  description: 'Retrieve full joined context including scores, decisions, checks, and execution status',
  input_schema: { type: 'object', properties: { opportunity_id: { type: 'string' } }, required: ['opportunity_id'] },
  output_schema: { type: 'object' },
  permission: 'READ',
  read_only: true,
  rate_limit_per_min: 60,
  timeout_ms: 3000,
  audit_level: 'STANDARD',
  handler: readTools.getPaymentContextTool,
});

AgentToolRegistry.registerTool({
  tool_id: 'get_customer_history',
  agent: 'ALL',
  description: 'Retrieve customer trust score and historical payment recovery performance',
  input_schema: { type: 'object', properties: { customer_id: { type: 'string' } }, required: ['customer_id'] },
  output_schema: { type: 'object' },
  permission: 'READ',
  read_only: true,
  rate_limit_per_min: 60,
  timeout_ms: 3000,
  audit_level: 'STANDARD',
  handler: readTools.getCustomerHistoryTool,
});

AgentToolRegistry.registerTool({
  tool_id: 'get_payment_attempts',
  agent: 'ALL',
  description: 'Inspect attempt count, retry cap status, and decline history for an opportunity',
  input_schema: { type: 'object', properties: { opportunity_id: { type: 'string' } }, required: ['opportunity_id'] },
  output_schema: { type: 'object' },
  permission: 'READ',
  read_only: true,
  rate_limit_per_min: 60,
  timeout_ms: 3000,
  audit_level: 'STANDARD',
  handler: readTools.getPaymentAttemptsTool,
});

AgentToolRegistry.registerTool({
  tool_id: 'get_failure_history',
  agent: 'ALL',
  description: 'Aggregate historical recovery statistics grouped by decline reason code and category',
  input_schema: { type: 'object', properties: { reason_code: { type: 'string' }, decline_type: { type: 'string' } } },
  output_schema: { type: 'object' },
  permission: 'READ',
  read_only: true,
  rate_limit_per_min: 60,
  timeout_ms: 3000,
  audit_level: 'STANDARD',
  handler: readTools.getFailureHistoryTool,
});

AgentToolRegistry.registerTool({
  tool_id: 'get_gateway_state',
  agent: 'ALL',
  description: 'Inspect Razorpay gateway latency, method success rates, and availability',
  input_schema: { type: 'object', properties: {} },
  output_schema: { type: 'object' },
  permission: 'READ',
  read_only: true,
  rate_limit_per_min: 60,
  timeout_ms: 3000,
  audit_level: 'STANDARD',
  handler: readTools.getGatewayStateTool,
});

AgentToolRegistry.registerTool({
  tool_id: 'get_contact_history',
  agent: 'ALL',
  description: 'Check previous notifications sent to customer and evaluate contact fatigue level',
  input_schema: { type: 'object', properties: { customer_id: { type: 'string' } }, required: ['customer_id'] },
  output_schema: { type: 'object' },
  permission: 'READ',
  read_only: true,
  rate_limit_per_min: 60,
  timeout_ms: 3000,
  audit_level: 'STANDARD',
  handler: readTools.getContactHistoryTool,
});

AgentToolRegistry.registerTool({
  tool_id: 'get_market_state',
  agent: 'ALL',
  description: 'Inspect portfolio recovery market capacity, allocation distribution, and shadow price',
  input_schema: { type: 'object', properties: {} },
  output_schema: { type: 'object' },
  permission: 'READ',
  read_only: true,
  rate_limit_per_min: 60,
  timeout_ms: 3000,
  audit_level: 'STANDARD',
  handler: readTools.getMarketStateTool,
});

AgentToolRegistry.registerTool({
  tool_id: 'get_recovery_capacity',
  agent: 'ALL',
  description: 'Retrieve current batch capacity cap and remaining links available in batch quota',
  input_schema: { type: 'object', properties: {} },
  output_schema: { type: 'object' },
  permission: 'READ',
  read_only: true,
  rate_limit_per_min: 60,
  timeout_ms: 3000,
  audit_level: 'STANDARD',
  handler: readTools.getRecoveryCapacityTool,
});

AgentToolRegistry.registerTool({
  tool_id: 'get_reconciliation_state',
  agent: 'ALL',
  description: 'Check payment link reconciliation status and ledger event sequence',
  input_schema: { type: 'object', properties: { opportunity_id: { type: 'string' } }, required: ['opportunity_id'] },
  output_schema: { type: 'object' },
  permission: 'READ',
  read_only: true,
  rate_limit_per_min: 60,
  timeout_ms: 3000,
  audit_level: 'STANDARD',
  handler: readTools.getReconciliationStateTool,
});

AgentToolRegistry.registerTool({
  tool_id: 'get_provider_status',
  agent: 'ALL',
  description: 'Inspect Razorpay Test Mode reachability, operational status, and mode',
  input_schema: { type: 'object', properties: {} },
  output_schema: { type: 'object' },
  permission: 'READ',
  read_only: true,
  rate_limit_per_min: 60,
  timeout_ms: 3000,
  audit_level: 'STANDARD',
  handler: readTools.getProviderStatusTool,
});

AgentToolRegistry.registerTool({
  tool_id: 'get_full_audit_trail',
  agent: 'ALL',
  description: 'Retrieve immutable, durable SQLite audit records for an opportunity',
  input_schema: { type: 'object', properties: { opportunity_id: { type: 'string' } }, required: ['opportunity_id'] },
  output_schema: { type: 'object' },
  permission: 'READ',
  read_only: true,
  rate_limit_per_min: 60,
  timeout_ms: 3000,
  audit_level: 'HIGH',
  handler: readTools.getFullAuditTrailTool,
});

AgentToolRegistry.registerTool({
  tool_id: 'get_similar_cases',
  agent: 'ALL',
  description: 'Find similar past recovery opportunities by decline taxonomy and amount band',
  input_schema: { type: 'object', properties: { decline_type: { type: 'string' }, base_amount_paise: { type: 'number' } }, required: ['decline_type'] },
  output_schema: { type: 'object' },
  permission: 'READ',
  read_only: true,
  rate_limit_per_min: 60,
  timeout_ms: 3000,
  audit_level: 'STANDARD',
  handler: readTools.getSimilarCasesTool,
});

AgentToolRegistry.registerTool({
  tool_id: 'get_agent_memory',
  agent: 'ALL',
  description: 'Retrieve episodic or semantic memories created at or before the current timestamp',
  input_schema: { type: 'object', properties: { query_type: { type: 'string' }, failure_type: { type: 'string' }, semantic_key: { type: 'string' } } },
  output_schema: { type: 'object' },
  permission: 'READ',
  read_only: true,
  rate_limit_per_min: 60,
  timeout_ms: 3000,
  audit_level: 'STANDARD',
  handler: readTools.getAgentMemoryTool,
});

// 2. Proposal Tools
AgentToolRegistry.registerTool({
  tool_id: 'create_agent_proposal',
  agent: 'ALL',
  description: 'Submit an intervention or parameter update proposal to the agent bus (does not execute)',
  input_schema: { type: 'object', properties: { run_id: { type: 'string' }, opportunity_id: { type: 'string' }, proposal_type: { type: 'string' }, payload: { type: 'object' } }, required: ['run_id', 'opportunity_id', 'proposal_type', 'payload'] },
  output_schema: { type: 'object' },
  permission: 'PROPOSE',
  read_only: false,
  rate_limit_per_min: 30,
  timeout_ms: 3000,
  audit_level: 'HIGH',
  handler: proposalTools.createAgentProposalTool,
});

AgentToolRegistry.registerTool({
  tool_id: 'create_perception_annotation',
  agent: 'PerceptionAgent',
  description: 'Attach rich semantic annotations and urgency scores to an opportunity (does not mutate decline taxonomy)',
  input_schema: { type: 'object', properties: { opportunity_id: { type: 'string' }, failure_intent: { type: 'string' }, customer_urgency_score: { type: 'number' }, merchant_risk_score: { type: 'number' }, semantic_notes: { type: 'string' }, confidence: { type: 'number' } }, required: ['opportunity_id', 'failure_intent'] },
  output_schema: { type: 'object' },
  permission: 'PROPOSE',
  read_only: false,
  rate_limit_per_min: 30,
  timeout_ms: 3000,
  audit_level: 'STANDARD',
  handler: proposalTools.createPerceptionAnnotationTool,
});

AgentToolRegistry.registerTool({
  tool_id: 'create_strategy_proposal',
  agent: 'StrategyAgent',
  description: 'Propose calibrated probability or allocator modifications based on >= 30 real outcomes',
  input_schema: { type: 'object', properties: { run_id: { type: 'string' }, opportunity_id: { type: 'string' }, empirical_sample_size: { type: 'number' }, justification: { type: 'string' } }, required: ['run_id', 'opportunity_id', 'empirical_sample_size', 'justification'] },
  output_schema: { type: 'object' },
  permission: 'PROPOSE',
  read_only: false,
  rate_limit_per_min: 15,
  timeout_ms: 3000,
  audit_level: 'CRITICAL',
  handler: proposalTools.createStrategyProposalTool,
});

AgentToolRegistry.registerTool({
  tool_id: 'create_outreach_draft',
  agent: 'OutreachAgent',
  description: 'Draft a compliant recovery notification for human operator review (status PENDING_REVIEW)',
  input_schema: { type: 'object', properties: { run_id: { type: 'string' }, opportunity_id: { type: 'string' }, channel: { type: 'string' }, recipient: { type: 'string' }, body: { type: 'string' } }, required: ['run_id', 'opportunity_id', 'channel', 'recipient', 'body'] },
  output_schema: { type: 'object' },
  permission: 'PROPOSE',
  read_only: false,
  rate_limit_per_min: 30,
  timeout_ms: 3000,
  audit_level: 'HIGH',
  handler: proposalTools.createOutreachDraftTool,
});

// 3. Autonomous Investigation Tools
AgentToolRegistry.registerTool({
  tool_id: 'check_card_network_status',
  agent: 'ALL',
  description: 'Query card network rails (Visa/Mastercard/RuPay) and bank health for outage/latency spikes',
  input_schema: {
    type: 'object',
    properties: {
      network: { type: 'string', enum: ['VISA', 'MASTERCARD', 'RUPAY', 'UNKNOWN'] },
      bank_code: { type: 'string' },
    },
  },
  output_schema: { type: 'object' },
  permission: 'READ',
  read_only: true,
  rate_limit_per_min: 60,
  timeout_ms: 3000,
  audit_level: 'STANDARD',
  handler: (params) => InvestigationTools.checkCardNetworkStatus(params),
});

AgentToolRegistry.registerTool({
  tool_id: 'query_customer_interaction_history',
  agent: 'ALL',
  description: 'Inspect previous recovery interactions, channel reachability, and fatigue signals for a customer',
  input_schema: {
    type: 'object',
    properties: {
      customer_id: { type: 'string' },
    },
    required: ['customer_id'],
  },
  output_schema: { type: 'object' },
  permission: 'READ',
  read_only: true,
  rate_limit_per_min: 60,
  timeout_ms: 3000,
  audit_level: 'STANDARD',
  handler: (params) => InvestigationTools.queryCustomerInteractionHistory(params),
});

AgentToolRegistry.registerTool({
  tool_id: 'simulate_retry_window',
  agent: 'ALL',
  description: 'Simulate recovery probabilities across future time windows (t+15m, t+1h, t+4h, t+24h) to determine optimal retry timing',
  input_schema: {
    type: 'object',
    properties: {
      opportunity_id: { type: 'string' },
      reason_code: { type: 'string' },
      amount_paise: { type: 'number' },
    },
    required: ['opportunity_id'],
  },
  output_schema: { type: 'object' },
  permission: 'READ',
  read_only: true,
  rate_limit_per_min: 45,
  timeout_ms: 3000,
  audit_level: 'STANDARD',
  handler: (params) => InvestigationTools.simulateRetryWindow(params),
});

AgentToolRegistry.registerTool({
  tool_id: 'calculate_optimal_discount',
  agent: 'ALL',
  description: 'Simulate whether offering a temporary recovery incentive discount increases expected IVEN net of margin loss',
  input_schema: {
    type: 'object',
    properties: {
      opportunity_id: { type: 'string' },
      amount_paise: { type: 'number' },
      customer_trust_score: { type: 'number' },
    },
    required: ['opportunity_id'],
  },
  output_schema: { type: 'object' },
  permission: 'READ',
  read_only: true,
  rate_limit_per_min: 30,
  timeout_ms: 3000,
  audit_level: 'STANDARD',
  handler: (params) => InvestigationTools.calculateOptimalDiscount(params),
});

AgentToolRegistry.registerTool({
  tool_id: 'evaluate_customer_risk_profile',
  agent: 'ALL',
  description: 'Perform multi-factor risk assessment combining trust score, transaction velocity, and chargeback potential',
  input_schema: {
    type: 'object',
    properties: {
      customer_id: { type: 'string' },
      amount_paise: { type: 'number' },
    },
    required: ['customer_id'],
  },
  output_schema: { type: 'object' },
  permission: 'READ',
  read_only: true,
  rate_limit_per_min: 60,
  timeout_ms: 3000,
  audit_level: 'STANDARD',
  handler: (params) => InvestigationTools.evaluateCustomerRiskProfile(params),
});

