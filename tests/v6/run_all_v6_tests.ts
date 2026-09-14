import { spawn } from 'node:child_process';

const v6Suites = [
  // Phase 4: Tenancy & Auth
  'tests/v6/test_tenant_isolation.ts',
  'tests/v6/test_authentication.ts',
  'tests/v6/test_api_keys.ts',
  'tests/v6/test_scopes.ts',

  // Phase 5: Event Connector & Ingestion
  'tests/v6/test_event_ingestion.ts',
  'tests/v6/test_event_idempotency.ts',
  'tests/v6/test_odoox_integration.ts',

  // Phase 6: Provider Adapter & Webhook Security
  'tests/v6/test_webhook_security.ts',
  'tests/v6/test_provider_connection.ts',

  // Phase 7: Unified Ledger & Reconciliation
  'tests/v6/test_ledger_immutability.ts',
  'tests/v6/test_reconciliation_accuracy.ts',
  'tests/v6/test_financial_state_machine.ts',

  // Phase 8: Economic Engine & Bayesian Calibration
  'tests/v6/test_iven_calculation.ts',
  'tests/v6/test_bayesian_calibration.ts',
  'tests/v6/test_counterfactual_attribution.ts',

  // Phase 9: Action Authority & Kill Switch
  'tests/v6/test_action_authority.ts',
  'tests/v6/test_kill_switch.ts',

  // Phase 10: Execution Layer & Resilience
  'tests/v6/test_execution_idempotency.ts',
  'tests/v6/test_rate_limiting.ts',
  'tests/v6/test_circuit_breaker.ts',

  // Phase 11: Agent Subsystem & Review Boundary
  'tests/v6/test_specialist_capabilities.ts',
  'tests/v6/test_human_review_boundary.ts',

  // Phase 12: Simulation Harness
  'tests/v6/test_synthetic_generator.ts',
  'tests/v6/test_simulation_scenarios.ts',

  // Phase 13: Enterprise Pacing, Anti-Blast & Provider Routing
  'tests/v6/test_enterprise_pacing_and_antiblast.ts',
  'tests/v6/test_provider_routing.ts',

  // Production Real Money & Environment Isolation
  'tests/v6/test_live_money_environment.ts',

  // Phase 14: Autonomous AI Agent Architecture
  'tests/v6/test_autonomous_agent.ts',
];

async function runSuite(suite: string): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(`\n▶️ Running v6 Suite: ${suite}...`);
    const child = spawn(process.execPath, ['./node_modules/tsx/dist/cli.mjs', '--test', suite], {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TEST_MODE: 'true',
      },
    });

    child.on('close', (code) => {
      resolve(code === 0);
    });
  });
}

async function main() {
  console.log('======================================================================');
  console.log('💎 CTRL v6 MASTER VERIFICATION: All 24 v6 Test Suites');
  console.log('======================================================================');

  let passed = 0;
  for (const suite of v6Suites) {
    const ok = await runSuite(suite);
    if (ok) passed++;
    else {
      console.error(`❌ Suite failed: ${suite}`);
      process.exit(1);
    }
  }

  console.log('\n======================================================================');
  console.log(`🏁 All ${passed}/${v6Suites.length} CTRL v6 Suites PASSED WITH ZERO FAILURES`);
  console.log('======================================================================');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
