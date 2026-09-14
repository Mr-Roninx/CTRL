import crypto from 'node:crypto';
import { isKillSwitchActive } from '../authority/gate.js';
import { PortfolioAgent } from './portfolio_agent.js';
import { runMarketAllocation } from '../market/allocator.js';
import { executeAuthorizedBatch } from '../execution/executor.js';
import { pollAndReconcile } from '../reconciliation/poller.js';
import {
  insertDaemonSweepLog,
  DaemonSweepLog,
  insertNotification,
  getOpportunityById,
  db,
} from '../db/database.js';
import { RealtimeBroadcaster } from '../realtime/broadcaster.js';

export type DaemonState = 'IDLE' | 'SWEEPING' | 'SLEEPING' | 'STOPPED';

export interface DaemonConfig {
  interval_seconds: number;
  capacity: number;
}

export interface DaemonStatus {
  state: DaemonState;
  config: DaemonConfig;
  total_sweeps: number;
  revenue_recovered_paise: number;
  last_sweep_at: string | null;
  next_sweep_at: string | null;
}

/**
 * Autonomous 24/7 Background Recovery Agent Daemon
 * Continuously sweeps the pipeline without human intervention.
 */
export class AutonomousRecoveryDaemon {
  private static instance: AutonomousRecoveryDaemon;
  
  private state: DaemonState = 'IDLE';
  private isSweeping = false;
  private config: DaemonConfig = { interval_seconds: 20, capacity: 5 };
  private timer: NodeJS.Timeout | null = null;
  
  private total_sweeps = 0;
  private revenue_recovered_paise = 0;
  private last_sweep_at: string | null = null;
  private next_sweep_at: string | null = null;

  private constructor() {}

  public static getInstance(): AutonomousRecoveryDaemon {
    if (!AutonomousRecoveryDaemon.instance) {
      AutonomousRecoveryDaemon.instance = new AutonomousRecoveryDaemon();
    }
    return AutonomousRecoveryDaemon.instance;
  }

  /**
   * Start the daemon loop
   */
  public start(config?: Partial<DaemonConfig>): void {
    if (this.state === 'SWEEPING' || this.state === 'SLEEPING') {
      return; // Already running
    }
    if (config) {
      this.updateConfig(config);
    }
    
    this.state = 'SLEEPING';
    this.scheduleNext();
  }

  /**
   * Stop the daemon loop
   */
  public stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.state = 'STOPPED';
    this.next_sweep_at = null;
  }

  /**
   * Wait for any active in-flight sweep to complete cleanly before terminating.
   */
  public async waitForDrain(timeoutMs = 30000): Promise<void> {
    this.stop();
    if (!this.isSweeping) return;
    const start = Date.now();
    while (this.isSweeping && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  /**
   * Update running config
   */
  public updateConfig(newConfig: Partial<DaemonConfig>): void {
    if (newConfig.interval_seconds !== undefined) {
      this.config.interval_seconds = Math.max(15, Math.min(300, newConfig.interval_seconds)); // 15s to 5m
    }
    if (newConfig.capacity !== undefined) {
      this.config.capacity = Math.max(1, Math.min(10, newConfig.capacity)); // max 10
    }
    
    if (this.state === 'SLEEPING') {
      this.scheduleNext();
    }
  }

  /**
   * Get current daemon status
   */
  public getStatus(): DaemonStatus {
    return {
      state: this.state,
      config: { ...this.config },
      total_sweeps: this.total_sweeps,
      revenue_recovered_paise: this.revenue_recovered_paise,
      last_sweep_at: this.last_sweep_at,
      next_sweep_at: this.next_sweep_at,
    };
  }

  private scheduleNext(): void {
    if (this.state === 'STOPPED' || this.state === 'IDLE') return;
    
    if (this.timer) clearTimeout(this.timer);
    
    const intervalMs = this.config.interval_seconds * 1000;
    this.next_sweep_at = new Date(Date.now() + intervalMs).toISOString();
    this.state = 'SLEEPING';
    
    this.timer = setTimeout(async () => {
      try {
        if (process.env.DISTRIBUTED_WORKERS === 'true') {
          const { DistributedJobQueue } = await import('../queue/job_queue.js');
          await DistributedJobQueue.getInstance().push({
            type: 'AGENT_REASONING_CYCLE',
            tenantId: 'tenant_system_default',
            payload: { capacity: this.config.capacity },
          });
        } else {
          await this.sweepOnce();
        }
      } catch (err) {
        console.error('Autonomous daemon sweep error:', err);
      } finally {
        if (this.state !== 'STOPPED') {
          this.scheduleNext();
        }
      }
    }, intervalMs);
    this.timer.unref?.();
  }

  /**
   * Triggers an immediate sweep execution or queues it to workers.
   */
  public async triggerInstantSweep(targetTenantId?: string): Promise<void> {
    await this.sweepOnce(targetTenantId);
  }

  /**
   * Perform one full sweep
   */
  public async sweepOnce(targetTenantId?: string): Promise<void> {
    if (this.isSweeping) return;
    
    const previousState = this.state;
    this.isSweeping = true;
    this.state = 'SWEEPING';
    const sweepId = `sweep_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const startTime = Date.now();
    this.total_sweeps++;
    this.last_sweep_at = new Date(startTime).toISOString();
    const activeTenant = targetTenantId || 'tenant_system_default';

    let opps_scanned = 0;
    let opps_allocated = 0;
    let opps_executed = 0;
    let opps_reconciled = 0;
    let recovered_revenue = 0;
    let errorMessage = '';
    let sweepStatus: DaemonSweepLog['status'] = 'SUCCESS';

    try {
      // 1. Kill switch guard
      if (isKillSwitchActive(activeTenant)) {
        sweepStatus = 'ABORTED';
        insertNotification({
          id: `notif_kill_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          tenant_id: activeTenant,
          type: 'KILL_SWITCH_TRIGGERED',
          title: 'Kill Switch Active',
          message: 'Autonomous daemon sweep was aborted due to active kill switch.',
          link_url: '/dashboard',
          created_at: new Date().toISOString(),
        });
        throw new Error('Kill switch engaged');
      }

      // Quick check: if there are no actionable opportunities to process, skip heavy sweep
      const sql = targetTenantId
        ? "SELECT COUNT(*) as c FROM recovery_opportunities WHERE tenant_id = ? AND status IN ('pending', 'scored', 'deferred', 'allocated', 'executing')"
        : "SELECT COUNT(*) as c FROM recovery_opportunities WHERE status IN ('pending', 'scored', 'deferred', 'allocated', 'executing')";
      const activeCount = targetTenantId
        ? (db.prepare(sql).get(targetTenantId) as { c: number } | undefined)
        : (db.prepare(sql).get() as { c: number } | undefined);

      if (!activeCount || activeCount.c === 0) {
        return;
      }

      // 2. Portfolio Sweep (scan & rank)
      const portfolioProposal = PortfolioAgent.sweep({
        capacity: this.config.capacity,
        filterStatuses: ['pending', 'scored', 'deferred'],
        tenantId: targetTenantId,
      });
      opps_scanned = portfolioProposal.total_scanned;

      // 3. Market Allocation (allocate capacity)
      const marketResult = runMarketAllocation({
        capacity: this.config.capacity,
        tenantId: targetTenantId,
      });
      opps_allocated = marketResult.accepted_count;

      // 4. Authorized Batch Execution (dispatches Razorpay links)
      const execResult = await executeAuthorizedBatch({
        maxLinks: this.config.capacity,
        tenantId: targetTenantId,
      });
      opps_executed = execResult.executed_count;

      if (execResult.failed_count > 0) {
        sweepStatus = 'PARTIAL';
        errorMessage = `Execution failed for ${execResult.failed_count} items. `;
      }

      // 5. Reconciliation Poller
      const pollResult = await pollAndReconcile(targetTenantId);
      opps_reconciled = pollResult.reconciled_count;
      
      // Emit notifications for recovered payments scoped to the specific merchant tenant
      for (const item of pollResult.items) {
        if (item.reconciled && item.new_status === 'recovered') {
          const opp = getOpportunityById(item.opportunity_id);
          const itemTenantId = opp?.tenant_id || activeTenant;
          const amountFormatted = opp ? ` (₹${(opp.amount_paise / 100).toFixed(2)})` : '';

          const notifItem = {
            id: `notif_rec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            tenant_id: itemTenantId,
            type: 'PAYMENT_RECOVERED' as const,
            title: 'Payment Successfully Recovered! 🎉',
            message: `Opportunity ${item.opportunity_id}${amountFormatted} settled and verified via Razorpay API.`,
            link_url: '/dashboard/opportunities',
            created_at: new Date().toISOString(),
          };

          insertNotification(notifItem);

          // Realtime SSE push to the merchant's live dashboard
          RealtimeBroadcaster.getInstance().broadcastToTenant(itemTenantId, 'NOTIFICATION_CREATED', notifItem);
        }
      }

    } catch (err: any) {
      sweepStatus = sweepStatus === 'SUCCESS' ? 'FAILED' : sweepStatus;
      errorMessage += err?.message || 'Unknown sweep error';
    } finally {
      const endTime = Date.now();
      
      // Log to DB only when actual work was performed or an error occurred to prevent database bloat
      if (opps_scanned > 0 || opps_reconciled > 0 || errorMessage !== '' || sweepStatus !== 'SUCCESS') {
        insertDaemonSweepLog({
          id: sweepId,
          sweep_number: this.total_sweeps,
          started_at: this.last_sweep_at!,
          finished_at: new Date(endTime).toISOString(),
          duration_ms: endTime - startTime,
          status: sweepStatus,
          opps_scanned,
          opps_allocated,
          opps_executed,
          opps_reconciled,
          revenue_recovered_paise: recovered_revenue,
          error_message: errorMessage,
          config_snapshot: JSON.stringify(this.config)
        });
      }

      // Automated retention cleanup: prune sweep logs older than 7 days once every 100 sweeps
      if (this.total_sweeps % 100 === 0) {
        try {
          const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
          db.prepare("DELETE FROM daemon_sweep_logs WHERE started_at < ?").run(sevenDaysAgo);
        } catch {}
      }
      
      this.revenue_recovered_paise += recovered_revenue;

      // Broadcast autonomous proactive alerts
      try {
        const { ProactiveAlertsEngine } = await import('./autonomous/proactive_alerts.js');
        const alerts = ProactiveAlertsEngine.generateAlerts();
        if (alerts.length > 0) {
          RealtimeBroadcaster.getInstance().broadcastToTenant(
            activeTenant,
            'PROACTIVE_ALERTS_UPDATED' as any,
            { alerts }
          );
        }
      } catch (err) {
        // Non-blocking proactive alert generation
      }
      
      if (previousState === 'SLEEPING') {
        this.state = 'SLEEPING';
      } else if (previousState === 'STOPPED') {
        this.state = 'STOPPED';
      } else {
        this.state = 'IDLE';
      }
      this.isSweeping = false;
    }
  }
}
