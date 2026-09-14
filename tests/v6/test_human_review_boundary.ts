process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseAdapter } from '../../src/db/adapter.js';
import { MigrationRunner } from '../../src/db/migrations/runner.js';
import { OutreachAgent } from '../../src/agents/specialists/outreach_agent.js';
import {
  insertOpportunity,
  updateOutreachDraftStatus,
  getOutreachDraftsByOpportunityId,
} from '../../src/db/database.js';
import { RecoveryOpportunity } from '../../src/types/index.js';

describe('V6 Phase 11: Human-in-the-Loop Review Boundary & Outreach Safety', () => {
  before(async () => {
    const db = DatabaseAdapter.getInstance();
    await MigrationRunner.migrateUp(db);
  });

  const testOpp: RecoveryOpportunity = {
    id: `opp_review_test_${Date.now()}`,
    source: 'real',
    amount_paise: 750000,
    currency: 'INR',
    reason_code: 'insufficient_funds',
    decline_type: 'soft',
    attempt_count: 1,
    customer_id: 'cust_review_01@merchant.com',
    customer_trust_score: 90,
    created_at: new Date().toISOString(),
    status: 'authorized',
  };

  it('holds newly generated outreach drafts in PENDING_REVIEW status', async () => {
    insertOpportunity(testOpp);

    const draft = await OutreachAgent.draftCustomerCommunication({
      runId: `run_review_${Date.now()}`,
      opportunity: testOpp,
      channel: 'WHATSAPP',
      paymentLinkUrl: 'https://rzp.io/i/plink_review_test_01',
    });

    assert.equal(draft.status, 'PENDING_REVIEW');
    assert.equal(draft.opportunity_id, testOpp.id);
    assert.ok(draft.body.includes('7500.00'));

    const storedDrafts = getOutreachDraftsByOpportunityId(testOpp.id);
    assert.ok(storedDrafts.length >= 1);
    const latest = storedDrafts[0];
    assert.equal(latest.status, 'PENDING_REVIEW');
  });

  it('allows human operator to approve draft for dispatch', () => {
    const storedDrafts = getOutreachDraftsByOpportunityId(testOpp.id);
    const draftId = storedDrafts[0].id;

    // Operator approves the draft
    updateOutreachDraftStatus(draftId, 'APPROVED', 'Approved by Senior Collections Lead');

    const updatedDrafts = getOutreachDraftsByOpportunityId(testOpp.id);
    const approvedDraft = updatedDrafts.find((d) => d.id === draftId);

    assert.equal(approvedDraft?.status, 'APPROVED');
    assert.equal(approvedDraft?.review_feedback, 'Approved by Senior Collections Lead');
  });

  it('allows human operator to reject draft with compliance feedback notes', () => {
    const storedDrafts = getOutreachDraftsByOpportunityId(testOpp.id);
    const draftId = storedDrafts[0].id;

    // Operator rejects the draft with compliance feedback
    updateOutreachDraftStatus(draftId, 'REJECTED', 'Violates merchant tone guidelines; rephrase urgency');

    const updatedDrafts = getOutreachDraftsByOpportunityId(testOpp.id);
    const rejectedDraft = updatedDrafts.find((d) => d.id === draftId);

    assert.equal(rejectedDraft?.status, 'REJECTED');
    assert.equal(rejectedDraft?.review_feedback, 'Violates merchant tone guidelines; rephrase urgency');
  });
});
