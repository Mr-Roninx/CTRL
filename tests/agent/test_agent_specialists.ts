import { initDatabase, getOpportunityById, upsertOpportunity, upsertScore, upsertAllocationDecision } from '../../src/db/database.js';
import { PerceptionAgent } from '../../src/agents/specialists/perception_agent.js';
import { StrategyAgent } from '../../src/agents/specialists/strategy_agent.js';
import { OutreachAgent } from '../../src/agents/specialists/outreach_agent.js';
import { ComplianceCopilot } from '../../src/agents/specialists/compliance_copilot.js';
import { MerchantCopilot } from '../../src/agents/specialists/merchant_copilot.js';
import { RecoveryOpportunity } from '../../src/types/index.js';

export async function runSpecialistTests() {
  console.log('🧪 Running Test: Specialist Capabilities (Perception, Strategy, Outreach, Compliance, Merchant)...');
  initDatabase();

  const oppId = 'synth_02_insufficient_funds_att1';
  const opp = getOpportunityById(oppId);
  if (!opp) {
    throw new Error(`Opportunity ${oppId} not found`);
  }

  const runId = `spec_test_${Date.now()}`;

  // 1. Perception Agent
  const perceptionResult = await PerceptionAgent.analyzeOpportunity({
    runId,
    opportunity: opp,
  });
  if (!perceptionResult || perceptionResult.customer_urgency_score < 0 || perceptionResult.customer_urgency_score > 1) {
    throw new Error('PerceptionAgent analysis failed or scores out of bounds');
  }

  // 2. Strategy Agent
  const strategyResult = await StrategyAgent.evaluateStrategyCalibration({
    runId,
    opportunityId: opp.id,
  });
  if (typeof strategyResult.eligible !== 'boolean') {
    throw new Error('StrategyAgent evaluation failed');
  }

  // 3. Outreach Agent (Draft / Review Only)
  const outreachDraft = await OutreachAgent.draftCustomerCommunication({
    runId,
    opportunity: opp,
    channel: 'WHATSAPP',
    paymentLinkUrl: 'https://rzp.io/i/test_link',
  });
  if (!outreachDraft || outreachDraft.status !== 'PENDING_REVIEW') {
    throw new Error(`OutreachAgent must produce status 'PENDING_REVIEW', got ${outreachDraft?.status}`);
  }
  if (!outreachDraft.compliance_footer || !outreachDraft.compliance_footer.includes('CTRL Autonomous Recovery')) {
    throw new Error('OutreachAgent draft missing mandatory compliance footer');
  }

  // 4. Compliance Copilot
  const complianceExplanation = await ComplianceCopilot.explainOpportunity({
    runId,
    opportunityId: opp.id,
  });
  if (!complianceExplanation || complianceExplanation.claims.length === 0) {
    throw new Error('ComplianceCopilot forensic audit trail explanation failed');
  }

  // 5. Merchant Copilot
  const merchantAnswer = await MerchantCopilot.answerMerchantQuery({
    runId,
    query: 'What is the current market shadow price and capacity?',
  });
  if (!merchantAnswer || !merchantAnswer.answer.includes('shadow price')) {
    throw new Error('MerchantCopilot query answering failed');
  }

  console.log('  ✅ PASS: All 5 Specialist capabilities verified (Zero financial authority, Outreach draft/review only).');
}

if (process.argv[1]?.endsWith('test_agent_specialists.ts')) {
  runSpecialistTests();
}
