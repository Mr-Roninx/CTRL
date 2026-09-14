import {
  LLMProviderAdapter,
  LLMTaskType,
  ProviderExecutionResult,
} from './provider_types.js';
import { ClaudeProvider } from './claude_provider.js';
import { GeminiProvider } from './gemini_provider.js';
import { OpenAIProvider } from './openai_provider.js';

interface ProviderHealth {
  consecutiveFailures: number;
  circuitOpenUntil: number;
}

export interface RouterExecutionResult extends ProviderExecutionResult {
  provider_name: string;
  is_fallback: boolean;
  attempted_providers: string[];
}

/**
 * ProviderRouter — Multi-Provider LLM Orchestrator with Intelligent Routing & Circuit Breakers.
 */
export class ProviderRouter {
  private static providers: Map<string, LLMProviderAdapter> = new Map();
  private static health: Map<string, ProviderHealth> = new Map();
  private static initialized = false;

  private static init(): void {
    if (this.initialized) return;

    const claude = new ClaudeProvider();
    const gemini = new GeminiProvider();
    const openai = new OpenAIProvider({
      name: 'OpenAI',
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      defaultModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      apiKeyEnvVar: 'OPENAI_API_KEY',
    });
    const nvidia = new OpenAIProvider({
      name: 'NVIDIA NIM',
      baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
      defaultModel: process.env.NVIDIA_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b',
      apiKeyEnvVar: 'NVIDIA_API_KEY',
    });

    this.registerProvider('claude', claude);
    this.registerProvider('gemini', gemini);
    this.registerProvider('openai', openai);
    this.registerProvider('nvidia', nvidia);

    this.initialized = true;
  }

  public static registerProvider(id: string, provider: LLMProviderAdapter): void {
    this.providers.set(id, provider);
    if (!this.health.has(id)) {
      this.health.set(id, { consecutiveFailures: 0, circuitOpenUntil: 0 });
    }
  }

  /**
   * Determine priority order for a given task type.
   */
  public static getProviderOrder(taskType: LLMTaskType = 'GENERAL'): string[] {
    switch (taskType) {
      case 'DIAGNOSIS':
      case 'REASONING':
        return ['claude', 'gemini', 'openai', 'nvidia'];
      case 'PERCEPTION':
        return ['gemini', 'openai', 'claude', 'nvidia'];
      case 'AUTHORITY':
        return ['claude', 'openai', 'gemini', 'nvidia'];
      default:
        return ['claude', 'gemini', 'openai', 'nvidia'];
    }
  }

  /**
   * Route and execute prompt across providers with automatic fallback cascade.
   */
  public static async executeWithFallback(params: {
    prompt: string;
    systemPrompt?: string;
    taskType?: LLMTaskType;
    temperature?: number;
    timeoutMs?: number;
  }): Promise<RouterExecutionResult | null> {
    this.init();

    const order = this.getProviderOrder(params.taskType);
    const attempted: string[] = [];
    const now = Date.now();

    for (let i = 0; i < order.length; i++) {
      const providerId = order[i];
      if (!providerId) continue;
      const provider = this.providers.get(providerId);
      const health = this.health.get(providerId);

      if (!provider || !provider.isAvailable()) {
        continue;
      }

      // Check circuit breaker
      if (health && now < health.circuitOpenUntil) {
        continue;
      }

      attempted.push(provider.name);

      try {
        const result = await provider.generate({
          prompt: params.prompt,
          systemPrompt: params.systemPrompt,
          temperature: params.temperature,
          timeoutMs: params.timeoutMs,
        });

        // Reset failures on success
        if (health) {
          health.consecutiveFailures = 0;
          health.circuitOpenUntil = 0;
        }

        return {
          ...result,
          provider_name: provider.name,
          is_fallback: i > 0,
          attempted_providers: attempted,
        };
      } catch (err: any) {
        console.warn(`ProviderRouter: ${provider.name} failed:`, err?.message);
        if (health) {
          health.consecutiveFailures += 1;
          if (health.consecutiveFailures >= 5) {
            health.circuitOpenUntil = Date.now() + 60000; // Trip for 60s
            console.warn(`ProviderRouter: Circuit breaker tripped for ${provider.name} (5 consecutive errors).`);
          }
        }
      }
    }

    return null; // All providers exhausted or unavailable -> caller uses deterministic engine
  }
}
