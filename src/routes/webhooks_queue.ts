import { Router, Response } from 'express';
import { TenancyEnforcer, TenantScopedRequest } from '../security/tenancy.js';
import {
  getWebhookDeliveries,
  getWebhookDeliveryById,
  requeueDeadLetterWebhooks,
} from '../db/database.js';
import { WebhookQueueEngine } from '../webhooks/queue.js';

export const webhooksQueueRouter = Router();

// 1. GET /v1/webhooks/queue - List Queued & Dead Letter Deliveries
webhooksQueueRouter.get(
  '/',
  TenancyEnforcer.authenticateTenant('events:read'),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const tenantContext = req.tenantContext!;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const limit = typeof req.query.limit === 'string' ? Math.min(100, Math.max(1, parseInt(req.query.limit, 10))) : 50;

      const deliveries = getWebhookDeliveries({
        tenantId: tenantContext.tenantId,
        status,
        limit,
      });

      res.json({
        success: true,
        count: deliveries.length,
        tenant_id: tenantContext.tenantId,
        deliveries,
      });
    } catch (err: any) {
      console.error('❌ Error fetching webhook queue:', err);
      res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
  }
);

// 2. POST /v1/webhooks/queue/:id/replay - Replay a Specific Webhook Delivery
webhooksQueueRouter.post(
  '/:id/replay',
  TenancyEnforcer.authenticateTenant('events:write'),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const tenantContext = req.tenantContext!;
      const rawId = req.params.id;
      const deliveryId = (Array.isArray(rawId) ? rawId[0] : rawId) || '';
      if (!deliveryId) {
        res.status(400).json({ error: 'Delivery ID required' });
        return;
      }

      const queueEngine = WebhookQueueEngine.getInstance();
      const result = await queueEngine.replayWebhook(deliveryId, tenantContext.tenantId);

      const updated = getWebhookDeliveryById(deliveryId, tenantContext.tenantId);

      res.json({
        success: result.success,
        delivery_id: deliveryId,
        opportunity_id: result.opportunity_id,
        error: result.error,
        delivery: updated,
      });
    } catch (err: any) {
      console.error('❌ Error replaying webhook delivery:', err);
      res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
  }
);

// 3. POST /v1/webhooks/queue/retry-all - Requeue all dead-lettered / failed items
webhooksQueueRouter.post(
  '/retry-all',
  TenancyEnforcer.authenticateTenant('events:write'),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const tenantContext = req.tenantContext!;
      const count = requeueDeadLetterWebhooks(tenantContext.tenantId);

      // Trigger immediate worker iteration
      WebhookQueueEngine.getInstance().processDueRetries().catch(console.error);

      res.json({
        success: true,
        requeued_count: count,
        message: `Successfully requeued ${count} dead-lettered webhook deliveries for reprocessing.`,
      });
    } catch (err: any) {
      console.error('❌ Error requeuing dead-letter webhooks:', err);
      res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
  }
);

// 4. POST /v1/webhooks/queue/enqueue-test - Enqueue a test webhook delivery
webhooksQueueRouter.post(
  '/enqueue-test',
  TenancyEnforcer.authenticateTenant('events:write'),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const tenantContext = req.tenantContext!;
      const queueEngine = WebhookQueueEngine.getInstance();
      const uniqueId = Date.now();

      const item = queueEngine.enqueue({
        tenantId: tenantContext.tenantId,
        source: 'RAZORPAY_WEBHOOK',
        eventId: `evt_wh_test_${uniqueId}`,
        eventType: 'payment.failed',
        payload: {
          event: 'payment.failed',
          payload: {
            payment: {
              entity: {
                id: `pay_wh_${uniqueId}`,
                amount: 60000,
                currency: 'INR',
                status: 'failed',
                error_code: 'BAD_REQUEST_PAYMENT_FAILED',
                error_description: 'Webhook Queue Test: Bank authorization failed',
                email: 'webhook_test_cust@example.com',
              },
            },
          },
        },
      });

      res.status(201).json({
        success: true,
        delivery: item,
      });
    } catch (err: any) {
      console.error('❌ Error enqueuing test webhook:', err);
      res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
  }
);
