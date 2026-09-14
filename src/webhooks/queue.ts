import crypto from 'node:crypto';
import {
  insertWebhookDelivery,
  getWebhookDeliveryById,
  updateWebhookDeliveryStatus,
  getDueWebhookRetries,
  WebhookDeliveryQueueItem,
  WebhookQueueStatus,
  insertOpportunity,
  insertLedgerEntry,
  insertEventIngestionLog,
  getOpportunityById,
  getOpportunityByRazorpayEventId,
  getAllExecutionRecords,
} from '../db/database.js';
import { normalizeOpportunity } from '../perception/normalizer.js';
import { CanonicalPaymentEventSchema } from '../security/schemas.js';
import { AuthoritativeReconciler } from '../reconciliation/authoritative_reconciler.js';
import { RealtimeBroadcaster } from '../realtime/broadcaster.js';

export class WebhookQueueEngine {
  private static instance: WebhookQueueEngine;
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  public static getInstance(): WebhookQueueEngine {
    if (!WebhookQueueEngine.instance) {
      WebhookQueueEngine.instance = new WebhookQueueEngine();
    }
    return WebhookQueueEngine.instance;
  }

  /**
   * Enqueue raw incoming webhook event
   */
  public enqueue(params: {
    tenantId: string;
    source?: string;
    eventId?: string;
    eventType: string;
    payload: any;
    headers?: Record<string, any>;
  }): WebhookDeliveryQueueItem {
    const id = `deliv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const stringifiedPayload = typeof params.payload === 'string' ? params.payload : JSON.stringify(params.payload);
    const stringifiedHeaders = params.headers ? JSON.stringify(params.headers) : undefined;

    const item: WebhookDeliveryQueueItem = {
      id,
      tenant_id: params.tenantId,
      source: params.source || 'RAZORPAY_WEBHOOK',
      event_id: params.eventId,
      event_type: params.eventType,
      payload: stringifiedPayload,
      headers: stringifiedHeaders,
      status: 'PENDING',
      attempts: 0,
      max_attempts: 5,
      created_at: new Date().toISOString(),
    };

    insertWebhookDelivery(item);
    return item;
  }

  /**
   * Process a single queued delivery item
   */
  public async processDelivery(item: WebhookDeliveryQueueItem): Promise<{ success: boolean; opportunity_id?: string; error?: string }> {
    const attempts = item.attempts + 1;
    updateWebhookDeliveryStatus(item.id, 'PROCESSING', { attempts });

    try {
      let rawJson: any;
      try {
        rawJson = JSON.parse(item.payload);
      } catch {
        throw new Error('Invalid JSON payload format');
      }

      // If payload is already canonical
      let canonicalData = rawJson;

      // If payload is a raw Razorpay Webhook format
      if (rawJson.event && rawJson.payload?.payment?.entity) {
        const payment = rawJson.payload.payment.entity;
        canonicalData = {
          event_id: rawJson.event_id || item.event_id || `evt_wh_${Date.now()}`,
          source: item.source,
          provider: 'razorpay',
          environment: payment.notes?.environment || 'test',
          payment_id: payment.id,
          order_id: payment.order_id,
          amount_paise: payment.amount,
          currency: payment.currency || 'INR',
          status: payment.status === 'failed' ? 'failed' : (payment.status === 'captured' || payment.status === 'paid' ? 'paid' : payment.status),
          failure_code: payment.error_code || 'WEBHOOK_FAILURE',
          failure_description: payment.error_description || payment.error_reason || 'Payment failed',
          customer_reference: payment.email || payment.contact || 'cust_anonymous',
          customer_email: payment.email,
          customer_phone: payment.contact,
          occurred_at: new Date(payment.created_at ? payment.created_at * 1000 : Date.now()).toISOString(),
          metadata: payment.notes || {},
        };
      }

      // Validate schema
      const parseResult = CanonicalPaymentEventSchema.safeParse({
        ...canonicalData,
        tenant_id: item.tenant_id,
        environment: canonicalData.environment || 'test',
        received_at: new Date().toISOString(),
      });

      if (!parseResult.success) {
        const errorDetails = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
        throw new Error(`Schema validation error: ${errorDetails}`);
      }

      const event = parseResult.data;
      let opportunityId: string | undefined;

      // Handle Failed payment ingestion
      if (event.status === 'failed') {
        const existing = event.event_id ? getOpportunityByRazorpayEventId(event.event_id) : undefined;
        if (existing) {
          opportunityId = existing.id;
        } else {
          const opportunity = normalizeOpportunity(
            {
              id: event.payment_id || `pay_${Date.now()}`,
              amount: event.amount_paise,
              currency: event.currency,
              error_code: event.failure_code || 'UNKNOWN_ERROR',
              error_description: event.failure_description || 'Payment failed',
              customer_id: event.customer_reference,
              email: event.customer_email || undefined,
              contact: event.customer_phone || undefined,
              order_id: event.order_id || undefined,
              attempts: event.attempt_number || 1,
              notes: event.metadata || undefined,
            },
            event.event_id,
            {
              source: event.environment === 'live' ? 'real' : 'synthetic',
              tenantId: item.tenant_id,
              environment: event.environment || 'test',
            }
          );

          insertOpportunity(opportunity);
          opportunityId = opportunity.id;

          insertLedgerEntry({
            id: `led_evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            opportunity_id: opportunity.id,
            event_type: 'webhook_received',
            amount_paise: opportunity.amount_paise,
            timestamp: opportunity.created_at,
            raw_payload_ref: JSON.stringify({
              event_id: event.event_id,
              delivery_id: item.id,
              source: item.source,
            }),
          });
        }
      } else if (event.status === 'paid' || event.status === 'captured') {
        let matchedOppId: string | null = null;
        if (event.payment_id) {
          const matched = getOpportunityById(event.payment_id);
          if (matched) matchedOppId = matched.id;
        }
        if (!matchedOppId && event.payment_link_id) {
          const records = getAllExecutionRecords(item.tenant_id);
          const found = records.find((r) => r.razorpay_payment_link_id === event.payment_link_id);
          if (found) matchedOppId = found.opportunity_id;
        }

        if (matchedOppId) {
          await AuthoritativeReconciler.reconcileOpportunity(matchedOppId, {
            actor: 'webhook_queue_processor',
          });
          opportunityId = matchedOppId;
        }
      }

      // Mark Delivered
      updateWebhookDeliveryStatus(item.id, 'DELIVERED', {
        attempts,
        delivered_at: new Date().toISOString(),
        last_error: undefined,
      });

      // Broadcast live event stream update
      RealtimeBroadcaster.getInstance().broadcastToTenant(item.tenant_id, 'EVENT_INGESTED', {
        delivery_id: item.id,
        event_id: item.event_id,
        status: 'DELIVERED',
        opportunity_id: opportunityId,
      });

      return { success: true, opportunity_id: opportunityId };
    } catch (err: any) {
      const isDeadLetter = attempts >= item.max_attempts;
      const nextDelayMs = Math.min(15 * 60 * 1000, Math.pow(2, attempts) * 5000); // Exponential backoff (10s, 20s, 40s...)
      const nextRetry = isDeadLetter ? undefined : new Date(Date.now() + nextDelayMs).toISOString();

      const newStatus: WebhookQueueStatus = isDeadLetter ? 'DEAD_LETTER' : 'FAILED';
      updateWebhookDeliveryStatus(item.id, newStatus, {
        attempts,
        last_error: err.message,
        next_retry_at: nextRetry,
      });

      return { success: false, error: err.message };
    }
  }

  /**
   * Replay a specific webhook delivery on demand
   */
  public async replayWebhook(deliveryId: string, tenantId: string): Promise<{ success: boolean; opportunity_id?: string; error?: string }> {
    const item = getWebhookDeliveryById(deliveryId, tenantId);
    if (!item) {
      throw new Error(`Webhook delivery record '${deliveryId}' not found for tenant '${tenantId}'`);
    }

    return this.processDelivery(item);
  }

  /**
   * Run one iteration of due webhook retries
   */
  public async processDueRetries(): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;

    try {
      const dueItems = getDueWebhookRetries(20);
      for (const item of dueItems) {
        await this.processDelivery(item);
      }
      return dueItems.length;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Start background retry worker
   */
  public startWorker(intervalMs: number = 10000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.processDueRetries().catch(console.error);
    }, intervalMs);
    this.timer.unref?.();
  }

  public stopWorker(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
