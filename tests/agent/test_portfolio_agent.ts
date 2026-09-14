import dotenv from 'dotenv';
import path from 'node:path';
import { initDatabase, upsertOpportunity, upsertCustomer } from '../../src/db/database.js';
import { PortfolioAgent } from '../../src/agents/portfolio_agent.js';
import { scoreOpportunity } from '../../src/economics/scorer.js';
import { RecoveryOpportunity } from '../../src/types/index.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const TEST_OPPS: RecoveryOpportunity[] = [
  {
    id: 'portfolio_test_01_high_iven',
    source: 'synthetic',
    amount_paise: 500000,
    currency: 'INR',
    reason_code: 'expired_card',
    decline_type: 'soft',
    attempt_count: 1,
    customer_id: 'cust_pf_01',
    customer_trust_score: 0.9,
    created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    status: 'pending',
  },
  {
    id: 'portfolio_test_02_hard_decline',
    source: 'synthetic',
    amount_paise: 300000,
    currency: 'INR',
    reason_code: 'stolen_card',
    decline_type: 'hard',
    attempt_count: 1,
    customer_id: 'cust_pf_02',
    customer_trust_score: 0.1,
    created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
    status: 'pending',
  },
  {
    id: 'portfolio_test_03_medium_iven',
    source: 'synthetic',
    amount_paise: 200000,
    currency: 'INR',
    reason_code: 'insufficient_funds',
    decline_type: 'soft',
    attempt_count: 2,
    customer_id: 'cust_pf_03',
    customer_trust_score: 0.6,
    created_at: new Date(Date.now() - 3600000 * 10).toISOString(),
    status: 'pending',
  },
  {
    id: 'portfolio_test_04_low_iven',
    source: 'synthetic',
    amount_paise: 50000,
    currency: 'INR',
    reason_code: 'generic_decline',
    decline_type: 'soft',
    attempt_count: 1,
    customer_id: 'cust_pf_04',
    customer_trust_score: 0.7,
    created_at: new Date(Date.now() - 3600000 * 1).toISOString(),
    status: 'scored',
  },
  {
    id: 'portfolio_test_05_fatigued',
    source: 'synthetic',
    amount_paise: 150000,
    currency: 'INR',
    reason_code: 'insufficient_funds',
    decline_type: 'soft',
    attempt_count: 4,
    customer_id: 'cust_pf_05',
    customer_trust_score: 0.3,
    created_at: new Date(Date.now() - 3600000 * 20).toISOString(),
    status: 'deferred',
  },
];

export function runPortfolioAgentTests() {
  console.log('🧪 Running Test: Portfolio Agent (Multi-Opportunity)...');

  initDatabase();

  // Seed test opportunities
  for (const opp of TEST_OPPS) {
    upsertCustomer({ id: opp.customer_id, trust_score: opp.customer_trust_score, created_at: opp.created_at, updated_at: opp.created_at });
    upsertOpportunity(opp);
    scoreOpportunity(opp);
  }

  // Test 1: Portfolio sweep scans all pending/scored/deferred opportunities
  const proposal = PortfolioAgent.sweep({ capacity: 3, gatewayHealth: 0.95 });

  if (proposal.total_scanned < TEST_OPPS.length) {
    throw new Error(`Expected at least ${TEST_OPPS.length} scanned, got ${proposal.total_scanned}`);
  }
  console.log(`  ✅ Portfolio sweep scanned ${proposal.total_scanned} opportunities`);

  // Test 2: Priorities are sorted by priority_score descending
  for (let i = 1; i < proposal.priorities.length; i++) {
    if (proposal.priorities[i].priority_score > proposal.priorities[i - 1].priority_score) {
      throw new Error(`Priority ordering broken at index ${i}: ${proposal.priorities[i].priority_score} > ${proposal.priorities[i - 1].priority_score}`);
    }
  }
  console.log(`  ✅ Priorities sorted descending by priority_score`);

  // Test 3: Hard decline is NOT recommended for ACT
  const hardEntry = proposal.priorities.find((p) => p.opportunity_id === 'portfolio_test_02_hard_decline');
  if (!hardEntry) {
    throw new Error('Hard decline opportunity not found in priorities');
  }
  if (hardEntry.proposed_action === 'ACT') {
    throw new Error(`Hard decline should NOT be proposed as ACT, got ${hardEntry.proposed_action}`);
  }
  console.log(`  ✅ Hard decline → proposed_action=${hardEntry.proposed_action} (not ACT)`);

  // Test 4: top_k_recommendations respects capacity
  if (proposal.top_k_recommendations.length > 3) {
    throw new Error(`Top-K exceeds capacity: ${proposal.top_k_recommendations.length} > 3`);
  }
  // Hard decline should not be in top-K
  if (proposal.top_k_recommendations.includes('portfolio_test_02_hard_decline')) {
    throw new Error('Hard decline should not appear in top-K recommendations');
  }
  console.log(`  ✅ Top-K recommendations: [${proposal.top_k_recommendations.join(', ')}] (capacity=3)`);

  // Test 5: High-IVEN opportunity should rank higher than low-IVEN
  const highEntry = proposal.priorities.find((p) => p.opportunity_id === 'portfolio_test_01_high_iven');
  const lowEntry = proposal.priorities.find((p) => p.opportunity_id === 'portfolio_test_04_low_iven');
  if (highEntry && lowEntry && highEntry.priority_score <= lowEntry.priority_score) {
    throw new Error(`High-IVEN (${highEntry.priority_score}) should rank above low-IVEN (${lowEntry.priority_score})`);
  }
  console.log(`  ✅ High-IVEN ranks above low-IVEN`);

  // Test 6: Deterministic — same inputs, same output
  const proposal2 = PortfolioAgent.sweep({ capacity: 3, gatewayHealth: 0.95 });
  for (let i = 0; i < proposal.priorities.length; i++) {
    if (proposal.priorities[i].priority_score !== proposal2.priorities[i].priority_score) {
      throw new Error(`Non-deterministic: index ${i} scores differ (${proposal.priorities[i].priority_score} vs ${proposal2.priorities[i].priority_score})`);
    }
  }
  console.log(`  ✅ Deterministic: repeated sweep yields identical priority scores`);

  // Test 7: Portfolio Agent does NOT have execution capability
  // Verify it returns a proposal, not an execution result
  if ('execution_link_id' in proposal || 'razorpay_payment_link_id' in proposal) {
    throw new Error('Portfolio Agent must NOT produce execution artifacts');
  }
  console.log(`  ✅ Portfolio Agent produces proposals only — zero execution capability`);

  // Test 8: Portfolio summary is non-empty
  if (!proposal.portfolio_summary || proposal.portfolio_summary.length < 10) {
    throw new Error('Portfolio summary should be non-empty and descriptive');
  }
  console.log(`  ✅ Portfolio summary present: "${proposal.portfolio_summary.substring(0, 80)}..."`);

  console.log('  ✅ PASS: Portfolio agent validated — scans, ranks, proposes, no execution authority.\n');
}

if (process.argv[1]?.endsWith('test_portfolio_agent.ts')) {
  runPortfolioAgentTests();
}
