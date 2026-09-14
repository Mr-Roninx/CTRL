import { AgentSchemaValidator } from '../../src/agents/schema.js';

export function runSchemaTests() {
  console.log('🧪 Running Test: Agent Schema Validator & Sanitization...');

  const runId = 'test_run';
  const oppId = 'test_opp';

  // 1. Valid JSON payload
  const validJson = {
    diagnosis: {
      failure_category: 'insufficient_funds',
      root_cause: 'Customer account had insufficient balance',
      confidence: 0.85,
      severity: 'MEDIUM',
      recoverability_assessment: 'HIGH',
    },
    observations: ['Observation 1'],
    hypotheses: ['Hypothesis 1'],
    candidate_actions: ['WAIT', 'SEND_PAYMENT_LINK'],
    semantic_signals: [
      {
        name: 'transient_failure',
        value: 0.8,
        confidence: 0.9,
        evidence_reference: 'Bank response code',
      },
    ],
    proposed_plan: {
      plan_version: 1,
      goal: 'Recover payment',
      steps: ['Step 1'],
      validity_assumptions: [
        { parameter: 'gateway_health', condition: '>=', expected_value: 0.75 },
      ],
      candidate_actions: ['WAIT', 'SEND_PAYMENT_LINK'],
      preferred_action: 'SEND_PAYMENT_LINK',
      estimated_duration_sec: 45,
    },
    uncertainty: 'LOW',
    requested_tools: [],
    rationale_summary: 'Recovery plan created.',
  };

  const res = AgentSchemaValidator.validateAgentIntent(validJson, runId, oppId);
  if (!res.valid || !res.data) {
    throw new Error(`Expected schema validation to pass: ${res.errors.join(', ')}`);
  }

  // 2. Malformed JSON handling
  const malformed = 'INVALID_JSON{{{';
  const resBad = AgentSchemaValidator.validateAgentIntent(malformed, runId, oppId);
  if (resBad.valid) {
    throw new Error('Expected malformed JSON to fail schema validation');
  }

  // 3. Out-of-bounds signal clamping
  const outOfBounds = {
    ...validJson,
    semantic_signals: [{ name: 'transient_failure', value: 999.9, confidence: -50 }],
  };
  const resClamped = AgentSchemaValidator.validateAgentIntent(outOfBounds, runId, oppId);
  if (!resClamped.valid || resClamped.data?.semantic_signals[0].value !== 1.0) {
    throw new Error('Expected semantic signal value to be clamped to 1.0');
  }

  console.log('  ✅ PASS: Agent schema validator parses, clamps, and rejects malformed outputs cleanly.');
}

if (process.argv[1]?.endsWith('test_agent_schema.ts')) {
  runSchemaTests();
}
