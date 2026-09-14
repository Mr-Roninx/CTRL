import { spawn } from 'node:child_process';

const suites = [
  'tests/v6/test_ledger_immutability.ts',
  'tests/v6/test_reconciliation_accuracy.ts',
  'tests/v6/test_financial_state_machine.ts',
];

async function runSuite(suite: string): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(`\n▶️ Running Phase 7 Suite: ${suite}...`);
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
  console.log('⚖️ CTRL v6 Phase 7: Unified Ledger & Real-Time Reconciliation');
  console.log('======================================================================');

  let passed = 0;
  for (const suite of suites) {
    const ok = await runSuite(suite);
    if (ok) passed++;
    else {
      console.error(`❌ Suite failed: ${suite}`);
      process.exit(1);
    }
  }

  console.log('\n======================================================================');
  console.log(`🏁 All ${passed}/${suites.length} Phase 7 Unified Ledger Suites PASSED`);
  console.log('======================================================================');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
