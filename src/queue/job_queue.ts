import { Redis } from 'ioredis';
import { CacheManager } from '../cache/redis.js';

export type JobType =
  | 'AGENT_REASONING_CYCLE'
  | 'MARKET_ALLOCATION_RUN'
  | 'EXECUTION_DISPATCH'
  | 'RECONCILIATION_SWEEP'
  | 'DLQ_RETRY_SWEEP';

export interface QueueJob<T = any> {
  id: string;
  type: JobType;
  tenantId: string;
  payload: T;
  traceId?: string;
  traceParent?: string;
  createdAt: string;
  attempts: number;
  maxAttempts: number;
}

/**
 * Enterprise Distributed Job Queue backed by Redis List (LPUSH / BRPOP)
 * with transparent, zero-dependency in-memory queue fallback.
 */
export class DistributedJobQueue {
  private static instance: DistributedJobQueue | null = null;
  private redisClient: any = null;
  private redisBlockingClient: any = null;
  private memoryQueues: Map<string, QueueJob[]> = new Map();
  private isRedisConnected = false;

  private constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      try {
        const RedisClass = (Redis as any).default || Redis;
        this.redisClient = new RedisClass(redisUrl, {
          maxRetriesPerRequest: 2,
          connectTimeout: 4000,
          retryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 100, 2000)),
        });

        this.redisBlockingClient = new RedisClass(redisUrl, {
          maxRetriesPerRequest: null, // Allow blocking BRPOP
          connectTimeout: 4000,
          retryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 100, 2000)),
        });

        this.redisClient.on('connect', () => {
          this.isRedisConnected = true;
        });
        this.redisClient.on('error', () => {
          this.isRedisConnected = false;
        });
        this.redisBlockingClient.on('error', () => {});
      } catch {
        this.isRedisConnected = false;
      }
    }
  }

  public static getInstance(): DistributedJobQueue {
    if (!DistributedJobQueue.instance) {
      DistributedJobQueue.instance = new DistributedJobQueue();
    }
    return DistributedJobQueue.instance;
  }

  private getQueueKey(type: JobType): string {
    return `ctrl:queue:${type}`;
  }

  /**
   * Enqueue a job onto the distributed queue.
   */
  public async push<T = any>(job: Omit<QueueJob<T>, 'id' | 'createdAt' | 'attempts' | 'maxAttempts'> & { id?: string; attempts?: number; maxAttempts?: number }): Promise<string> {
    const fullJob: QueueJob<T> = {
      id: job.id || `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: job.type,
      tenantId: job.tenantId || 'tenant_system_default',
      payload: job.payload,
      traceId: job.traceId,
      traceParent: job.traceParent,
      createdAt: new Date().toISOString(),
      attempts: job.attempts || 0,
      maxAttempts: job.maxAttempts || 3,
    };

    const queueKey = this.getQueueKey(job.type);

    if (this.isRedisConnected && this.redisClient) {
      try {
        await this.redisClient.lpush(queueKey, JSON.stringify(fullJob));
        return fullJob.id;
      } catch (err) {
        // Fallback to memory
      }
    }

    if (!this.memoryQueues.has(queueKey)) {
      this.memoryQueues.set(queueKey, []);
    }
    this.memoryQueues.get(queueKey)!.push(fullJob);
    return fullJob.id;
  }

  /**
   * Dequeue the next available job using blocking pop (BRPOP) or memory polling.
   */
  public async pop<T = any>(types: JobType[], timeoutSeconds = 2): Promise<QueueJob<T> | null> {
    const queueKeys = types.map((t) => this.getQueueKey(t));

    if (this.isRedisConnected && this.redisBlockingClient) {
      try {
        // brpop returns [key, element] or null if timeout
        const result = await this.redisBlockingClient.brpop(...queueKeys, timeoutSeconds);
        if (result && result[1]) {
          return JSON.parse(result[1]) as QueueJob<T>;
        }
        return null;
      } catch {
        // Fallback to memory
      }
    }

    // In-memory pop check across requested queues
    for (const key of queueKeys) {
      const q = this.memoryQueues.get(key);
      if (q && q.length > 0) {
        return (q.shift() as QueueJob<T>) || null;
      }
    }

    // If memory queue is empty, await briefly for test environments
    if (timeoutSeconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(timeoutSeconds * 1000, 200)));
      for (const key of queueKeys) {
        const q = this.memoryQueues.get(key);
        if (q && q.length > 0) {
          return (q.shift() as QueueJob<T>) || null;
        }
      }
    }

    return null;
  }

  /**
   * Query the depth of a specific queue.
   */
  public async getQueueDepth(type: JobType): Promise<number> {
    const queueKey = this.getQueueKey(type);

    if (this.isRedisConnected && this.redisClient) {
      try {
        return await this.redisClient.llen(queueKey);
      } catch {
        // fallback
      }
    }

    return this.memoryQueues.get(queueKey)?.length || 0;
  }

  /**
   * Re-queue a failed job with incremented attempt counter.
   */
  public async retry(job: QueueJob): Promise<boolean> {
    if (job.attempts + 1 >= job.maxAttempts) {
      return false; // Exhausted
    }

    job.attempts += 1;
    await this.push(job);
    return true;
  }

  public async close(): Promise<void> {
    if (this.redisClient) {
      await this.redisClient.quit();
      this.redisClient = null;
    }
    if (this.redisBlockingClient) {
      await this.redisBlockingClient.quit();
      this.redisBlockingClient = null;
    }
    this.memoryQueues.clear();
    DistributedJobQueue.instance = null;
  }
}

export const jobQueue = DistributedJobQueue.getInstance();
