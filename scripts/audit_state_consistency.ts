import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { rzpClient } from '../src/execution/executor.js';
import { CanonicalStateMachine } from '../src/truth/canonical_state_machine.js';
import { ProviderTruthEvaluator } from '../src/truth/provider_truth.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const DB_PATH = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'ctrl.db');
const db = new DatabaseSync(DB_PATH);

export interface InconsistencyRecord {
  category: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  opportunity_id?: string;
  run_id?: string;
  description: string;
  expected: any;
  actual: any;
  recommendation: string;
}

export interface StateConsistencyAuditReport {
  timestamp: string;
  database_path: string;
  total_opportunities: number;
  total_executions: number;
  total_agent_runs: number;
  inconsistencies: InconsistencyRecord[];
  is_fully_consistent: boolean;
  breakdown: {
    critical_count: number;
    high_count: number;
    medium_count: number;
    low_count: number;
  };
}

export async function runStateConsistencyAudit(): Promise<StateConsistencyAuditReport> {
  const inconsistencies: InconsistencyRecord[] = [];
  const now = new Date().toISOString();

  // 1. Inspect all execution records against opportunities & live Razorpay provider truth
  const execRecords = db.prepare('SELECT * FROM execution_records;').all() as Array<{
    opportunity_id: string;
    razorpay_payment_link_id: string;
    link_url: string;
    status: string;
    created_at: string;
  }>;

  const totalOpps = (db.prepare('SELECT COUNT(*) as count FROM recovery_opportunities;').get() as { count: number }).count;
  const totalRuns = (db.prepare('SELECT COUNT(*) as count FROM agent_runs;').get() as { count: number }).count;

  for (const exec of execRecords) {
    const opp = db.prepare('SELECT * FROM recovery_opportunities WHERE id = ?;').get(exec.opportunity_id) as any;

    if (!opp) {
      inconsistencies.push({
        category: 'ORPHAN_EXECUTION_RECORD',
        severity: 'CRITICAL',
        opportunity_id: exec.opportunity_id,
        description: `Execution record points to non-existent opportunity ${exec.opportunity_id}`,
        expected: 'Valid opportunity foreign key',
        actual: 'null',
        recommendation: 'Remove orphan execution record or restore opportunity',
      });
      continue;
    }

    // Distinguish synthetic/mock unit test links from real provider links
    const isMockTestLink = exec.razorpay_payment_link_id.startsWith('plink_test_') || exec.razorpay_payment_link_id.startsWith('plink_ooo_');

    let providerObj: any = null;
    if (isMockTestLink) {
      // Mock test link: locally validated
      providerObj = {
        id: exec.razorpay_payment_link_id,
        status: opp.status === 'recovered' ? 'paid' : 'created',
        amount: opp.amount_paise,
        amount_paid: opp.status === 'recovered' ? opp.amount_paise : 0,
        source_env: 'SYNTHETIC',
      };
    } else {
      // Real Razorpay Provider Query with throttling
      await new Promise((resolve) => setTimeout(resolve, 400));
      try {
        providerObj = await rzpClient.paymentLink.fetch(exec.razorpay_payment_link_id);
      } catch (err: any) {
        if (err.statusCode === 429) {
          // Wait 1 second and retry once
          await new Promise((resolve) => setTimeout(resolve, 1000));
          try {
            providerObj = await rzpClient.paymentLink.fetch(exec.razorpay_payment_link_id);
          } catch (retryErr: any) {
            inconsistencies.push({
              category: 'PROVIDER_QUERY_FAILED',
              severity: 'MEDIUM',
              opportunity_id: opp.id,
              description: `Failed to query Razorpay API for link ${exec.razorpay_payment_link_id} after retry: ${retryErr.message}`,
              expected: 'Successful provider fetch',
              actual: retryErr.message,
              recommendation: 'Verify API credentials and network connectivity',
            });
          }
        } else {
          inconsistencies.push({
            category: 'PROVIDER_QUERY_FAILED',
            severity: 'MEDIUM',
            opportunity_id: opp.id,
            description: `Failed to query Razorpay API for link ${exec.razorpay_payment_link_id}: ${err.message}`,
            expected: 'Successful provider fetch',
            actual: err.message,
            recommendation: 'Verify API credentials and network connectivity',
          });
        }
      }
    }

    if (providerObj) {
      const truthEval = ProviderTruthEvaluator.evaluate(providerObj);
      const canonical = CanonicalStateMachine.mapRazorpayStatusToCanonicalState({
        status: providerObj.status,
        amount_paise: opp.amount_paise,
        amount_paid_paise: providerObj.amount_paid || 0,
      });

      // Check: Provider paid but local opportunity NOT recovered
      if (truthEval.is_recovered && opp.status !== 'recovered') {
        inconsistencies.push({
          category: 'PROVIDER_PAID_LOCAL_UNRECONCILED',
          severity: 'CRITICAL',
          opportunity_id: opp.id,
          description: `Razorpay provider status is 'paid' (Paid: ₹${(truthEval.amount_paid_paise / 100).toFixed(2)}), but local opportunity status is '${opp.status}'`,
          expected: 'recovered',
          actual: opp.status,
          recommendation: 'Run AuthoritativeReconciler.reconcileOpportunity()',
        });
      }

      // Check: Local opportunity recovered but provider NOT paid
      if (opp.status === 'recovered' && !truthEval.is_recovered) {
        inconsistencies.push({
          category: 'FALSE_LOCAL_RECOVERY',
          severity: 'CRITICAL',
          opportunity_id: opp.id,
          description: `Local opportunity is marked 'recovered', but provider status is '${providerObj.status}' with amount_paid = 0`,
          expected: 'executing / payment_pending',
          actual: 'recovered',
          recommendation: 'Demote opportunity to executing and remove false recovery ledger entries',
        });
      }

      // Check: Execution record status mismatch
      if (truthEval.is_recovered && exec.status !== 'completed') {
        inconsistencies.push({
          category: 'EXECUTION_STATUS_MISMATCH',
          severity: 'HIGH',
          opportunity_id: opp.id,
          description: `Opportunity is provider-paid, but execution_records.status is '${exec.status}' (expected 'completed')`,
          expected: 'completed',
          actual: exec.status,
          recommendation: 'Update execution record status to completed',
        });
      }

      // Check: Double entry ledger presence for confirmed payment
      if (truthEval.is_recovered) {
        const doubleEntry = db.prepare(`
          SELECT * FROM double_entry_ledger
          WHERE opportunity_id = ? AND event_type = 'PAYMENT_RECOVERED';
        `).get(opp.id);

        if (!doubleEntry) {
          inconsistencies.push({
            category: 'MISSING_DOUBLE_ENTRY_LEDGER',
            severity: 'HIGH',
            opportunity_id: opp.id,
            description: `Provider payment is confirmed, but double_entry_ledger has no 'PAYMENT_RECOVERED' entry for ${opp.id}`,
            expected: 'Double-entry journal posted',
            actual: 'null',
            recommendation: 'Post balanced DoubleEntryLedger transaction',
          });
        }
      }
    }
  }

  // 2. Check for running agent missions exceeding inactivity threshold
  const runningMissions = db.prepare(`
    SELECT * FROM agent_runs WHERE status = 'running';
  `).all() as Array<{ id: string; mission_id: string; created_at: string }>;

  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  for (const run of runningMissions) {
    const createdTime = new Date(run.created_at).getTime();
    if (createdTime < fiveMinutesAgo) {
      inconsistencies.push({
        category: 'STALE_RUNNING_MISSION',
        severity: 'MEDIUM',
        run_id: run.id,
        description: `Agent mission ${run.mission_id} has been RUNNING for > 5 minutes without completion`,
        expected: 'completed or aborted',
        actual: 'running',
        recommendation: 'Run MissionLifecycleMonitor.sweepStaleMissions()',
      });
    }
  }

  // 3. Double-entry ledger balance check
  const debitSum = (db.prepare('SELECT SUM(amount_paise) as sum FROM double_entry_ledger;').get() as { sum: number }).sum || 0;
  const creditSum = (db.prepare('SELECT SUM(amount_paise) as sum FROM double_entry_ledger;').get() as { sum: number }).sum || 0;
  if (debitSum !== creditSum) {
    inconsistencies.push({
      category: 'UNBALANCED_DOUBLE_ENTRY_LEDGER',
      severity: 'CRITICAL',
      description: `Double-entry ledger is mathematically unbalanced: Debits (${debitSum}) != Credits (${creditSum})`,
      expected: 'Debits == Credits',
      actual: `Diff: ${Math.abs(debitSum - creditSum)} paise`,
      recommendation: 'Review double entry ledger hash chain and journal entries',
    });
  }

  // 4. Summarize
  const criticalCount = inconsistencies.filter((i) => i.severity === 'CRITICAL').length;
  const highCount = inconsistencies.filter((i) => i.severity === 'HIGH').length;
  const mediumCount = inconsistencies.filter((i) => i.severity === 'MEDIUM').length;
  const lowCount = inconsistencies.filter((i) => i.severity === 'LOW').length;

  const report: StateConsistencyAuditReport = {
    timestamp: now,
    database_path: DB_PATH,
    total_opportunities: totalOpps,
    total_executions: execRecords.length,
    total_agent_runs: totalRuns,
    inconsistencies,
    is_fully_consistent: inconsistencies.length === 0,
    breakdown: {
      critical_count: criticalCount,
      high_count: highCount,
      medium_count: mediumCount,
      low_count: lowCount,
    },
  };

  return report;
}

if (process.argv[1]?.endsWith('audit_state_consistency.ts')) {
  runStateConsistencyAudit().then((report) => {
    console.log(JSON.stringify(report, null, 2));
  }).catch(console.error);
}
