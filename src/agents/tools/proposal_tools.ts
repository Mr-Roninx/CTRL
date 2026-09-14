import crypto from 'node:crypto';
import {
  insertAgentProposal,
  insertPerceptionAnnotation,
  insertOutreachDraft,
} from '../../db/database.js';

export interface ProposalToolResult<T = any> {
  success: boolean;
  proposal_id?: string;
  data?: T;
  error?: string;
  timestamp: string;
}

export async function createAgentProposalTool(params: {
  run_id: string;
  opportunity_id: string;
  proposal_type: 'INTERVENTION' | 'RETRY_DELAY' | 'PARAMETER_UPDATE' | 'OUTREACH';
  payload: Record<string, any>;
}): Promise<ProposalToolResult> {
  const proposalId = `prop_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  insertAgentProposal({
    id: proposalId,
    run_id: params.run_id,
    opportunity_id: params.opportunity_id,
    proposal_type: params.proposal_type,
    payload: params.payload,
    status: 'PENDING',
    review_notes: null,
    created_at: new Date().toISOString(),
  });

  return {
    success: true,
    proposal_id: proposalId,
    data: { id: proposalId, status: 'PENDING', proposal_type: params.proposal_type },
    timestamp: new Date().toISOString(),
  };
}

export async function createPerceptionAnnotationTool(params: {
  opportunity_id: string;
  failure_intent: string;
  customer_urgency_score: number;
  merchant_risk_score: number;
  semantic_notes: string;
  confidence: number;
}): Promise<ProposalToolResult> {
  const annotationId = `annot_${params.opportunity_id}`;
  const clampedUrgency = Math.max(0, Math.min(1, params.customer_urgency_score));
  const clampedRisk = Math.max(0, Math.min(1, params.merchant_risk_score));
  const clampedConfidence = Math.max(0, Math.min(1, params.confidence));

  insertPerceptionAnnotation({
    id: annotationId,
    opportunity_id: params.opportunity_id,
    failure_intent: params.failure_intent,
    customer_urgency_score: clampedUrgency,
    merchant_risk_score: clampedRisk,
    semantic_notes: params.semantic_notes,
    confidence: clampedConfidence,
    created_at: new Date().toISOString(),
  });

  return {
    success: true,
    proposal_id: annotationId,
    data: { id: annotationId, opportunity_id: params.opportunity_id },
    timestamp: new Date().toISOString(),
  };
}

export async function createStrategyProposalTool(params: {
  run_id: string;
  opportunity_id: string;
  proposed_natural_prob_delta?: number;
  proposed_intervention_prob_delta?: number;
  empirical_sample_size: number;
  justification: string;
}): Promise<ProposalToolResult> {
  if (params.empirical_sample_size < 30) {
    return {
      success: false,
      error: `Evidence Threshold Violation: Strategy calibration proposals require >= 30 real historical outcomes (got ${params.empirical_sample_size}). Proposal rejected.`,
      timestamp: new Date().toISOString(),
    };
  }

  const proposalId = `strat_prop_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  insertAgentProposal({
    id: proposalId,
    run_id: params.run_id,
    opportunity_id: params.opportunity_id,
    proposal_type: 'PARAMETER_UPDATE',
    payload: {
      proposed_natural_prob_delta: params.proposed_natural_prob_delta,
      proposed_intervention_prob_delta: params.proposed_intervention_prob_delta,
      empirical_sample_size: params.empirical_sample_size,
      justification: params.justification,
    },
    status: 'PENDING',
    review_notes: 'Requires human operator or supervisor validation before updating live constants',
    created_at: new Date().toISOString(),
  });

  return {
    success: true,
    proposal_id: proposalId,
    data: { id: proposalId, status: 'PENDING' },
    timestamp: new Date().toISOString(),
  };
}

export async function createOutreachDraftTool(params: {
  run_id: string;
  opportunity_id: string;
  channel: 'SMS' | 'WHATSAPP' | 'EMAIL';
  recipient: string;
  subject?: string;
  body: string;
  compliance_footer?: string;
}): Promise<ProposalToolResult> {
  const draftId = `draft_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const defaultFooter = 'CTRL Autonomous Recovery • Standard messaging rates may apply • Reply STOP to unsubscribe • Merchant Support';
  const footer = params.compliance_footer || defaultFooter;

  insertOutreachDraft({
    id: draftId,
    run_id: params.run_id,
    opportunity_id: params.opportunity_id,
    channel: params.channel,
    recipient: params.recipient,
    subject: params.subject || null,
    body: params.body,
    compliance_footer: footer,
    status: 'PENDING_REVIEW',
    review_feedback: null,
    created_at: new Date().toISOString(),
  });

  return {
    success: true,
    proposal_id: draftId,
    data: { id: draftId, status: 'PENDING_REVIEW', channel: params.channel },
    timestamp: new Date().toISOString(),
  };
}
