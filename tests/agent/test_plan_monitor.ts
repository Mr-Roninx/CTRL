import { initDatabase } from '../../src/db/database.js';
import { PlanMonitor } from '../../src/agents/plan_monitor.js';
import { AgentPlanRecord, PlanValidityAssumption } from '../../src/agents/types.js';

function makePlan(overrides: Partial<AgentPlanRecord> = {}): AgentPlanRecord {
  return {
    id: 'plan_test_01',
    run_id: 'run_test_01',
    plan_version: 1,
    goal: 'Recover test opportunity',
    steps: ['Score', 'Allocate', 'Execute'],
    validity_assumptions: [
      {
        id: 'assump_gateway_health',
        parameter: 'gateway_health',
        condition: '>=',
        expected_value: 0.75,
        current_value: 0.95,
        is_valid: true,
      },
      {
        id: 'assump_retry_cap',
        parameter: 'attempt_count',
        condition: '<',
        expected_value: 3,
        current_value: 1,
        is_valid: true,
      },
      {
        id: 'assump_capacity',
        parameter: 'capacity_available',
        condition: '>',
        expected_value: 0,
        current_value: 5,
        is_valid: true,
      },
    ],
    candidate_actions: ['SEND_PAYMENT_LINK', 'WAIT', 'ABSTAIN'],
    preferred_action: 'SEND_PAYMENT_LINK',
    status: 'ACTIVE',
    invalidation_reason: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function runPlanMonitorTests() {
  console.log('🧪 Running Test: Plan Monitor...');

  // Test 1: Valid plan → CONTINUE
  const result1 = PlanMonitor.check({
    plan: makePlan(),
    currentGatewayHealth: 0.95,
    currentCapacityAvailable: 5,
  });

  if (!result1.is_still_valid) {
    throw new Error(`Expected valid plan, got invalid: ${result1.violated_assumptions}`);
  }
  if (result1.recommendation !== 'CONTINUE') {
    throw new Error(`Expected CONTINUE, got ${result1.recommendation}`);
  }
  console.log(`  ✅ Valid assumptions → CONTINUE`);

  // Test 2: Gateway degradation → REPLAN
  const result2 = PlanMonitor.check({
    plan: makePlan(),
    currentGatewayHealth: 0.50,
    currentCapacityAvailable: 5,
  });

  if (result2.is_still_valid) {
    throw new Error('Expected invalid plan with degraded gateway');
  }
  if (result2.recommendation !== 'REPLAN') {
    throw new Error(`Expected REPLAN for gateway degradation, got ${result2.recommendation}`);
  }
  if (!result2.violated_assumptions.some((a) => a.includes('gateway_health'))) {
    throw new Error('Expected gateway_health violation in list');
  }
  console.log(`  ✅ Gateway degradation → REPLAN, violations: ${result2.violated_assumptions.length}`);

  // Test 3: Capacity exhausted → REPLAN
  const result3 = PlanMonitor.check({
    plan: makePlan(),
    currentGatewayHealth: 0.95,
    currentCapacityAvailable: 0,
  });

  if (result3.is_still_valid) {
    throw new Error('Expected invalid plan with zero capacity');
  }
  if (result3.recommendation !== 'REPLAN') {
    throw new Error(`Expected REPLAN for zero capacity, got ${result3.recommendation}`);
  }
  console.log(`  ✅ Zero capacity → REPLAN`);

  // Test 4: Terminal opportunity status → ABORT
  const result4 = PlanMonitor.check({
    plan: makePlan(),
    currentGatewayHealth: 0.95,
    currentCapacityAvailable: 5,
    currentOpportunityStatus: 'recovered',
  });

  if (result4.recommendation !== 'ABORT') {
    throw new Error(`Expected ABORT for terminal status, got ${result4.recommendation}`);
  }
  console.log(`  ✅ Terminal opportunity status → ABORT`);

  // Test 5: Stale plan → REPLAN
  const stalePlan = makePlan({
    created_at: new Date(Date.now() - 600_000).toISOString(), // 10 minutes ago
  });
  const result5 = PlanMonitor.check({
    plan: stalePlan,
    currentGatewayHealth: 0.95,
    currentCapacityAvailable: 5,
  });

  if (result5.is_still_valid) {
    throw new Error('Expected stale plan to be invalid');
  }
  if (!result5.violated_assumptions.some((a) => a.includes('plan_age'))) {
    throw new Error('Expected plan_age violation for stale plan');
  }
  console.log(`  ✅ Stale plan (10min) → REPLAN, age violation detected`);

  console.log('  ✅ PASS: Plan monitor validated — detects violations, recommends CONTINUE/REPLAN/ABORT.\n');
}

if (process.argv[1]?.endsWith('test_plan_monitor.ts')) {
  initDatabase();
  runPlanMonitorTests();
}
