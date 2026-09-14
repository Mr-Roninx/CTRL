import { LLMProviderAdapter, ProviderExecutionResult } from './provider_types.js';

/**
 * ClaudeProvider — Anthropic Claude 3.5 Sonnet / Opus adapter.
 * Uses native fetch to Anthropic Messages API (zero extra dependencies).
 */
export class ClaudeProvider implements LLMProviderAdapter {
  public readonly name = 'Anthropic Claude';
  public readonly defaultModel = 'claude-3-5-sonnet-20241022';

  public isAvailable(): boolean {
    const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    return Boolean(key && !key.startsWith('your-') && key.length > 10);
  }

  public async generate(params: {
    prompt: string;
    systemPrompt?: string;
    model?: string;
    temperature?: number;
    timeoutMs?: number;
  }): Promise<ProviderExecutionResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      throw new Error('ClaudeProvider: ANTHROPIC_API_KEY is not configured.');
    }

    const model = params.model || process.env.ANTHROPIC_MODEL || this.defaultModel;
    const timeoutMs = params.timeoutMs || 25000;
    const startTime = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const messages = [{ role: 'user', content: params.prompt }];
      const bodyPayload: Record<string, any> = {
        model,
        max_tokens: 2048,
        messages,
        temperature: params.temperature ?? 0.1,
      };

      if (params.systemPrompt) {
        bodyPayload.system = params.systemPrompt;
      }

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(bodyPayload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Claude API error (${res.status}): ${errText}`);
      }

      const data: any = await res.json();
      const text = data.content?.map((c: any) => c.text || '').join('\n') || '';
      const tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);

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
