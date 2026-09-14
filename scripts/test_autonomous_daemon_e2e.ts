import { initDatabase, insertOpportunity, getAllOpportunities, getDaemonSweepLogs } from '../src/db/database.js';
import { AutonomousRecoveryDaemon } from '../src/agents/daemon.js';
import { MigrationRunner } from '../src/db/migrations/runner.js';
import { RecoveryOpportunity } from '../src/types/index.js';
import crypto from 'node:crypto';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('🧪 Starting Autonomous Daemon E2E Test\n');

  // 1. Init DB
  initDatabase();
  await MigrationRunner.migrateUp();
  console.log('✅ Database initialized');

  // 2. Seed Opportunities
  const tenantId = 'tenant_daemon_test';
  
  const seedOpps: RecoveryOpportunity[] = [
    {
      id: `opp_${Date.now()}_1`,
      source: 'synthetic',
      amount_paise: 50000, // ₹500
      currency: 'INR',
      reason_code: 'insufficient_funds',
      decline_type: 'soft',
      attempt_count: 1,
      customer_id: 'cust_daemon_1',
      customer_trust_score: 0.9,
      status: 'pending',
      created_at: new Date().toISOString(),
      tenant_id: tenantId,
    },
    {
      id: `opp_${Date.now()}_2`,
      source: 'synthetic',
      amount_paise: 150000, // ₹1500
      currency: 'INR',
      reason_code: 'stolen_card', // hard decline
      decline_type: 'hard',
      attempt_count: 1,
      customer_id: 'cust_daemon_2',
      customer_trust_score: 0.9,
      status: 'pending',
      created_at: new Date().toISOString(),
      tenant_id: tenantId,
    }
  ];

  for (const opp of seedOpps) {
    insertOpportunity(opp);
  }
  console.log('✅ Seeded 2 test opportunities (1 soft decline, 1 hard decline)');

  // 3. Start Daemon
  const daemon = AutonomousRecoveryDaemon.getInstance();
  console.log('🤖 Starting daemon with 2-second interval, capacity 3...');
  daemon.start({ interval_seconds: 2, capacity: 3 });

  // 4. Wait for 2 sweeps
  console.log('⏳ Waiting 5 seconds for daemon sweeps to complete...');
  await delay(5000);

  // 5. Stop Daemon
  console.log('🛑 Stopping daemon...');
  daemon.stop();

  // 6. Assertions
  const status = daemon.getStatus();
  if (status.state !== 'STOPPED') {
    throw new Error(`Expected daemon state STOPPED, got ${status.state}`);
  }
  console.log('✅ Daemon stopped successfully');

  const logs = getDaemonSweepLogs(10);
  if (logs.length < 2) {
    throw new Error(`Expected at least 2 sweep logs, got ${logs.length}`);
  }
  
  console.log(`✅ Found ${logs.length} sweep logs in DB`);

  const opps = getAllOpportunities(tenantId);
  const softOpp = opps.find(o => o.id === seedOpps[0].id);
  const hardOpp = opps.find(o => o.id === seedOpps[1].id);

  if (!softOpp || !hardOpp) {
    throw new Error('Failed to retrieve test opportunities');
  }

  // Soft opp should be executing or recovered (since Razorpay API is called)
  if (softOpp.status === 'pending') {
    throw new Error(`Soft decline opportunity was not processed, status remains: ${softOpp.status}`);
  }
  console.log(`✅ Soft decline opportunity correctly processed (status: ${softOpp.status})`);

  // Hard opp should be abstained/blocked
  if (hardOpp.status !== 'abstained' && hardOpp.status !== 'blocked') {
    throw new Error(`Hard decline opportunity was incorrectly processed, status: ${hardOpp.status}`);
  }
  console.log(`✅ Hard decline opportunity correctly blocked (status: ${hardOpp.status})`);

  console.log('\n🎉 Autonomous Daemon E2E Test Passed!');
  process.exit(0);
}

runTest().catch(err => {
  console.error('\n❌ E2E Test Failed:', err);
  process.exit(1);
});
