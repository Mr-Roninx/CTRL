import {
  getOpportunityById,
  getAllOpportunities,
  getCustomerById,
  getScoreByOpportunityId,
  getAllocationDecisionByOpportunityId,
  getAuthorityChecksByOpportunityId,
  getExecutionRecordByOpportunityId,
  getLedgerEntriesByOpportunity,
  getAllExecutionRecords,
  getAllAllocationDecisions,
  getMemories,
} from '../../db/database.js';
import { isKillSwitchActive } from '../../authority/gate.js';

export interface ReadToolResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export async function getOpportunityTool(params: { opportunity_id: string }): Promise<ReadToolResult> {
  const opp = getOpportunityById(params.opportunity_id);
  if (!opp) {
    return { success: false, error: `Opportunity '${params.opportunity_id}' not found`, timestamp: new Date().toISOString() };
  }
  return { success: true, data: opp, timestamp: new Date().toISOString() };
}

export async function getPaymentContextTool(params: { opportunity_id: string }): Promise<ReadToolResult> {
  const opp = getOpportunityById(params.opportunity_id);
  if (!opp) {
    return { success: false, error: `Opportunity '${params.opportunity_id}' not found`, timestamp: new Date().toISOString() };
  }
  const score = getScoreByOpportunityId(params.opportunity_id);
  const decision = getAllocationDecisionByOpportunityId(params.opportunity_id);
  const checks = getAuthorityChecksByOpportunityId(params.opportunity_id);
  const exec = getExecutionRecordByOpportunityId(params.opportunity_id);
  const ledger = getLedgerEntriesByOpportunity(params.opportunity_id);

  return {
    success: true,
    data: {
      opportunity: opp,
      score: score || null,
      market_decision: decision || null,
      authority_checks: checks || [],
      execution: exec || null,
      ledger: ledger || [],
    },
    timestamp: new Date().toISOString(),
  };
}

export async function getCustomerHistoryTool(params: { customer_id: string }): Promise<ReadToolResult> {
  const customer = getCustomerById(params.customer_id);
  const allOpps = getAllOpportunities();
  const customerOpps = allOpps.filter((o) => o.customer_id === params.customer_id);

  return {
    success: true,
    data: {
      customer: customer || { id: params.customer_id, trust_score: 0.65 },
      total_opportunities: customerOpps.length,
      recovered_count: customerOpps.filter((o) => o.status === 'recovered').length,
      history: customerOpps.map((o) => ({
        id: o.id,
        amount_paise: o.amount_paise,
        decline_type: o.decline_type,
        status: o.status,
        created_at: o.created_at,
      })),
    },
    timestamp: new Date().toISOString(),
  };
}

export async function getPaymentAttemptsTool(params: { opportunity_id: string }): Promise<ReadToolResult> {
  const opp = getOpportunityById(params.opportunity_id);
  if (!opp) {
    return { success: false, error: `Opportunity '${params.opportunity_id}' not found`, timestamp: new Date().toISOString() };
  }
  return {
    success: true,
    data: {
      opportunity_id: opp.id,
      attempt_count: opp.attempt_count,
      reason_code: opp.reason_code,
      decline_type: opp.decline_type,
      max_retry_limit: 3,
      retry_cap_exceeded: opp.attempt_count >= 3,
    },
    timestamp: new Date().toISOString(),
  };
}

export async function getFailureHistoryTool(params: { reason_code?: string; decline_type?: string }): Promise<ReadToolResult> {
  const allOpps = getAllOpportunities();
  const filtered = allOpps.filter((o) => {
    if (params.reason_code && o.reason_code !== params.reason_code) return false;
    if (params.decline_type && o.decline_type !== params.decline_type) return false;
    return true;
  });

  const total = filtered.length;
  const recovered = filtered.filter((o) => o.status === 'recovered').length;
  const empiricalRate = total > 0 ? Number((recovered / total).toFixed(4)) : 0;

  return {
    success: true,
    data: {
      filter: params,
      total_historical_cases: total,
      recovered_cases: recovered,
      empirical_recovery_rate: empiricalRate,
    },
    timestamp: new Date().toISOString(),
  };
}

export async function getGatewayStateTool(): Promise<ReadToolResult> {
  return {
    success: true,
    data: {
      gateway_provider: 'Razorpay',
      mode: 'Test Mode',
      overall_health: 0.98,
      latency_p95_ms: 180,
      upi_success_rate: 0.92,
      card_success_rate: 0.89,
      netbanking_success_rate: 0.91,
      kill_switch_active: isKillSwitchActive(),
    },
    timestamp: new Date().toISOString(),
  };
}

export async function getContactHistoryTool(params: { customer_id: string }): Promise<ReadToolResult> {
  const allOpps = getAllOpportunities();
  const customerOpps = allOpps.filter((o) => o.customer_id === params.customer_id);
  const contactsSent = customerOpps.filter((o) => ['executing', 'recovered', 'not_recovered'].includes(o.status));

  return {
    success: true,
    data: {
      customer_id: params.customer_id,
      total_contacts_attempted: contactsSent.length,
      last_contact_timestamp: contactsSent[0]?.created_at || null,
      fatigue_level: contactsSent.length >= 3 ? 'HIGH' : contactsSent.length >= 2 ? 'MEDIUM' : 'LOW',
    },
    timestamp: new Date().toISOString(),
  };
}

export async function getMarketStateTool(): Promise<ReadToolResult> {
  const decisions = getAllAllocationDecisions();
  const actDecisions = decisions.filter((d) => d.decision === 'ACT');
  const waitDecisions = decisions.filter((d) => d.decision === 'WAIT');
  const abstainDecisions = decisions.filter((d) => d.decision === 'ABSTAIN');
  const maxCap = Number(process.env.MAX_LINKS_PER_RUN) || 5;

  return {
    success: true,
    data: {
      capacity_limit: maxCap,
      capacity_used: actDecisions.length,
      capacity_available: Math.max(0, maxCap - actDecisions.length),
      act_count: actDecisions.length,
      wait_count: waitDecisions.length,
      abstain_count: abstainDecisions.length,
      latest_shadow_price_paise: actDecisions[actDecisions.length - 1]?.shadow_price_paise_at_decision || 0,
    },
    timestamp: new Date().toISOString(),
  };
}

export async function getRecoveryCapacityTool(): Promise<ReadToolResult> {
  const execRecords = getAllExecutionRecords();
  const maxCap = Number(process.env.MAX_LINKS_PER_RUN) || 5;
  return {
    success: true,
    data: {
      capacity_cap: maxCap,
      total_executed_links: execRecords.length,
      remaining_batch_quota: Math.max(0, maxCap - (execRecords.length % maxCap)),
    },
    timestamp: new Date().toISOString(),
  };
}

export async function getReconciliationStateTool(params: { opportunity_id: string }): Promise<ReadToolResult> {
  const opp = getOpportunityById(params.opportunity_id);
  if (!opp) {
    return { success: false, error: `Opportunity '${params.opportunity_id}' not found`, timestamp: new Date().toISOString() };
  }
  const exec = getExecutionRecordByOpportunityId(params.opportunity_id);
  const ledger = getLedgerEntriesByOpportunity(params.opportunity_id);

  return {
    success: true,
    data: {
      opportunity_id: opp.id,
      status: opp.status,
      razorpay_payment_link_id: exec?.razorpay_payment_link_id || null,
      payment_link_status: exec?.status || null,
      ledger_entries: ledger,
      is_reconciled: opp.status === 'recovered' || opp.status === 'not_recovered',
    },
    timestamp: new Date().toISOString(),
  };
}

export async function getProviderStatusTool(): Promise<ReadToolResult> {
  return {
    success: true,
    data: {
      provider: 'Razorpay',
      environment: 'Test Mode',
      api_reachability: 'UP',
      webhook_operational: true,
      timestamp: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  };
}

export async function getFullAuditTrailTool(params: { opportunity_id: string }): Promise<ReadToolResult> {
  const opp = getOpportunityById(params.opportunity_id);
  if (!opp) {
    return { success: false, error: `Opportunity '${params.opportunity_id}' not found`, timestamp: new Date().toISOString() };
  }
  const score = getScoreByOpportunityId(params.opportunity_id);
  const decision = getAllocationDecisionByOpportunityId(params.opportunity_id);
  const checks = getAuthorityChecksByOpportunityId(params.opportunity_id);
  const exec = getExecutionRecordByOpportunityId(params.opportunity_id);
  const ledger = getLedgerEntriesByOpportunity(params.opportunity_id);

  return {
    success: true,
    data: {
      opportunity: opp,
      score: score || null,
      decision: decision || null,
      authority_checks: checks || [],
      execution_record: exec || null,
      ledger_entries: ledger || [],
      audit_verified_at: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  };
}

export async function getSimilarCasesTool(params: { decline_type: string; amount_tolerance_pct?: number; base_amount_paise?: number }): Promise<ReadToolResult> {
  const allOpps = getAllOpportunities();
  const similar = allOpps.filter((o) => {
    if (o.decline_type !== params.decline_type) return false;
    if (params.base_amount_paise) {
      const tol = (params.amount_tolerance_pct || 50) / 100;
      const diff = Math.abs(o.amount_paise - params.base_amount_paise);
      if (diff > params.base_amount_paise * tol) return false;
    }
    return true;
  });

  return {
    success: true,
    data: {
      match_count: similar.length,
      cases: similar.slice(0, 10).map((s) => ({
        id: s.id,
        amount_paise: s.amount_paise,
        decline_type: s.decline_type,
        status: s.status,
        created_at: s.created_at,
      })),
    },
    timestamp: new Date().toISOString(),
  };
}

export async function getAgentMemoryTool(params: { query_type?: 'working' | 'episodic' | 'semantic'; failure_type?: string; semantic_key?: string; max_timestamp?: string }): Promise<ReadToolResult> {
  const memories = getMemories(params.query_type, params.max_timestamp);
  let filtered = memories;
  if (params.failure_type) {
    filtered = filtered.filter((m) => m.failure_type === params.failure_type);
  }
  if (params.semantic_key) {
    filtered = filtered.filter((m) => m.semantic_key?.startsWith(params.semantic_key!));
  }

  return {
    success: true,
    data: {
      count: filtered.length,
      memories: filtered.slice(0, 20),
    },
    timestamp: new Date().toISOString(),
  };
}
