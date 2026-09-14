import { runWebhookSecurityTests } from './test_webhook_security.js';
import { runApiSecurityTests } from './test_api_security_zod.js';
import { runExecutionResilienceTests } from './test_execution_resilience.js';
import { runBayesianEconomicsTests } from './test_bayesian_economics.js';
import { runDoubleEntryLedgerTests } from './test_double_entry_ledger.js';

async function runAllCoreHardeningTests() {
  console.log('======================================================================');
  console.log('🛡️ CTRL DETERMINISTIC CORE HARDENING TEST SUITE (DOMAIN B)');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  const testList: [string, () => Promise<void>][] = [
    ['B1: Webhook Security (IP, Timestamp, Multi-Secret Rotation, Size Limit, Audit)', runWebhookSecurityTests],
    ['B2: API Security & Strict Zod Validation (Schemas, JWT 30m Session, Rate Limits)', runApiSecurityTests],
    ['B3: Execution Resilience (Circuit Breaker 5-Open/30s-Reset, 10s Timeout, DLQ 5m/15m/1h/4h)', runExecutionResilienceTests],
    ['B4: Economic Engine Hardening (Bayesian Beta Priors, A/B Testing, 24h Fatigue)', runBayesianEconomicsTests],
    ['B5: Truth Engine & Double-Entry Ledger (Accounts, SHA-256 Hash Chain, SLAs, Divergence)', runDoubleEntryLedgerTests],
  ];

  for (const [name, fn] of testList) {
    try {
      await fn();
      passed++;
    } catch (err: any) {
      console.error(`❌ FAILED: ${name}`);
      console.error(err);
      failed++;
    }
  }

  console.log('\n======================================================================');
  console.log(`🏁 CORE HARDENING SUITE: ${passed} PASSED | ${failed} FAILED`);
  console.log('======================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllCoreHardeningTests();
