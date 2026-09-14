import { LLMProviderAdapter, ProviderExecutionResult } from './provider_types.js';

/**
 * OpenAIProvider — OpenAI API / NVIDIA NIM / OpenAI-compatible endpoint adapter.
 * Uses native fetch to /v1/chat/completions.
 */
export class OpenAIProvider implements LLMProviderAdapter {
  public readonly name: string;
  public readonly defaultModel: string;
  private baseUrl: string;
  private apiKeyEnvVar: string;

  constructor(options?: {
    name?: string;
    baseUrl?: string;
    defaultModel?: string;
    apiKeyEnvVar?: string;
  }) {
    this.name = options?.name || 'OpenAI';
    this.baseUrl = (options?.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.defaultModel = options?.defaultModel || process.env.OPENAI_MODEL || 'gpt-4o-mini';
    this.apiKeyEnvVar = options?.apiKeyEnvVar || 'OPENAI_API_KEY';
  }

  public isAvailable(): boolean {
    const key = process.env[this.apiKeyEnvVar];
    return Boolean(key && !key.startsWith('your-') && !key.startsWith('nvapi-YOUR_') && key.length > 10);
  }

  public async generate(params: {
    prompt: string;
    systemPrompt?: string;
    model?: string;
    temperature?: number;
    timeoutMs?: number;
  }): Promise<ProviderExecutionResult> {
    const key = process.env[this.apiKeyEnvVar];
    if (!key) {
      throw new Error(`OpenAIProvider (${this.name}): ${this.apiKeyEnvVar} not configured.`);
    }

    const model = params.model || this.defaultModel;
    const timeoutMs = params.timeoutMs || 25000;
    const startTime = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const messages: Array<{ role: string; content: string }> = [];

      if (params.systemPrompt) {
        messages.push({ role: 'system', content: params.systemPrompt });
      }
      messages.push({ role: 'user', content: params.prompt });

      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: params.temperature ?? 0.1,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`${this.name} API error (${res.status}): ${errText}`);
      }

      const data: any = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      const tokensUsed = (data.usage?.prompt_tokens || 0) + (data.usage?.completion_tokens || 0);

      return {
        text,
        tokens_used: tokensUsed,
        model,
        latency_ms: Date.now() - startTime,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
