import { ToolDefinition } from '../tool_registry.js';
import { MCPTool, MCPToolResult, MCPTextContent } from './mcp_types.js';

/**
 * MCPToolsAdapter
 * Bridges CTRL's internal ToolDefinition model with the standardized
 * Model Context Protocol (MCP) tool format.
 */
export class MCPToolsAdapter {
  /**
   * Convert an internal CTRL ToolDefinition to an MCPTool.
   */
  public static toMCPTool(tool: ToolDefinition): MCPTool {
    return {
      name: tool.tool_id,
      description: `[Agent: ${tool.agent}] ${tool.description} (permission: ${tool.permission}, timeout: ${tool.timeout_ms}ms)`,
      inputSchema: {
        type: 'object',
        properties: tool.input_schema.properties ?? {},
        required: tool.input_schema.required ?? [],
        additionalProperties: tool.input_schema.additionalProperties ?? false,
      },
    };
  }

  /**
   * Convert a list of CTRL ToolDefinitions to an MCP tool list.
   */
  public static toMCPTools(tools: ToolDefinition[]): MCPTool[] {
    return tools.map((t) => this.toMCPTool(t));
  }

  /**
   * Format an execution output into a standard MCPToolResult.
   */
  public static formatMCPResult(executionResult: {
    success: boolean;
    data?: any;
    error?: string;
    denied?: boolean;
    latency_ms: number;
  }): MCPToolResult {
    if (executionResult.denied) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'DENIED',
                error: executionResult.error,
                latency_ms: executionResult.latency_ms,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    if (!executionResult.success) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'FAILED',
                error: executionResult.error,
                latency_ms: executionResult.latency_ms,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    const payload = executionResult.data !== undefined ? executionResult.data : {};
    return {
      content: [
        {
          type: 'text',
          text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
        },
      ],
      isError: false,
    };
  }
}
