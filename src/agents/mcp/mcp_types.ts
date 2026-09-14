/**
 * Model Context Protocol (MCP) Type Definitions
 * Compatible with MCP 2024/2025/2026 Specification (JSON-RPC 2.0)
 */

export interface JSONRPCRequest<T = any> {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: T;
}

export interface JSONRPCNotification<T = any> {
  jsonrpc: '2.0';
  method: string;
  params?: T;
}

export interface JSONRPCResponse<T = any> {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: T;
  error?: JSONRPCError;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: any;
}

export enum MCPErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
  ResourceNotFound = -32002,
  ToolExecutionError = -32000,
}

// ── MCP Tools ──

export interface MCPToolInputSchema {
  type: 'object';
  properties?: Record<string, any>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: MCPToolInputSchema;
}

export interface MCPTextContent {
  type: 'text';
  text: string;
}

export interface MCPImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface MCPEmbeddedResource {
  type: 'resource';
  resource: {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  };
}

export type MCPContent = MCPTextContent | MCPImageContent | MCPEmbeddedResource;

export interface MCPToolCallParams {
  name: string;
  arguments?: Record<string, any>;
}

export interface MCPToolResult {
  content: MCPContent[];
  isError?: boolean;
}

// ── MCP Resources ──

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

// ── MCP Prompts ──

export interface MCPPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: MCPPromptArgument[];
}

export interface MCPPromptMessage {
  role: 'user' | 'assistant';
  content: MCPContent;
}

// ── Server Info & Capabilities ──

export interface MCPServerInfo {
  name: string;
  version: string;
  capabilities: {
    tools?: { listChanged?: boolean };
    resources?: { subscribe?: boolean; listChanged?: boolean };
    prompts?: { listChanged?: boolean };
    logging?: Record<string, never>;
  };
}
