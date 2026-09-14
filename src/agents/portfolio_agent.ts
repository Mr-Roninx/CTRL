import crypto from 'node:crypto';
import { RecoveryOpportunity, Score } from '../types/index.js';
import {
  OpportunityPriority,
  PortfolioProposal,
  ProposedAction,
} from './types.js';
import {
  getAllOpportunities,
  getScoreByOpportunityId,
  getPerceptionAnnotationByOpportunityId,
  getCustomerById,
} from '../db/database.js';
import { scoreOpportunity } from '../economics/scorer.js';
import { UncertaintyModel } from './uncertainty.js';
import { InformationValueEstimator } from './information_value.js';

/**
 * CTRL v5.1 — Portfolio Agent
 *
 * Scans all pending recovery opportunities, ranks them by deterministic
 * priority score, and produces a PortfolioProposal for the Recovery Market.
 *
 * The Portfolio Agent:
 *   ✅ Inspects pending opportunities
 *   ✅ Computes deterministic priority scores
 *   ✅ Assesses uncertainty per opportunity
 *   ✅ Estimates information value
 *   ✅ Ranks and recommends top-K for capacity allocation
 *   ✅ Produces structured proposals
 *
 *   ❌ CANNOT directly allocate capacity
 *   ❌ CANNOT execute Razorpay writes
 *   ❌ CANNOT modify Action Authority
 *   ❌ CANNOT modify IVEN calculations
 *   ❌ CANNOT access secrets or future information
 *
 * All proposals feed into the existing deterministic Recovery Market.
 */
export class PortfolioAgent {

  // -------------------------------------------------------------------------
  // Deterministic priority weights (fixed, not LLM-derived)
  // -------------------------------------------------------------------------
  private static readonly W_IVEN = 0.40;
  private static readonly W_TIME = 0.25;
  private static readonly W_GATEWAY = 0.15;
  private static readonly W_FATIGUE = 0.10;
  private static readonly W_EXPIRY = 0.10;

  // Maximum opportunity age before expiry concern (hours)
  private static readonly MAX_OPPORTUNITY_AGE_HOURS = 72;

  // Default gateway health when unknown
  private static readonly DEFAULT_GATEWAY_HEALTH = 0.95;

  /**
   * Execute a portfolio sweep: scan, score, rank, and propose.
   */
  public static sweep(params: {
    capacity?: number;
    gatewayHealth?: number;
    filterStatuses?: string[];
    maxCandidates?: number;
    tenantId?: string;
  } = {}): PortfolioProposal {
    const capacity = params.capacity ?? 5;
    const gatewayHealth = params.gatewayHealth ?? this.DEFAULT_GATEWAY_HEALTH;
    const filterStatuses = params.filterStatuses ?? ['pending', 'scored', 'deferred'];

    // 1. Scan all opportunities matching target statuses
    const allOpps = getAllOpportunities(params.tenantId);
    let candidateOpps = allOpps.filter((o) => filterStatuses.includes(o.status));
    if (params.maxCandidates && params.maxCandidates > 0) {
      candidateOpps = candidateOpps.slice(0, params.maxCandidates);
    }

    // 2. Score and prioritize each candidate
    const priorities: OpportunityPriority[] = [];

    for (const opp of candidateOpps) {
      let score = getScoreByOpportunityId(opp.id);
      if (!score) {
        score = scoreOpportunity(opp);
      }

      const perception = getPerceptionAnnotationByOpportunityId(opp.id);
      const customer = getCustomerById(opp.customer_id);

      // Assess uncertainty
      const uncertainty = UncertaintyModel.assess({
        opportunity: opp,
        score,
        hasPerception: !!perception,
        hasCustomerHistory: !!customer,
        hasGatewayState: true,
        historicalSampleSize: 15, // synthetic baseline
        historicalCalibrationError: 0.25,
      });

      // Estimate information value
      const infoValue = InformationValueEstimator.estimate({
        opportunity: opp,
        score,
        gatewayHealth,
        compositeConfidence: uncertainty.composite_confidence,
        hasPerception: !!perception,
      });

      // Compute deterministic priority signals
      const iven = score.expected_incremental_value_paise;
      const timeUrgency = this.computeTimeUrgency(opp);
      const fatigueRisk = this.computeFatigueRisk(opp);
      const gatewayConf = gatewayHealth;
      const expiryRisk = this.computeExpiryRisk(opp);

      // Normalize IVEN to 0..1 range for weighted combination
      // Use ₹10,000 (1_000_000 paise) as the normalization ceiling
      const normIven = Math.min(Math.max(iven / 1_000_000, 0), 1);

      // Deterministic priority score
      const priorityScore = Number((
        this.W_IVEN * normIven +
        this.W_TIME * timeUrgency +
        this.W_GATEWAY * gatewayConf -
        this.W_FATIGUE * fatigueRisk -
        this.W_EXPIRY * expiryRisk
      ).toFixed(4));

      // Select proposed action based on information value + uncertainty
      let proposedAction: ProposedAction;
      if (opp.decline_type === 'hard') {
        proposedAction = 'WAIT'; // Hard declines should not consume capacity
      } else if (uncertainty.recommendation === 'INVESTIGATE' || infoValue.recommended_action === 'INVESTIGATE') {
        proposedAction = 'INVESTIGATE';
      } else if (infoValue.recommended_action === 'WAIT' || uncertainty.recommendation === 'HUMAN_REVIEW') {
        proposedAction = 'WAIT';
      } else {
        proposedAction = 'ACT';
      }

      const rationale = [
        `IVEN=₹${(iven / 100).toFixed(2)} (norm=${normIven.toFixed(3)})`,
        `time_urgency=${timeUrgency.toFixed(3)}`,
        `gateway=${gatewayConf.toFixed(2)}`,
        `fatigue=${fatigueRisk.toFixed(3)}`,
        `expiry=${expiryRisk.toFixed(3)}`,
        `uncertainty=${uncertainty.composite_confidence.toFixed(3)}`,
        `info_value=₹${(infoValue.expected_value_of_information_paise / 100).toFixed(2)}`,
      ].join(', ');

      priorities.push({
        opportunity_id: opp.id,
        iven_paise: iven,
        time_urgency: timeUrgency,
        fatigue_risk: fatigueRisk,
        gateway_confidence: gatewayConf,
        expiry_risk: expiryRisk,
        priority_score: priorityScore,
        proposed_action: proposedAction,
        rationale,
      });
    }

    // 3. Sort by priority score descending
    priorities.sort((a, b) => b.priority_score - a.priority_score);

    // 4. Select top-K recommendations (ACT-eligible only)
    const actEligible = priorities.filter((p) => p.proposed_action === 'ACT');
    const topK = actEligible.slice(0, capacity).map((p) => p.opportunity_id);

    // 5. Build portfolio summary
    const actCount = priorities.filter((p) => p.proposed_action === 'ACT').length;
    const waitCount = priorities.filter((p) => p.proposed_action === 'WAIT').length;
    const investigateCount = priorities.filter((p) => p.proposed_action === 'INVESTIGATE').length;

    const summary = [
      `Portfolio sweep scanned ${candidateOpps.length} opportunities.`,
      `Proposed: ${actCount} ACT, ${waitCount} WAIT, ${investigateCount} INVESTIGATE.`,
      `Top-${Math.min(capacity, topK.length)} recommended for Recovery Market: [${topK.join(', ')}].`,
      `Capacity available: ${capacity}.`,
    ].join(' ');

    const proposalId = `portfolio_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    return {
      id: proposalId,
      timestamp: new Date().toISOString(),
      total_scanned: candidateOpps.length,
      priorities,
      capacity_available: capacity,
      top_k_recommendations: topK,
      portfolio_summary: summary,
    };
  }

  // -------------------------------------------------------------------------
  // Deterministic signal computations
  // -------------------------------------------------------------------------

  /**
   * Time urgency: higher for older opportunities (0..1).
   */
  private static computeTimeUrgency(opp: RecoveryOpportunity): number {
    const ageMs = Date.now() - new Date(opp.created_at).getTime();
    const ageHours = ageMs / (3600 * 1000);
    return Number(Math.min(ageHours / this.MAX_OPPORTUNITY_AGE_HOURS, 1.0).toFixed(4));
  }

  /**
   * Fatigue risk: higher for more attempts or low trust score (0..1).
   */
  private static computeFatigueRisk(opp: RecoveryOpportunity): number {
    const attemptFatigue = Math.min(opp.attempt_count / 5, 1.0);
    const trustPenalty = Math.max(0, 1.0 - opp.customer_trust_score);
    return Number(((attemptFatigue * 0.6) + (trustPenalty * 0.4)).toFixed(4));
  }

  /**
   * Expiry risk: higher as opportunity approaches 72h age (0..1).
   */
  private static computeExpiryRisk(opp: RecoveryOpportunity): number {
    const ageMs = Date.now() - new Date(opp.created_at).getTime();
    const ageHours = ageMs / (3600 * 1000);
    if (ageHours >= this.MAX_OPPORTUNITY_AGE_HOURS) return 1.0;
    if (ageHours >= this.MAX_OPPORTUNITY_AGE_HOURS * 0.75) return 0.8;
    if (ageHours >= this.MAX_OPPORTUNITY_AGE_HOURS * 0.5) return 0.4;
    return Number((ageHours / this.MAX_OPPORTUNITY_AGE_HOURS * 0.3).toFixed(4));
  }
}
