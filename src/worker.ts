import dotenv from 'dotenv';
import path from 'node:path';
import { initDatabase } from './db/database.js';
import { WebhookQueueEngine } from './webhooks/queue.js';
import { AutonomousRecoveryDaemon } from './agents/daemon.js';
import { DistributedJobQueue, QueueJob, JobType } from './queue/job_queue.js';
import { runMarketAllocation } from './market/allocator.js';
import { executeAuthorizedBatch } from './execution/executor.js';
import { pollAndReconcile } from './reconciliation/poller.js';
import { replayPendingRetries } from './execution/dlq.js';
import { withSpan } from './observability/otel.js';
import { DatabaseAdapter } from './db/adapter.js';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Initialize database connection
initDatabase();

export class CtrlWorkerProcess {
  private isRunning = false;
  private isProcessing = false;
  private queue = DistributedJobQueue.getInstance();

  public async start(): Promise<void> {
    this.isRunning = true;
    console.log('🚀 CTRL Decoupled Enterprise Worker Process Started');

    // Start Webhook Queue Retry Worker
    WebhookQueueEngine.getInstance().startWorker(10000);

    // Auto-start autonomous daemon if enabled in local non-distributed mode
    if (process.env.AUTONOMOUS_AGENT_ENABLED === 'true' && process.env.DISTRIBUTED_WORKERS !== 'true') {
      console.log('🤖 Starting Autonomous Recovery Agent Daemon (Local Sweeper)');
      AutonomousRecoveryDaemon.getInstance().start();
    }

    const jobTypes: JobType[] = [
      'AGENT_REASONING_CYCLE',
      'MARKET_ALLOCATION_RUN',
      'EXECUTION_DISPATCH',
      'RECONCILIATION_SWEEP',
      'DLQ_RETRY_SWEEP',
    ];

    console.log(`📡 Listening for distributed jobs via Redis queue across: [${jobTypes.join(', ')}]`);

    // Main worker event loop
    while (this.isRunning) {
      try {
        const job = await this.queue.pop(jobTypes, 2);
        if (job) {
          this.isProcessing = true;
          await this.processJob(job);
          this.isProcessing = false;
        }
      } catch (err: any) {
        this.isProcessing = false;
        console.error('❌ Worker loop processing error:', err.message);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  public async processJob(job: QueueJob): Promise<void> {
    const traceName = `ctrl.worker.job.${job.type.toLowerCase()}`;

    await withSpan(
      traceName,
      {
        'job.id': job.id,
        'job.type': job.type,
        'job.tenant_id': job.tenantId,
        'job.attempts': job.attempts,
      },
      async (span) => {

      // Set database tenant context for RLS
      await DatabaseAdapter.getInstance().setTenantContext(job.tenantId);

      try {
        console.log(`⚙️ [Worker] Processing ${job.type} (${job.id}) for tenant [${job.tenantId}]`);

        switch (job.type) {
          case 'AGENT_REASONING_CYCLE': {
            const daemon = AutonomousRecoveryDaemon.getInstance();
            await daemon.triggerInstantSweep(job.tenantId);
            break;
          }
          case 'MARKET_ALLOCATION_RUN': {
            const capacity = job.payload?.capacity || 5;
            runMarketAllocation({ capacity, tenantId: job.tenantId });
            break;
          }
          case 'EXECUTION_DISPATCH': {
            await executeAuthorizedBatch({ tenantId: job.tenantId });
            break;
          }
          case 'RECONCILIATION_SWEEP': {
            await pollAndReconcile(job.tenantId);
            break;
          }
          case 'DLQ_RETRY_SWEEP': {
            await replayPendingRetries(10);
            break;
          }
          default:
            console.warn(`⚠️ Unknown job type: ${(job as any).type}`);
        }

        span.setStatus({ code: 1 }); // OK
        console.log(`✅ [Worker] Completed ${job.type} (${job.id})`);
      } catch (err: any) {
        span.recordException(err);
        span.setStatus({ code: 2, message: err.message }); // ERROR
        console.error(`❌ [Worker] Failed ${job.type} (${job.id}):`, err.message);

        // Attempt retry
        const requeued = await this.queue.retry(job);
        if (requeued) {
          console.warn(`🔁 [Worker] Re-queued ${job.id} for retry (attempt ${job.attempts + 1}/${job.maxAttempts})`);
        } else {
          console.error(`💀 [Worker] Job ${job.id} exhausted max attempts, dropped to DLQ`);
        }
      }
    });
  }

  public async stop(timeoutMs = 30000): Promise<void> {
    console.log('🛑 Gracefully shutting down worker process...');
    this.isRunning = false;
    WebhookQueueEngine.getInstance().stopWorker();
    AutonomousRecoveryDaemon.getInstance().stop();

    const start = Date.now();
    while (this.isProcessing && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    await this.queue.close();
    console.log('🏁 Worker process stopped cleanly.');
  }
}

// Instantiate and start worker if run directly as a script
if (process.argv[1] && (process.argv[1].endsWith('worker.ts') || process.argv[1].endsWith('worker.js'))) {
  const worker = new CtrlWorkerProcess();
  worker.start().catch((err) => {
    console.error('Fatal worker process error:', err);
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await worker.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await worker.stop();
    process.exit(0);
  });
}
