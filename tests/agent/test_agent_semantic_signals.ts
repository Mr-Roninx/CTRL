import { SemanticEconomicsBridge } from '../../src/agents/bridge.js';
import { SemanticSignal } from '../../src/agents/types.js';

export function runSemanticSignalsTests() {
  console.log('🧪 Running Test: Semantic Signals & Normalization...');

  const signals: SemanticSignal[] = [
    {
      name: 'transient_failure',
      value: 0.9,
      confidence: 0.95,
      evidence_reference: 'Bank switch code',
      timestamp: new Date().toISOString(),
      source: 'test',
    },
    {
      name: 'fatigue',
      value: 0.8,
      confidence: 0.9,
      evidence_reference: 'Attempt 3',
      timestamp: new Date().toISOString(),
      source: 'test',
    },
  ];

  const modifiers = SemanticEconomicsBridge.calculateModifiers(signals);

  // Transient failure should boost incremental prob (bounded <= 0.10)
  if (modifiers.incremental_prob_modifier <= 0 || modifiers.incremental_prob_modifier > 0.10) {
    throw new Error(`Expected positive incremental prob modifier within [0, 0.10], got ${modifiers.incremental_prob_modifier}`);
  }

  // Fatigue should add fatigue cost modifier (bounded <= 500 paise)
  if (modifiers.fatigue_cost_modifier_paise <= 0 || modifiers.fatigue_cost_modifier_paise > 500) {
    throw new Error(`Expected positive fatigue cost modifier within [0, 500], got ${modifiers.fatigue_cost_modifier_paise}`);
  }

  console.log('  ✅ PASS: Semantic signals parsed, bounded, and translated to calibrated economic modifiers.');
}

if (process.argv[1]?.endsWith('test_agent_semantic_signals.ts')) {
  runSemanticSignalsTests();
}
