import { AgentToolRegistry } from '../tool_registry.js';
import { MCPToolsAdapter } from './mcp_tools_adapter.js';
import {
  JSONRPCRequest,
  JSONRPCResponse,
  MCPErrorCode,
  MCPServerInfo,
  MCPResource,
  MCPPrompt,
} from './mcp_types.js';
import { getAllOpportunities, getAllAgentRuns, getAllAgentOutcomes, getAllScores } from '../../db/database.js';
import { isKillSwitchActive } from '../../authority/gate.js';
import { SpecialistAgentName } from '../types.js';

/**
 * CTRL Model Context Protocol (MCP) Server
 * Exposes CTRL agent tools, resources, and reasoning prompts over JSON-RPC 2.0.
 */
export class MCPServer {
  private static serverInfo: MCPServerInfo = {
    name: 'ctrl-autonomous-agent',
    version: '6.0.0',
    capabilities: {
      tools: { listChanged: false },
      resources: { subscribe: false, listChanged: false },
      prompts: { listChanged: false },
    },
  };

  /**
   * Main JSON-RPC 2.0 dispatcher.
   */
  public static async handleRequest(req: JSONRPCRequest): Promise<JSONRPCResponse> {
    if (!req || req.jsonrpc !== '2.0' || !req.method) {
      return {
        jsonrpc: '2.0',
        id: req?.id ?? null,
        error: {
          code: MCPErrorCode.InvalidRequest,
          message: 'Invalid JSON-RPC 2.0 request envelope.',
        },
      };
    }

    try {
      switch (req.method) {
        case 'initialize':
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: {
              protocolVersion: '2024-11-05',
              serverInfo: this.serverInfo,
              capabilities: this.serverInfo.capabilities,
            },
          };

        case 'ping':
          return { jsonrpc: '2.0', id: req.id, result: {} };

        // ── Tools ──
        case 'tools/list': {
          const tools = AgentToolRegistry.getAllTools();
          const mcpTools = MCPToolsAdapter.toMCPTools(tools);
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: { tools: mcpTools },
          };
        }

        case 'tools/call': {
          const toolName = req.params?.name;
          const toolArgs = req.params?.arguments ?? {};

          if (!toolName || typeof toolName !== 'string') {
            return {
              jsonrpc: '2.0',
              id: req.id,
              error: {
                code: MCPErrorCode.InvalidParams,
                message: 'Missing or invalid "name" in tool call params.',
              },
            };
          }

          const tool = AgentToolRegistry.getTool(toolName);
          if (!tool) {
            return {
              jsonrpc: '2.0',
              id: req.id,
              error: {
                code: MCPErrorCode.MethodNotFound,
                message: `Tool '${toolName}' not found in registry.`,
              },
            };
          }

          const executionResult = await AgentToolRegistry.executeTool({
            toolId: toolName,
            runId: `mcp_${Date.now()}`,
            agentName: (tool.agent === 'ALL' ? 'PerceptionAgent' : tool.agent) as SpecialistAgentName,
            inputPayload: toolArgs,
          });

          const mcpResult = MCPToolsAdapter.formatMCPResult(executionResult);
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: mcpResult,
          };
        }

        // ── Resources ──
        case 'resources/list': {
          const resources: MCPResource[] = [
            {
              uri: 'ctrl://opportunities/pending',
              name: 'Pending Recovery Opportunities',
              description: 'Real-time list of failed payments awaiting recovery scoring and allocation.',
              mimeType: 'application/json',
            },
            {
              uri: 'ctrl://economics/metrics',
              name: 'CTRL Economic Telemetry',
              description: 'Current aggregate recovered value, shadow prices, and IVEN totals.',
              mimeType: 'application/json',
            },
            {
              uri: 'ctrl://system/kill_switch',
              name: 'Kill Switch Safety Status',
              description: 'Current state of the emergency circuit breaker.',
              mimeType: 'application/json',
            },
          ];
          return { jsonrpc: '2.0', id: req.id, result: { resources } };
        }

        case 'resources/read': {
          const uri = req.params?.uri;
          if (!uri) {
            return {
              jsonrpc: '2.0',
              id: req.id,
              error: { code: MCPErrorCode.InvalidParams, message: 'Missing uri parameter.' },
            };
          }

          if (uri === 'ctrl://opportunities/pending') {
            const opps = getAllOpportunities().filter((o) => o.status === 'pending');
            return {
              jsonrpc: '2.0',
              id: req.id,
              result: {
                contents: [
                  {
                    uri,
                    mimeType: 'application/json',
                    text: JSON.stringify(opps, null, 2),
                  },
                ],
              },
            };
          }

          if (uri === 'ctrl://economics/metrics') {
            const runs = getAllAgentRuns();
            const outcomes = getAllAgentOutcomes();
            const scores = getAllScores();
            const totalRecoveredPaise = outcomes
              .filter((o) => o.actual_recovered)
              .reduce((sum, o) => sum + (o.actual_revenue_paise || 0), 0);
            const metrics = {
              total_agent_missions: runs.length,
              completed_missions: runs.filter((r) => r.status === 'completed').length,
              total_recovered_paise: totalRecoveredPaise,
              total_recovered_display: `₹${(totalRecoveredPaise / 100).toFixed(2)}`,
              scored_opportunities_count: scores.length,
            };
            return {
              jsonrpc: '2.0',
              id: req.id,
              result: {
                contents: [
                  {
                    uri,
                    mimeType: 'application/json',
                    text: JSON.stringify(metrics, null, 2),
                  },
                ],
              },
            };
          }

          if (uri === 'ctrl://system/kill_switch') {
            const active = isKillSwitchActive();
            return {
              jsonrpc: '2.0',
              id: req.id,
              result: {
                contents: [
                  {
                    uri,
                    mimeType: 'application/json',
                    text: JSON.stringify({ kill_switch_active: active }, null, 2),
                  },
                ],
              },
            };
          }

          return {
            jsonrpc: '2.0',
            id: req.id,
            error: {
              code: MCPErrorCode.ResourceNotFound,
              message: `Resource '${uri}' not found.`,
            },
          };
        }

        // ── Prompts ──
        case 'prompts/list': {
          const prompts: MCPPrompt[] = [
            {
              name: 'diagnose_payment_failure',
              description: 'Structured diagnostic reasoning prompt for an autonomous payment recovery agent.',
              arguments: [
                { name: 'opportunity_id', description: 'Opportunity ID to analyze', required: true },
              ],
            },
            {
              name: 'portfolio_prioritization',
              description: 'Portfolio-level greedy allocation reasoning with shadow price estimation.',
              arguments: [
                { name: 'capacity', description: 'Available link capacity', required: false },
              ],
            },
          ];
          return { jsonrpc: '2.0', id: req.id, result: { prompts } };
        }

        case 'prompts/get': {
          const promptName = req.params?.name;
          if (promptName === 'diagnose_payment_failure') {
            return {
              jsonrpc: '2.0',
              id: req.id,
              result: {
                description: 'Diagnose payment failure and propose optimal recovery intervention.',
                messages: [
                  {
                    role: 'user',
                    content: {
                      type: 'text',
                      text: `You are CTRL, the autonomous recovery agent. Analyze opportunity ${req.params?.arguments?.opportunity_id}. Formulate hypotheses, inspect failure signals, compute counterfactual recovery odds, and propose an action (ACT/WAIT/ABSTAIN) governed by IVEN economics.`,
                    },
                  },
                ],
              },
            };
          }

          return {
            jsonrpc: '2.0',
            id: req.id,
            error: {
              code: MCPErrorCode.InvalidParams,
              message: `Prompt '${promptName}' not found.`,
            },
          };
        }

        default:
          return {
            jsonrpc: '2.0',
            id: req.id,
            error: {
              code: MCPErrorCode.MethodNotFound,
              message: `Unsupported MCP method: '${req.method}'`,
            },
          };
      }
    } catch (err: any) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: MCPErrorCode.InternalError,
          message: err?.message || 'Internal MCP server error',
        },
      };
    }
  }
}
