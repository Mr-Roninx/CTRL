import crypto from 'node:crypto';
import {
  insertAgentStep,
  insertAgentToolCall,
  insertLLMInvocation,
  getAgentStepsByRunId,
  getAgentToolCallsByRunId,
  getLLMInvocationsByRunId,
  getAgentStatesByRunId,
} from '../db/database.js';
import { SpecialistAgentName, ToolPermission, AgentState } from './types.js';

export function hashContent(content: any): string {
  const str = typeof content === 'string' ? content : JSON.stringify(content || {});
  return crypto.createHash('sha256').update(str).digest('hex');
}

export function sanitizeTextForLog(text: string): string {
  if (!text) return '';
  return text
    .replace(/rzp_(test|live)_[a-zA-Z0-9]+/g, 'rzp_***_REDACTED')
    .replace(/nvapi-[a-zA-Z0-9_-]+/g, 'nvapi-***_REDACTED')
    .replace(/Bearer\s+[a-zA-Z0-9_.-]+/gi, 'Bearer ***_REDACTED')
    .replace(/\b\d{16}\b/g, '****-****-****-****')
    .replace(/\b\d{3}\b/g, '***');
}

export interface AgentMissionTrace {
  run_id: string;
  states: any[];
  steps: any[];
  tool_calls: any[];
  llm_invocations: any[];
  summary: {
    total_steps: number;
    total_tool_calls: number;
    total_llm_calls: number;
    total_tokens: number;
    total_latency_ms: number;
  };
}

export class AgentTelemetry {
  public static logStep(params: {
    runId: string;
    stepNumber: number;
    state: AgentState;
    observation?: string;
    thought?: string;
    actionType?: string;
    actionPayload?: Record<string, any>;
    toolName?: string;
    toolInput?: Record<string, any>;
    toolOutput?: Record<string, any>;
  }): void {
    insertAgentStep({
      run_id: params.runId,
      step_number: params.stepNumber,
      state: params.state,
      observation: params.observation ? sanitizeTextForLog(params.observation) : null,
      thought: params.thought ? sanitizeTextForLog(params.thought) : null,
      action_type: params.actionType || null,
      action_payload: params.actionPayload ? sanitizeTextForLog(JSON.stringify(params.actionPayload)) : null,
      tool_name: params.toolName || null,
      tool_input: params.toolInput ? sanitizeTextForLog(JSON.stringify(params.toolInput)) : null,
      tool_output: params.toolOutput ? sanitizeTextForLog(JSON.stringify(params.toolOutput)) : null,
      timestamp: new Date().toISOString(),
    });
  }

  public static logToolCall(params: {
    id: string;
    runId: string;
    toolName: string;
    agentName: SpecialistAgentName;
    inputPayload: Record<string, any>;
    outputPayload: Record<string, any>;
    status: 'SUCCESS' | 'DENIED' | 'FAILED' | 'TIMEOUT';
    latencyMs: number;
    errorMessage?: string;
    permissionLevel: ToolPermission;
  }): void {
    const inputStr = sanitizeTextForLog(JSON.stringify(params.inputPayload));
    const outputStr = sanitizeTextForLog(JSON.stringify(params.outputPayload));

    insertAgentToolCall({
      id: params.id,
      run_id: params.runId,
      tool_name: params.toolName,
      agent_name: params.agentName,
      input_payload: inputStr,
      input_hash: hashContent(params.inputPayload),
      output_payload: outputStr,
      output_hash: hashContent(params.outputPayload),
      status: params.status,
      latency_ms: params.latencyMs,
      error_message: params.errorMessage || null,
      permission_level: params.permissionLevel,
      created_at: new Date().toISOString(),
    });
  }

  public static logLLMInvocation(params: {
    id: string;
    runId: string;
    model: string;
    provider: string;
    prompt: string;
    completion: string;
    reasoning?: string;
    latencyMs: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    error?: string;
  }): void {
    const promptClean = sanitizeTextForLog(params.prompt);
    const completionClean = sanitizeTextForLog(params.completion);
    const reasoningClean = params.reasoning ? sanitizeTextForLog(params.reasoning) : null;

    insertLLMInvocation({
      id: params.id,
      run_id: params.runId,
      model: params.model,
      provider: params.provider,
      prompt_hash: hashContent(params.prompt),
      prompt_preview: promptClean.slice(0, 300),
      completion_hash: hashContent(params.completion),
      completion_preview: completionClean.slice(0, 500),
      reasoning_preview: reasoningClean ? reasoningClean.slice(0, 300) : null,
      latency_ms: params.latencyMs,
      prompt_tokens: params.promptTokens || 0,
      completion_tokens: params.completionTokens || 0,
      total_tokens: params.totalTokens || (params.promptTokens || 0) + (params.completionTokens || 0),
      error: params.error || null,
      created_at: new Date().toISOString(),
    });
  }

  public static getMissionTrace(runId: string): AgentMissionTrace {
    const states = getAgentStatesByRunId(runId);
    const steps = getAgentStepsByRunId(runId);
    const toolCalls = getAgentToolCallsByRunId(runId);
    const llmInvocations = getLLMInvocationsByRunId(runId);

    const totalTokens = llmInvocations.reduce((sum, inv) => sum + (inv.total_tokens || 0), 0);
    const totalLatency = toolCalls.reduce((sum, t) => sum + t.latency_ms, 0) + llmInvocations.reduce((sum, l) => sum + l.latency_ms, 0);

    return {
      run_id: runId,
      states,
      steps,
      tool_calls: toolCalls,
      llm_invocations: llmInvocations,
      summary: {
        total_steps: steps.length,
        total_tool_calls: toolCalls.length,
        total_llm_calls: llmInvocations.length,
        total_tokens: totalTokens,
        total_latency_ms: totalLatency,
      },
    };
  }
}
