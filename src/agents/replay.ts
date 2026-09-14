import crypto from 'node:crypto';
import {
  getAgentRunById,
  getAgentStatesByRunId,
  getAgentToolCallsByRunId,
  getAgentPlansByRunId,
  getAgentProposalsByOpportunityId,
  getAgentAuthorityChecksByRunId,
} from '../db/database.js';
import {
  MissionFingerprint,
  ReplayVerificationResult,
} from './types.js';

/**
 * CTRL v5.1 — Mission Replay & Cryptographic Fingerprinting Engine
 *
 * Provides cryptographic tamper-evident fingerprinting and deterministic
 * replay verification across all autonomous agent runs.
 *
 * Invariants:
 *   ✅ Deterministic SHA-256 fingerprint covers: states, tool calls, proposals, authority checks
 *   ✅ Divergence detection pinpoints the exact phase/stage of divergence
 *   ✅ Does NOT modify historical telemetry or state
 */
export class MissionReplayEngine {
  /**
   * Generates a cryptographic SHA-256 fingerprint for a given mission run.
   */
  public static generateFingerprint(runId: string): MissionFingerprint {
    const run = getAgentRunById(runId);
    if (!run) {
      throw new Error(`Agent run '${runId}' not found in telemetry store.`);
    }

    const states = getAgentStatesByRunId(runId);
    const tools = getAgentToolCallsByRunId(runId);
    const plans = getAgentPlansByRunId(runId);
    const checks = getAgentAuthorityChecksByRunId(runId);
    const proposals = run.opportunity_id
      ? getAgentProposalsByOpportunityId(run.opportunity_id).filter((p) => p.run_id === runId)
      : [];

    const stateSequence = states.map((s) => s.state);
    const toolCallHashes = tools.map((t) => `${t.tool_name}:${t.input_hash}:${t.output_hash}:${t.status}`);
    const proposalHashes = proposals.map((p) => `${p.proposal_type}:${p.status}`);
    const authorityVerdicts = checks.map((c) => `${c.check_name}:${c.passed ? '1' : '0'}`);

    const canonicalString = [
      `OPP:${run.opportunity_id || 'NONE'}`,
      `GOAL:${run.goal_type}`,
      `STATES:${stateSequence.join('->')}`,
      `TOOLS:${toolCallHashes.join('|')}`,
      `PLANS:${plans.map((pl) => `${pl.plan_version}:${pl.preferred_action}`).join('|')}`,
      `PROPOSALS:${proposalHashes.join('|')}`,
      `CHECKS:${authorityVerdicts.join('|')}`,
      `STATUS:${run.status}`,
    ].join(':::');

    const fingerprint = crypto.createHash('sha256').update(canonicalString).digest('hex');

    return {
      run_id: runId,
      opportunity_id: run.opportunity_id || '',
      fingerprint_sha256: fingerprint,
      state_sequence: stateSequence,
      tool_call_hashes: toolCallHashes,
      proposal_hashes: proposalHashes,
      authority_verdicts: authorityVerdicts,
      generated_at: new Date().toISOString(),
    };
  }

  /**
   * Compares an original mission run with a replay run to verify deterministic consistency.
   */
  public static verifyReplay(originalRunId: string, replayRunId: string): ReplayVerificationResult {
    const origFp = this.generateFingerprint(originalRunId);
    const replayFp = this.generateFingerprint(replayRunId);

    const isMatch = origFp.fingerprint_sha256 === replayFp.fingerprint_sha256;

    if (isMatch) {
      return {
        original_run_id: originalRunId,
        replay_run_id: replayRunId,
        is_match: true,
        original_fingerprint: origFp.fingerprint_sha256,
        replay_fingerprint: replayFp.fingerprint_sha256,
        divergence_detected: false,
        divergence_stage: null,
        divergence_details: null,
        verified_at: new Date().toISOString(),
      };
    }

    // Identify stage of divergence
    let divergenceStage = 'UNKNOWN';
    let divergenceDetails = 'Fingerprints differ.';

    if (origFp.state_sequence.join('->') !== replayFp.state_sequence.join('->')) {
      divergenceStage = 'STATE_TRANSITIONS';
      divergenceDetails = `Original states [${origFp.state_sequence.join(', ')}] !== Replay states [${replayFp.state_sequence.join(', ')}]`;
    } else if (origFp.tool_call_hashes.join('|') !== replayFp.tool_call_hashes.join('|')) {
      divergenceStage = 'TOOL_CALLS';
      divergenceDetails = `Original tools [${origFp.tool_call_hashes.join(', ')}] !== Replay tools [${replayFp.tool_call_hashes.join(', ')}]`;
    } else if (origFp.authority_verdicts.join('|') !== replayFp.authority_verdicts.join('|')) {
      divergenceStage = 'AUTHORITY_CHECKS';
      divergenceDetails = `Original checks [${origFp.authority_verdicts.join(', ')}] !== Replay checks [${replayFp.authority_verdicts.join(', ')}]`;
    } else if (origFp.proposal_hashes.join('|') !== replayFp.proposal_hashes.join('|')) {
      divergenceStage = 'PROPOSALS';
      divergenceDetails = `Original proposals [${origFp.proposal_hashes.join(', ')}] !== Replay proposals [${replayFp.proposal_hashes.join(', ')}]`;
    }

    return {
      original_run_id: originalRunId,
      replay_run_id: replayRunId,
      is_match: false,
      original_fingerprint: origFp.fingerprint_sha256,
      replay_fingerprint: replayFp.fingerprint_sha256,
      divergence_detected: true,
      divergence_stage: divergenceStage,
      divergence_details: divergenceDetails,
      verified_at: new Date().toISOString(),
    };
  }
}
