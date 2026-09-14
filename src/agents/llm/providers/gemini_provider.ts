import { LLMProviderAdapter, ProviderExecutionResult } from './provider_types.js';

/**
 * GeminiProvider — Google Gemini 2.0 Flash / 1.5 Pro adapter.
 * Uses native fetch to Google GenAI REST API (zero extra dependencies).
 */
export class GeminiProvider implements LLMProviderAdapter {
  public readonly name = 'Google Gemini';
  public readonly defaultModel = 'gemini-2.0-flash';

  public isAvailable(): boolean {
    const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    return Boolean(key && !key.startsWith('your-') && key.length > 10);
  }

  public async generate(params: {
    prompt: string;
    systemPrompt?: string;
    model?: string;
    temperature?: number;
    timeoutMs?: number;
  }): Promise<ProviderExecutionResult> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error('GeminiProvider: GEMINI_API_KEY is not configured.');
    }

    const model = params.model || process.env.GEMINI_MODEL || this.defaultModel;
    const timeoutMs = params.timeoutMs || 25000;
    const startTime = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

      if (params.systemPrompt) {
        contents.push({
          role: 'user',
          parts: [{ text: `System instruction:\n${params.systemPrompt}\n\nUser query follows:` }],
        });
      }

      contents.push({
        role: 'user',
        parts: [{ text: params.prompt }],
      });

      const bodyPayload = {
        contents,
        generationConfig: {
          temperature: params.temperature ?? 0.1,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
        },
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini API error (${res.status}): ${errText}`);
      }

      const data: any = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const tokensUsed = data.usageMetadata?.totalTokenCount || 500;

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
