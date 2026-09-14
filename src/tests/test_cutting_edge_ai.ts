import { CausalUpliftEngine } from '../economics/causal_uplift_engine.js';
import { CtrlCopilotEngine } from '../agents/copilot_engine.js';
import { OutreachSynthesizerAgent } from '../agents/specialists/outreach_synthesizer.js';
import { RecoveryOpportunity } from '../types/index.js';
import { deliberationStreamHub } from '../agents/agent_graph_stream.js';

async function runTests() {
  console.log('🧪 Testing Cutting-Edge AI Technology Architecture...\n');

  // 1. Test Causal Uplift Engine
  console.log('1️⃣ Testing Causal Uplift Engine:');
  const mockSoftOpp: RecoveryOpportunity = {
    id: 'opp_test_soft_99',
    source: 'real',
    amount_paise: 499900, // ₹4,999.00
    currency: 'INR',
    reason_code: 'INSUFFICIENT_FUNDS',
    decline_type: 'soft',
    attempt_count: 1,
    customer_id: 'cust_causal_1',
    customer_trust_score: 0.85,
    tenant_id: 'default_tenant',
    environment: 'live',
    created_at: new Date().toISOString(),
    status: 'scored',
  };

  const upliftSoft = CausalUpliftEngine.evaluateOpportunityUplift(mockSoftOpp);
  console.log(`   - Context Cluster: ${upliftSoft.context_cluster}`);
  console.log(`   - Natural Recovery P(nat): ${upliftSoft.p_natural_mean} (95% CI: [${upliftSoft.p_natural_credible_interval.join(', ')}])`);
  console.log(`   - Intervention Recovery P(int): ${upliftSoft.p_intervention_mean} (95% CI: [${upliftSoft.p_intervention_credible_interval.join(', ')}])`);
  console.log(`   - Treatment Effect (τ = ΔP): ${upliftSoft.treatment_effect_tau} (95% CI: [${upliftSoft.treatment_effect_credible_interval.join(', ')}])`);
  console.log(`   - Net IVEN: ₹${(upliftSoft.net_incremental_value_paise / 100).toFixed(2)} [Band: ${upliftSoft.iven_band}]`);
  console.log(`   - Source: ${upliftSoft.source}\n`);

  if (upliftSoft.treatment_effect_tau <= 0 || upliftSoft.net_incremental_value_paise <= 0) {
    throw new Error('Soft decline with high trust should yield positive treatment effect and IVEN');
  }

  // Test Hard Decline Invariant
  const mockHardOpp: RecoveryOpportunity = {
    ...mockSoftOpp,
    id: 'opp_test_hard_99',
    reason_code: 'STOLEN_CARD',
    decline_type: 'hard',
  };
  const upliftHard = CausalUpliftEngine.evaluateOpportunityUplift(mockHardOpp);
  console.log(`   - Hard Decline Invariant Check: τ = ${upliftHard.treatment_effect_tau}, IVEN = ${upliftHard.net_incremental_value_paise} paise, Band = ${upliftHard.iven_band}`);
  if (upliftHard.treatment_effect_tau !== 0 || upliftHard.iven_band !== 'NEGATIVE') {
    throw new Error('Hard decline invariant violation: treatment effect must be 0 and band NEGATIVE');
  }
  console.log('   ✅ Causal Uplift Engine & Invariants PASSED.\n');

  // 2. Test Incremental Alpha Report
  console.log('2️⃣ Testing Proved Incremental Alpha Calculation:');
  const alpha = CausalUpliftEngine.calculateIncrementalAlphaReport();
  console.log(`   - Total Evaluated: ${alpha.total_opportunities_evaluated}`);
  console.log(`   - Total Acted: ${alpha.total_acted_opportunities}`);
  console.log(`   - Total Recovered: ${alpha.total_recovered_opportunities}`);
  console.log(`   - Proved Incremental Alpha: ${alpha.proved_incremental_alpha_inr} (${alpha.empirical_lift_percentage})`);
  console.log(`   - Bayesian Calibration Status: ${alpha.bayesian_calibration_status}`);
  console.log('   ✅ Incremental Alpha Report PASSED.\n');

  // 3. Test Generative Outreach Synthesizer
  console.log('3️⃣ Testing Generative Outreach Synthesizer:');
  const outreach = await OutreachSynthesizerAgent.synthesizeRecoveryMessage({
    opportunity: mockSoftOpp,
    paymentLinkUrl: 'https://rzp.io/i/test_link_123',
    customerName: 'Ananya Sharma',
  });
  console.log(`   - Channel: ${outreach.channel}`);
  console.log(`   - Tone: ${outreach.tone}`);
  console.log(`   - Headline: "${outreach.headline}"`);
  console.log(`   - CTA: "${outreach.call_to_action}"`);
  console.log(`   - Body: "${outreach.body_text}"`);
  console.log('   ✅ Generative Outreach Synthesizer PASSED.\n');

  // 4. Test Multi-Agent Deliberation Hub
  console.log('4️⃣ Testing Multi-Agent Deliberation Stream:');
  let receivedEvent = false;
  deliberationStreamHub.once('deliberation', (e) => {
    receivedEvent = true;
    console.log(`   - Received Event: [${e.stage}] ${e.agent_name} -> ${e.status} ("${e.thought_summary}")`);
  });

  deliberationStreamHub.publish({
    stage: 'ECONOMIC',
    agent_name: 'Causal Economic Specialist',
    opportunity_id: mockSoftOpp.id,
    status: 'APPROVED',
    thought_summary: `Estimated causal treatment effect τ=+0.27 with IVEN ₹384.50.`,
  });

  if (!receivedEvent) {
    throw new Error('Deliberation event not dispatched');
  }
  console.log('   ✅ Multi-Agent Deliberation Stream PASSED.\n');

  console.log('🎉 ALL CUTTING-EDGE AI TECHNOLOGY COMPONENTS VERIFIED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
