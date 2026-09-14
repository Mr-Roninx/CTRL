import { RecoveryOpportunity } from '../../types/index.js';
import { AgentToolRegistry } from '../tool_registry.js';

export interface ForensicAuditClaim {
  table: string;
  record_id: string;
  field: string;
  value: any;
  explanation: string;
}

export interface ComplianceExplanationResult {
  opportunity_id: string;
  audit_verified: boolean;
  claims: ForensicAuditClaim[];
  structured_summary: {
    economic_rationale: string;
    market_capacity_rationale: string;
    authority_compliance_rationale: string;
  };
  generated_at: string;
}

export class ComplianceCopilot {
  /**
   * Evaluates hard regulatory and safety invariants before any recovery action is dispatched.
   * Enforces RBI guidelines:
   * 1. Hard decline codes are blocked strictly
   * 2. Max 3 attempts in 24 hours
   * 3. Do-Not-Disturb (DND) window: 9:00 PM to 8:00 AM IST
   */
  public static checkPreExecutionCompliance(opp: RecoveryOpportunity): {
    dnd_active: boolean;
    contact_limit_exceeded: boolean;
    hard_decline_blocked: boolean;
    can_proceed: boolean;
    veto_reason?: string;
  } {
    const reason = (opp.reason_code || '').toUpperCase();
    const hardReasons = ['STOLEN_CARD', 'LOST_CARD', 'FRAUD', 'FRAUD_SUSPECTED', 'EXPIRED_CARD', 'PICKUP_CARD'];
    const isHardDecline = opp.decline_type === 'hard' || hardReasons.some((r) => reason.includes(r));

    if (isHardDecline) {
      return {
        dnd_active: false,
        contact_limit_exceeded: false,
        hard_decline_blocked: true,
        can_proceed: false,
        veto_reason: `Action blocked: Hard decline / security stop code '${opp.reason_code}'.`,
      };
    }

    const contactLimitExceeded = opp.attempt_count >= 3;
    if (contactLimitExceeded) {
      return {
        dnd_active: false,
        contact_limit_exceeded: true,
        hard_decline_blocked: false,
        can_proceed: false,
        veto_reason: `Action blocked: RBI contact threshold reached (attempt ${opp.attempt_count} of max 3).`,
      };
    }

    // Check IST time for DND window (21:00 to 08:00 IST)
    const nowUtc = new Date();
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(nowUtc.getTime() + istOffsetMs);
    const istHour = istTime.getUTCHours();
    const isDnd = istHour >= 21 || istHour < 8;

    if (isDnd) {
      return {
        dnd_active: true,
        contact_limit_exceeded: false,
        hard_decline_blocked: false,
        can_proceed: false,
        veto_reason: `Action deferred: Current time (${istHour}:00 IST) falls within RBI DND window (21:00-08:00 IST).`,
      };
    }

    return {
      dnd_active: false,
      contact_limit_exceeded: false,
      hard_decline_blocked: false,
      can_proceed: true,
    };
  }

  /**
   * Explains an opportunity decision strictly by reading durable SQLite records through get_full_audit_trail tool.
   */
  public static async explainOpportunity(params: {
    runId: string;
    opportunityId: string;
  }): Promise<ComplianceExplanationResult> {
    const auditRes = await AgentToolRegistry.executeTool({
      toolId: 'get_full_audit_trail',
      runId: params.runId,
      agentName: 'ComplianceCopilot',
      inputPayload: { opportunity_id: params.opportunityId },
    });

    if (!auditRes.success || !auditRes.data) {
      throw new Error(`Compliance Copilot could not retrieve audit trail for opportunity ${params.opportunityId}: ${auditRes.error}`);
    }

    const trail = auditRes.data;
    const opp = trail.opportunity;
    const score = trail.score;
    const decision = trail.decision;
    const checks = trail.authority_checks || [];

    const amountInr = `₹${(opp.amount_paise / 100).toFixed(2)}`;
    const ivenInr = score ? `₹${(score.expected_incremental_value_paise / 100).toFixed(2)}` : 'N/A';
    const shadowPriceInr = decision ? `₹${(decision.shadow_price_paise_at_decision / 100).toFixed(2)}` : 'N/A';

    const claims: ForensicAuditClaim[] = [
      {
        table: 'recovery_opportunities',
        record_id: opp.id,
        field: 'amount_paise',
        value: opp.amount_paise,
        explanation: `Amount at risk is ${amountInr} (${opp.amount_paise} paise).`,
      },
      {
        table: 'recovery_opportunities',
        record_id: opp.id,
        field: 'decline_type',
        value: opp.decline_type,
        explanation: `Decline classified under perception taxonomy as '${opp.decline_type}'.`,
      },
      {
        table: 'scores',
        record_id: opp.id,
        field: 'expected_incremental_value_paise',
        value: score?.expected_incremental_value_paise ?? null,
        explanation: `Deterministic Expected Incremental Value (IVEN) computed at ${ivenInr}.`,
      },
      {
        table: 'allocation_decisions',
        record_id: opp.id,
        field: 'decision',
        value: decision?.decision || 'PENDING',
        explanation: `Portfolio recovery market assigned action '${decision?.decision || 'PENDING'}' at rank #${decision?.rank_in_batch ?? '-'}.`,
      },
    ];

    for (const check of checks) {
      claims.push({
        table: 'authority_checks',
        record_id: `${opp.id}:${check.check_name}`,
        field: 'passed',
        value: check.passed,
        explanation: `Compliance check '${check.check_name}': ${check.passed ? 'PASSED' : 'FAILED'} (${check.reason}).`,
      });
    }

    const economicRationale = `Opportunity ${opp.id} (${amountInr}, ${opp.decline_type} decline) evaluated with natural recovery probability ${score?.natural_recovery_prob ?? 'N/A'} and intervention recovery probability ${score?.intervention_recovery_prob ?? 'N/A'}, generating incremental probability of ${score?.incremental_prob ?? 'N/A'} and net IVEN of ${ivenInr}.`;

    const marketRationale = decision
      ? `Ranked #${decision.rank_in_batch} in batch with market shadow price ${shadowPriceInr}. Resulting allocation: ${decision.decision} (${decision.reason}).`
      : 'Market allocation pending.';

    const passedCount = checks.filter((c: any) => c.passed).length;
    const authRationale = `Action Authority independently evaluated ${checks.length} compliance checks (${passedCount}/${checks.length} passed). Final status: ${opp.status}.`;

    return {
      opportunity_id: opp.id,
      audit_verified: true,
      claims,
      structured_summary: {
        economic_rationale: economicRationale,
        market_capacity_rationale: marketRationale,
        authority_compliance_rationale: authRationale,
      },
      generated_at: new Date().toISOString(),
    };
  }
}
