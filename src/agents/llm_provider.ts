import crypto from 'node:crypto';
import dotenv from 'dotenv';
import path from 'node:path';
import { AgentIntent, AgentSchemaValidator } from './schema.js';
import { AgentContextBuilder, SanitizedPromptContext } from './context_builder.js';
import { AgentTelemetry } from './telemetry.js';
import { ProviderRouter } from './llm/providers/provider_router.js';

export { ProviderRouter };

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export interface LLMGenerationResult {
  success: boolean;
  intent: AgentIntent;
  provider: string;
  model: string;
  is_fallback: boolean;
  latency_ms: number;
  tokens_used: number;
  error?: string;
}

export class LLMProvider {
  /**
   * Generates a structured AgentIntent using multi-provider routing (Claude, Gemini, OpenAI, NVIDIA NIM),
   * or safely falls back to deterministic rule-based intent.
   */
  public static async generateAgentIntent(params: {
    runId: string;
    opportunityId: string;
    context: SanitizedPromptContext;
  }): Promise<LLMGenerationResult> {
    const startTime = Date.now();
    const invId = `llm_inv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const isEnabled = process.env.CTRL_LLM_ENABLED !== 'false';
    const timeoutMs = Number(process.env.LLM_TIMEOUT_MS) || 5000;

    const userPrompt = `
Analyze the following payment recovery context and produce an AgentIntent JSON:
${JSON.stringify(params.context, null, 2)}

Respond ONLY with valid JSON having the exact keys:
{
  "diagnosis": {
    "failure_category": string,
    "root_cause": string,
    "confidence": number (0.0 to 1.0),
    "severity": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
    "recoverability_assessment": "HIGH" | "MODERATE" | "POOR" | "IMPOSSIBLE"
  },
  "observations": string[],
  "hypotheses": string[],
  "candidate_actions": ("ACT" | "WAIT" | "ABSTAIN" | "SEND_PAYMENT_LINK" | "DEFER_RETRY" | "MANUAL_REVIEW")[],
  "semantic_signals": [
    {
      "name": "transient_failure" | "customer_liquidity" | "fatigue" | "gateway_instability" | "settlement_ambiguity" | "alternate_method_relevance" | "urgency" | "relationship_risk",
      "value": number (0.0 to 1.0),
      "confidence": number (0.0 to 1.0),
      "evidence_reference": string
    }
  ],
  "proposed_plan": {
    "plan_version": 1,
    "goal": string,
    "steps": string[],
    "validity_assumptions": [
      {
        "parameter": string,
        "condition": string,
        "expected_value": any
      }
    ],
    "candidate_actions": string[],
    "preferred_action": string,
    "estimated_duration_sec": number
  },
  "uncertainty": "LOW" | "MEDIUM" | "HIGH",
  "requested_tools": [
    {
      "tool_name": string,
      "params": {}
    }
  ],
  "rationale_summary": string
}
`.trim();

    // 1. Attempt Multi-Provider LLM Routing if enabled
    if (isEnabled) {
      try {
        const routerResult = await ProviderRouter.executeWithFallback({
          prompt: userPrompt,
          systemPrompt: AgentContextBuilder.getSystemPrompt(),
          taskType: 'DIAGNOSIS',
          timeoutMs,
        });

        if (routerResult && routerResult.text) {
          let cleanJson = routerResult.text.trim();
          if (cleanJson.startsWith('```json')) {
            cleanJson = cleanJson.replace(/^```json\n?/, '').replace(/```$/, '').trim();
          } else if (cleanJson.startsWith('```')) {
            cleanJson = cleanJson.replace(/^```\n?/, '').replace(/```$/, '').trim();
          }

          const valResult = AgentSchemaValidator.validateAgentIntent(cleanJson, params.runId, params.opportunityId);
          if (valResult.valid && valResult.data) {
            const promptTokens = Math.round(routerResult.tokens_used * 0.4);
            const completionTokens = Math.round(routerResult.tokens_used * 0.6);

            AgentTelemetry.logLLMInvocation({
              id: invId,
              runId: params.runId,
              model: routerResult.model,
              provider: routerResult.provider_name,
              prompt: userPrompt,
              completion: routerResult.text,
              latencyMs: routerResult.latency_ms,
              promptTokens,
              completionTokens,
              totalTokens: routerResult.tokens_used,
            });

            return {
              success: true,
              intent: valResult.data,
              provider: routerResult.provider_name,
              model: routerResult.model,
              is_fallback: routerResult.is_fallback,
              latency_ms: routerResult.latency_ms,
              tokens_used: routerResult.tokens_used,
            };
          }
        }
      } catch (err: any) {
        console.warn('LLMProvider: Multi-provider router error, falling back to deterministic policy:', err?.message);
      }
    }

    // 2. Safe Fallback: Deterministic Rule Engine
    const fallbackIntent = this.generateDeterministicFallbackIntent(params.runId, params.opportunityId, params.context);
    const latencyMs = Date.now() - startTime;

    AgentTelemetry.logLLMInvocation({
      id: invId,
      runId: params.runId,
      model: 'deterministic_ctrl_policy',
      provider: 'Deterministic Rule Engine (Fallback)',
      prompt: userPrompt,
      completion: JSON.stringify(fallbackIntent),
      latencyMs,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });

    return {
      success: true,
      intent: fallbackIntent,
      provider: 'Deterministic Fallback',
      model: 'deterministic_ctrl_policy',
      is_fallback: true,
      latency_ms: latencyMs,
      tokens_used: 0,
    };
  }

  /**
   * Deterministic rule-based fallback generating mathematically coherent AgentIntent.
   */
  public static generateDeterministicFallbackIntent(
    runId: string,
    oppId: string,
    context: SanitizedPromptContext
  ): AgentIntent {
    const opp = context.opportunity;
    const isHard = opp.decline_type === 'hard';
    const isRetryCap = opp.attempt_count >= 3;
    const reason = (opp.reason_code || '').toLowerCase();

    let rootCause = 'Soft decline due to temporary issuer block or insufficient funds';
    let failureCat = 'soft_decline';
    let confidence = 0.85;
    let recoverability: 'HIGH' | 'MODERATE' | 'POOR' | 'IMPOSSIBLE' = 'MODERATE';
    let preferredAction = 'SEND_PAYMENT_LINK';

    if (isHard) {
      rootCause = 'Hard decline (lost/stolen card or fraudulent activity reported by issuer)';
      failureCat = 'fraud_hard_decline';
      confidence = 0.95;
      recoverability = 'IMPOSSIBLE';
      preferredAction = 'ABSTAIN';
    } else if (isRetryCap) {
      rootCause = `Retry cap reached (${opp.attempt_count}/3 attempts). Customer fatigue high.`;
      failureCat = 'retry_cap_exceeded';
      confidence = 0.90;
      recoverability = 'POOR';
      preferredAction = 'ABSTAIN';
    } else if (reason.includes('insufficient_funds')) {
      rootCause = 'Customer account temporarily lacked sufficient balance';
      failureCat = 'insufficient_funds';
      confidence = 0.80;
      recoverability = 'HIGH';
      preferredAction = 'SEND_PAYMENT_LINK';
    } else if (reason.includes('timeout') || reason.includes('gateway')) {
      rootCause = 'Bank gateway or processing network transient timeout';
      failureCat = 'gateway_timeout';
      confidence = 0.90;
      recoverability = 'HIGH';
      preferredAction = 'WAIT';
    }

    const transientVal = reason.includes('timeout') ? 0.85 : isHard ? 0.05 : 0.45;
    const fatigueVal = isRetryCap ? 0.85 : opp.attempt_count === 2 ? 0.40 : 0.10;
    const liquidityVal = isHard ? 0.10 : 0.70;

    return {
      intent_id: `intent_det_${Date.now()}_${oppId.slice(0, 8)}`,
      run_id: runId,
      opportunity_id: oppId,
      diagnosis: {
        failure_category: failureCat,
        root_cause: rootCause,
        confidence,
        severity: isHard ? 'CRITICAL' : isRetryCap ? 'HIGH' : 'MEDIUM',
        recoverability_assessment: recoverability,
      },
      observations: [
        `Opportunity ${opp.id} (${(opp as any).amount_inr || (opp.amount_paise ? '₹' + (opp.amount_paise / 100).toFixed(2) : '₹0')}, decline: ${opp.decline_type})`,
        `Attempt count: ${opp.attempt_count}, reason: ${opp.reason_code}`,
        `Customer trust score: ${context.customer?.trust_score ?? (context as any).customer_trust_score ?? 0.65}`,
      ],
      hypotheses: [
        isHard
          ? 'Card stolen or reported fraud. Zero economic value in contacting customer.'
          : 'Payment recoverable via alternate payment link if capacity allows.',
      ],
      candidate_actions: isHard ? ['ABSTAIN'] : ['WAIT', 'SEND_PAYMENT_LINK', 'ABSTAIN'],
      semantic_signals: [
        {
          name: 'transient_failure',
          value: transientVal,
          confidence: 0.85,
          evidence_reference: `Reason code: ${opp.reason_code}`,
          timestamp: new Date().toISOString(),
          source: 'deterministic_rule_engine',
        },
        {
          name: 'fatigue',
          value: fatigueVal,
          confidence: 0.90,
          evidence_reference: `Attempt count: ${opp.attempt_count}`,
          timestamp: new Date().toISOString(),
          source: 'deterministic_rule_engine',
        },
        {
          name: 'customer_liquidity',
          value: liquidityVal,
          confidence: 0.75,
          evidence_reference: `Trust score: ${context.customer?.trust_score ?? (context as any).customer_trust_score ?? 0.65}`,
          timestamp: new Date().toISOString(),
          source: 'deterministic_rule_engine',
        },
      ],
      proposed_plan: {
        plan_version: 1,
        goal: `Execute recovery strategy for ${opp.id}`,
        steps: isHard
          ? ['Abstain and flag hard decline in compliance audit']
          : ['Check gateway state', 'Calculate IVEN', 'Submit to Market allocator'],
        validity_assumptions: [
          {
            id: 'assump_1',
            parameter: 'gateway_health',
            condition: '>=',
            expected_value: 0.75,
            is_valid: true,
          },
          {
            id: 'assump_2',
            parameter: 'attempt_count',
            condition: '<',
            expected_value: 3,
            is_valid: !isRetryCap,
          },
        ],
        candidate_actions: isHard ? ['ABSTAIN'] : ['WAIT', 'SEND_PAYMENT_LINK'],
        preferred_action: preferredAction,
        estimated_duration_sec: 45,
      },
      uncertainty: isHard ? 'LOW' : 'MEDIUM',
      requested_tools: [
        { tool_name: 'get_gateway_state', params: {} },
        { tool_name: 'get_customer_history', params: { customer_id: opp.customer_id } },
      ],
      rationale_summary: `Deterministic policy evaluated ${opp.id} with ${recoverability} recoverability and selected preferred action '${preferredAction}'.`,
      created_at: new Date().toISOString(),
    };
  }
}
