import { spawn } from 'node:child_process';

const suites = [
  'tests/v6/test_tenant_isolation.ts',
  'tests/v6/test_authentication.ts',
  'tests/v6/test_api_keys.ts',
  'tests/v6/test_scopes.ts',
];

async function runSuite(suite: string): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(`\n▶️ Running Phase 4 Suite: ${suite}...`);
    const child = spawn(process.execPath, ['./node_modules/tsx/dist/cli.mjs', '--test', suite], {
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      resolve(code === 0);
    });
  });
}

async function main() {
  console.log('======================================================================');
  console.log('🛡️ CTRL v6 Phase 4: Multi-Tenant & API Key Platform Verification');
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
  console.log(`🏁 All ${passed}/${suites.length} Phase 4 Multi-Tenant Verification Suites PASSED`);
  console.log('======================================================================');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
