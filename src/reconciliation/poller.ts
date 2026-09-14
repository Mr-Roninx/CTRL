import {
  getAllOpportunities,
  getExecutionRecordByOpportunityId,
} from '../db/database.js';
import { AuthoritativeReconciler } from './authoritative_reconciler.js';

/**
 * RECONCILIATION DESIGN NOTE:
 * Webhooks are not guaranteed to arrive across distributed networks due to potential
 * network drops, intermediate gateway retry timeouts, or server cold starts.
 * The active reconciliation poller provides a deterministic secondary verification loop
 * by querying Razorpay's API directly for any opportunity in 'executing' status, ensuring
 * dual-path eventual truth reconciliation without relying solely on asynchronous webhooks.
 */

export interface PolledItemResult {
  opportunity_id: string;
  payment_link_id: string;
  previous_status: string;
  new_status: string;
  reconciled: boolean;
  error?: string;
}

export interface PollerRunResult {
  total_checked: number;
  reconciled_count: number;
  still_executing_count: number;
  failed_count: number;
  items: PolledItemResult[];
}

export async function pollAndReconcile(tenantId?: string): Promise<PollerRunResult> {
  const allOpps = getAllOpportunities(tenantId);
  // Opportunities currently in flight
  const executingOpps = allOpps.filter(
    (opp) => opp.status === 'executing' || opp.status === 'authorized' || opp.status === 'allocated'
  );

  const items: PolledItemResult[] = [];
  let reconciled_count = 0;
  let still_executing_count = 0;
  let failed_count = 0;

  for (const opp of executingOpps) {
    const record = getExecutionRecordByOpportunityId(opp.id);
    if (!record || !record.razorpay_payment_link_id) {
      continue;
    }

    try {
      const reconResult = await AuthoritativeReconciler.reconcileOpportunity(opp.id, {
        actor: 'reconciliation_poller',
      });

      if (reconResult.status === 'UNKNOWN' && reconResult.error) {
        failed_count++;
        items.push({
          opportunity_id: opp.id,
          payment_link_id: record.razorpay_payment_link_id,
          previous_status: reconResult.previous_opportunity_status,
          new_status: reconResult.new_opportunity_status,
          reconciled: false,
          error: reconResult.error,
        });
      } else if (reconResult.new_opportunity_status === 'recovered' || reconResult.new_opportunity_status === 'not_recovered') {
        reconciled_count++;
        items.push({
          opportunity_id: opp.id,
          payment_link_id: record.razorpay_payment_link_id,
          previous_status: reconResult.previous_opportunity_status,
          new_status: reconResult.new_opportunity_status,
          reconciled: true,
        });
      } else {
        still_executing_count++;
        items.push({
          opportunity_id: opp.id,
          payment_link_id: record.razorpay_payment_link_id,
          previous_status: reconResult.previous_opportunity_status,
          new_status: reconResult.new_opportunity_status,
          reconciled: false,
        });
      }
    } catch (err: any) {
      failed_count++;
      items.push({
        opportunity_id: opp.id,
        payment_link_id: record.razorpay_payment_link_id,
        previous_status: opp.status,
        new_status: opp.status,
        reconciled: false,
        error: err?.message || 'Poller fetch failed',
      });
    }
  }

  return {
    total_checked: items.length,
    reconciled_count,
    still_executing_count,
    failed_count,
    items,
  };
}
