export interface ProviderExecutionResult {
  text: string;
  tokens_used: number;
  model: string;
  latency_ms: number;
}

export type LLMTaskType = 'DIAGNOSIS' | 'REASONING' | 'PERCEPTION' | 'AUTHORITY' | 'GENERAL';

export interface LLMProviderAdapter {
  readonly name: string;
  readonly defaultModel: string;
  isAvailable(): boolean;
  generate(params: {
    prompt: string;
    systemPrompt?: string;
    model?: string;
    temperature?: number;
    timeoutMs?: number;
  }): Promise<ProviderExecutionResult>;
}
