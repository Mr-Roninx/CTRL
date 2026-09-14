import { SemanticSignal, PlanValidityAssumption } from './types.js';

export interface StructuredAgentDiagnosis {
  failure_category: string;
  root_cause: string;
  confidence: number; // 0.0 to 1.0
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recoverability_assessment: 'HIGH' | 'MODERATE' | 'POOR' | 'IMPOSSIBLE';
}

export interface StructuredProposedPlan {
  plan_version: number;
  goal: string;
  steps: string[];
  validity_assumptions: PlanValidityAssumption[];
  candidate_actions: string[];
  preferred_action: string;
  estimated_duration_sec: number;
}

export interface AgentIntent {
  intent_id: string;
  run_id: string;
  opportunity_id: string;
  diagnosis: StructuredAgentDiagnosis;
  observations: string[];
  hypotheses: string[];
  candidate_actions: string[];
  semantic_signals: SemanticSignal[];
  proposed_plan: StructuredProposedPlan;
  uncertainty: 'LOW' | 'MEDIUM' | 'HIGH';
  requested_tools: { tool_name: string; params: Record<string, any> }[];
  rationale_summary: string;
  created_at: string;
}

export interface SchemaValidationResult<T = any> {
  valid: boolean;
  data?: T;
  errors: string[];
}

export class AgentSchemaValidator {
  /**
   * Validates and sanitizes a raw LLM output or JSON string into a structured AgentIntent.
   */
  public static validateAgentIntent(raw: any, runId: string, oppId: string): SchemaValidationResult<AgentIntent> {
    const errors: string[] = [];

    let parsed: any = raw;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch (e: any) {
        return {
          valid: false,
          errors: [`Malformed JSON in LLM response: ${e.message}`],
        };
      }
    }

    if (!parsed || typeof parsed !== 'object') {
      return { valid: false, errors: ['Parsed output is not an object.'] };
    }

    // 1. Validate Diagnosis
    const diag = parsed.diagnosis || {};
    const confidence = typeof diag.confidence === 'number' ? Math.max(0, Math.min(1, diag.confidence)) : 0.5;
    const diagnosis: StructuredAgentDiagnosis = {
      failure_category: String(diag.failure_category || 'generic_failure').slice(0, 100),
      root_cause: String(diag.root_cause || 'unspecified').slice(0, 300),
      confidence,
      severity: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(diag.severity) ? diag.severity : 'MEDIUM',
      recoverability_assessment: ['HIGH', 'MODERATE', 'POOR', 'IMPOSSIBLE'].includes(diag.recoverability_assessment)
        ? diag.recoverability_assessment
        : 'MODERATE',
    };

    // 2. Validate Observations & Hypotheses
    const observations = Array.isArray(parsed.observations)
      ? parsed.observations.map((o: any) => String(o).slice(0, 200))
      : [];
    const hypotheses = Array.isArray(parsed.hypotheses)
      ? parsed.hypotheses.map((h: any) => String(h).slice(0, 200))
      : [];

    // 3. Validate Candidate Actions
    const validActions = ['ACT', 'WAIT', 'ABSTAIN', 'SEND_PAYMENT_LINK', 'DEFER_RETRY', 'MANUAL_REVIEW'];
    const candidate_actions: string[] = [];
    if (Array.isArray(parsed.candidate_actions)) {
      for (const act of parsed.candidate_actions) {
        if (typeof act === 'string' && validActions.includes(act.toUpperCase())) {
          candidate_actions.push(act.toUpperCase());
        }
      }
    }
    if (candidate_actions.length === 0) {
      candidate_actions.push('WAIT', 'SEND_PAYMENT_LINK');
    }

    // 4. Validate Semantic Signals (0.0 <= value <= 1.0)
    const validSignalNames = [
      'transient_failure',
      'customer_liquidity',
      'fatigue',
      'gateway_instability',
      'settlement_ambiguity',
      'alternate_method_relevance',
      'urgency',
      'relationship_risk',
    ];
    const semantic_signals: SemanticSignal[] = [];
    if (Array.isArray(parsed.semantic_signals)) {
      for (const sig of parsed.semantic_signals) {
        if (sig && typeof sig === 'object' && validSignalNames.includes(sig.name)) {
          const val = typeof sig.value === 'number' ? Math.max(0, Math.min(1, sig.value)) : 0.5;
          const conf = typeof sig.confidence === 'number' ? Math.max(0, Math.min(1, sig.confidence)) : 0.8;
          semantic_signals.push({
            name: sig.name,
            value: Number(val.toFixed(4)),
            confidence: Number(conf.toFixed(4)),
            evidence_reference: String(sig.evidence_reference || 'LLM context analysis').slice(0, 200),
            timestamp: new Date().toISOString(),
            source: 'llm_reasoning',
          });
        }
      }
    }

    // 5. Validate Proposed Plan
    const planRaw = parsed.proposed_plan || {};
    const steps = Array.isArray(planRaw.steps) ? planRaw.steps.map((s: any) => String(s).slice(0, 200)) : ['Observe outcome'];
    const assumptions: PlanValidityAssumption[] = [];
    if (Array.isArray(planRaw.validity_assumptions)) {
      for (let i = 0; i < planRaw.validity_assumptions.length; i++) {
        const a = planRaw.validity_assumptions[i];
        if (a && typeof a === 'object') {
          assumptions.push({
            id: `assump_${i + 1}`,
            parameter: String(a.parameter || 'gateway_health').slice(0, 50),
            condition: String(a.condition || '>=').slice(0, 10),
            expected_value: a.expected_value !== undefined ? a.expected_value : 0.75,
            is_valid: true,
          });
        }
      }
    }
    if (assumptions.length === 0) {
      assumptions.push({
        id: 'assump_1',
        parameter: 'gateway_health',
        condition: '>=',
        expected_value: 0.75,
        is_valid: true,
      });
    }

    const preferred_action = typeof planRaw.preferred_action === 'string' && candidate_actions.includes(planRaw.preferred_action.toUpperCase())
      ? planRaw.preferred_action.toUpperCase()
      : candidate_actions[0] || 'SEND_PAYMENT_LINK';

    const proposed_plan: StructuredProposedPlan = {
      plan_version: typeof planRaw.plan_version === 'number' ? planRaw.plan_version : 1,
      goal: String(planRaw.goal || 'Recover payment with positive IVEN under capacity limits').slice(0, 200),
      steps,
      validity_assumptions: assumptions,
      candidate_actions,
      preferred_action,
      estimated_duration_sec: typeof planRaw.estimated_duration_sec === 'number' ? planRaw.estimated_duration_sec : 60,
    };

    // 6. Validate Requested Tools
    const requested_tools: { tool_name: string; params: Record<string, any> }[] = [];
    if (Array.isArray(parsed.requested_tools)) {
      for (const rt of parsed.requested_tools) {
        if (rt && typeof rt === 'object' && typeof rt.tool_name === 'string') {
          requested_tools.push({
            tool_name: rt.tool_name,
            params: rt.params && typeof rt.params === 'object' ? rt.params : {},
          });
        }
      }
    }

    const intent: AgentIntent = {
      intent_id: `intent_${Date.now()}_${oppId.slice(0, 8)}`,
      run_id: runId,
      opportunity_id: oppId,
      diagnosis,
      observations,
      hypotheses,
      candidate_actions,
      semantic_signals,
      proposed_plan,
      uncertainty: ['LOW', 'MEDIUM', 'HIGH'].includes(parsed.uncertainty) ? parsed.uncertainty : 'MEDIUM',
      requested_tools,
      rationale_summary: String(parsed.rationale_summary || 'Autonomous structured recovery intent generated').slice(0, 500),
      created_at: new Date().toISOString(),
    };

    return {
      valid: errors.length === 0,
      data: intent,
      errors,
    };
  }
}
