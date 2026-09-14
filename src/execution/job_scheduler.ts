import { ExecutionDLQ } from './dlq.js';
import { AuthoritativeReconciler } from '../reconciliation/authoritative_reconciler.js';
import { logger } from '../observability/logger.js';
import { metrics } from '../observability/metrics.js';

/**
 * CTRL — Resilient Job Scheduler & Lifecycle Coordinator
 * 
 * Manages periodic background maintenance tasks:
 * 1. DLQ Retry Sweeps (every 60s)
 * 2. Authoritative Ledger Reconciliation (every 5m)
 * 3. Diagnostic Health & Capacity Monitoring (every 30s)
 */

export class JobScheduler {
  private static instance: JobScheduler | null = null;
  private dlqInterval: NodeJS.Timeout | null = null;
  private reconInterval: NodeJS.Timeout | null = null;
  private healthInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private isDraining: boolean = false;

  private constructor() {}

  public static getInstance(): JobScheduler {
    if (!JobScheduler.instance) {
      JobScheduler.instance = new JobScheduler();
    }
    return JobScheduler.instance;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isDraining = false;

    // 1. DLQ Retry Sweeper (every 60 seconds)
    this.dlqInterval = setInterval(async () => {
      if (this.isDraining) return;
      try {
        const { replayed, errors } = await ExecutionDLQ.replayPendingRetries(10);
        if (replayed > 0 || errors > 0) {
          logger.info(`🔄 JobScheduler: DLQ sweep completed. Replayed: ${replayed}, Failed: ${errors}`);
        }
      } catch (err: any) {
        logger.warn({ err }, '⚠️ JobScheduler: DLQ sweep encounter error');
      }
    }, 60000);

    // 2. Authoritative Reconciliation (every 5 minutes)
    this.reconInterval = setInterval(async () => {
      if (this.isDraining) return;
      try {
        const res = await AuthoritativeReconciler.reconcileAllActive();
        if (res.reconciled_count > 0) {
          logger.info(`⚖️ JobScheduler: Reconciled ${res.reconciled_count} entries. Recovered: ${res.recovered_count}`);
        }
      } catch (err: any) {
        logger.warn({ err }, '⚠️ JobScheduler: Periodic reconciliation error');
      }
    }, 300000);

    // 3. Health & Telemetry Pulse (every 30 seconds)
    this.healthInterval = setInterval(() => {
      if (this.isDraining) return;
      metrics.setGauge('ctrl_scheduler_active', 1);
    }, 30000);

    // Ensure intervals do not hold test runners open
    this.dlqInterval.unref();
    this.reconInterval.unref();
    this.healthInterval.unref();

    logger.info('⏱️ JobScheduler: Unified background maintenance scheduler active.');
  }

  public async stop(): Promise<void> {
    this.isDraining = true;
    this.isRunning = false;

    if (this.dlqInterval) {
      clearInterval(this.dlqInterval);
      this.dlqInterval = null;
    }
    if (this.reconInterval) {
      clearInterval(this.reconInterval);
      this.reconInterval = null;
    }
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }

    metrics.setGauge('ctrl_scheduler_active', 0);
    logger.info('⏱️ JobScheduler: Background maintenance scheduler cleanly stopped.');
  }

  public getStatus(): { isRunning: boolean; isDraining: boolean } {
    return {
      isRunning: this.isRunning,
      isDraining: this.isDraining,
    };
  }
}
