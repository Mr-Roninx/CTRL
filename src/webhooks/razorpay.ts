import crypto from 'node:crypto';
import { Request, Response } from 'express';
import {
  db,
  getOpportunityById,
  getOpportunityByRazorpayEventId,
  insertOpportunity,
  insertLedgerEntry,
  updateOpportunityStatus,
  getAllExecutionRecords,
} from '../db/database.js';
import { normalizeOpportunity } from '../perception/normalizer.js';
import { AutonomousRecoveryDaemon } from '../agents/daemon.js';
import { AuthoritativeReconciler } from '../reconciliation/authoritative_reconciler.js';

export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signature: string | undefined,
  secret: string | undefined
): boolean {
  if (!signature || !secret) {
    return false;
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8'))
      .digest('hex');

    const sigBuf = Buffer.from(signature, 'utf-8');
    const expBuf = Buffer.from(expectedSignature, 'utf-8');

    if (sigBuf.length !== expBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

/**
 * Real Razorpay Webhook Ingestion Handler.
 * NOTE: This endpoint accepts deliveries verified against RAZORPAY_WEBHOOK_SECRET.
 * Every failed payment ingested here is assigned source='real'.
 */
import { WebhookValidator } from '../security/webhook_validator.js';
import { RazorpayConnectionService } from '../providers/razorpay/connection_service.js';

export async function handleRazorpayWebhook(req: Request, res: Response): Promise<void> {
  try {
    const rawTenantId = req.params.tenant_id;
    const tenantId = (Array.isArray(rawTenantId) ? rawTenantId[0] : rawTenantId) || (req.query.tenant_id as string) || 'tenant_system_default';

    const signature = req.headers['x-razorpay-signature'] as string | undefined;
    const timestamp = req.headers['x-razorpay-event-timestamp'] as string | undefined;
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);
    const eventId = req.body?.event_id || req.body?.id || (req.headers['x-razorpay-event-id'] as string | undefined) || req.body?.payload?.payment?.entity?.id;

    // Fetch tenant's webhook secrets (check both live and test secrets to validate any incoming payload)
    let env: 'test' | 'live' = (req.body?.payload?.payment?.entity?.environment === 'live') ? 'live' : 'test';
    try {
      const tenantRow = db.prepare('SELECT environment FROM tenants WHERE id = ? LIMIT 1;').get(tenantId) as any;
      if (tenantRow?.environment === 'live') {
        env = 'live';
      }
    } catch {}
    const envSecrets = await RazorpayConnectionService.getWebhookSecrets(tenantId, env);
    const altEnv = env === 'live' ? 'test' : 'live';
    const altSecrets = await RazorpayConnectionService.getWebhookSecrets(tenantId, altEnv);
    const webhookSecrets = [...new Set([...envSecrets, ...altSecrets])];

    const validation = await WebhookValidator.validateWebhook({
      tenantId,
      webhookSecrets,
      clientIp,
      rawBody,
      signatureHeader: signature,
      timestampHeader: timestamp,
      eventId: eventId,
    });

    if (!validation.valid) {
      res.status(validation.status_code).json({ error: validation.error_reason });
      return;
    }

    const payload = req.body;
    const eventName: string | undefined = payload?.event;

    // 1. Handle payment_link.paid event (Truth Engine Reconciliation)
    if (eventName === 'payment_link.paid') {
      const linkEntity = payload?.payload?.payment_link?.entity;
      const refId = linkEntity?.reference_id;
      const linkId = linkEntity?.id;

      // Find opportunity by reference_id or by matching execution record
      let oppId = refId;
      if (!oppId && linkId) {
        const records = getAllExecutionRecords();
        const matched = records.find((r) => r.razorpay_payment_link_id === linkId);
        if (matched) oppId = matched.opportunity_id;
      }

      if (oppId) {
        const opp = getOpportunityById(oppId);
        if (opp) {
          const reconResult = await AuthoritativeReconciler.reconcileOpportunity(oppId, {
            providerPayloadOverride: linkEntity,
            actor: 'razorpay_webhook',
          });

          res.status(200).json({
            received: true,
            reconciled: reconResult.is_recovered,
            status: reconResult.new_opportunity_status,
            idempotent: reconResult.is_idempotent_no_op,
            opportunity_id: oppId,
            ledger_entry_hash: reconResult.ledger_entry_hash,
          });
          return;
        }
      }

      res.status(200).json({ received: true, processed: false, reason: 'Opportunity not found for payment link' });
      return;
    }

    // 2. Handle payment_link.expired / cancelled event
    if (eventName === 'payment_link.expired' || eventName === 'payment_link.cancelled') {
      const linkEntity = payload?.payload?.payment_link?.entity;
      const refId = linkEntity?.reference_id;
      const linkId = linkEntity?.id;

      let oppId = refId;
      if (!oppId && linkId) {
        const records = getAllExecutionRecords();
        const matched = records.find((r) => r.razorpay_payment_link_id === linkId);
        if (matched) oppId = matched.opportunity_id;
      }

      if (oppId) {
        const opp = getOpportunityById(oppId);
        if (opp) {
          const reconResult = await AuthoritativeReconciler.reconcileOpportunity(oppId, {
            providerPayloadOverride: linkEntity,
            actor: 'razorpay_webhook',
          });

          res.status(200).json({
            received: true,
            reconciled: true,
            status: reconResult.new_opportunity_status,
            opportunity_id: oppId,
          });
          return;
        }
      }

      res.status(200).json({ received: true, processed: false });
      return;
    }

    // 3. Handle payment.failed event (Event Fabric / Perception Ingestion)
    if (eventName === 'payment.failed') {
      const paymentEntity = payload?.payload?.payment?.entity;
      if (!paymentEntity) {
        res.status(400).json({ error: 'Missing payment entity in payload' });
        return;
      }

      const paymentId: string = paymentEntity.id || `pay_${Date.now()}`;

      // Deduplication check by eventId or paymentId
      if (eventId) {
        const existingByEvent = getOpportunityByRazorpayEventId(eventId);
        if (existingByEvent) {
          res.status(200).json({
            received: true,
            deduplicated: true,
            opportunity_id: existingByEvent.id,
          });
          return;
        }
      }

      // Check if opportunity already exists for this payment_id
      const existingByPaymentId = getOpportunityById(paymentId);
      if (existingByPaymentId) {
        res.status(200).json({
          received: true,
          deduplicated: true,
          opportunity_id: existingByPaymentId.id,
        });
        return;
      }

      // Run Perception Normalization (source='real')
      const opportunity = normalizeOpportunity(paymentEntity, eventId, { source: 'real', tenantId, environment: env });

      // Insert normalized opportunity
      insertOpportunity(opportunity);

      // Trigger instantaneous autonomous recovery sweep in background
      AutonomousRecoveryDaemon.getInstance().sweepOnce().catch((err: any) => {
        console.warn('⚠️ Auto-recovery trigger error:', err.message);
      });

      // Audit trail in ledger
      insertLedgerEntry({
        id: `led_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        opportunity_id: opportunity.id,
        event_type: 'webhook_received',
        amount_paise: opportunity.amount_paise,
        timestamp: opportunity.created_at,
        raw_payload_ref: JSON.stringify({
          event: eventName,
          event_id: eventId,
          payment_id: opportunity.id,
          reason_code: opportunity.reason_code,
          decline_type: opportunity.decline_type,
          customer_trust_score: opportunity.customer_trust_score,
        }),
      });

      res.status(200).json({
        received: true,
        opportunity_id: opportunity.id,
        decline_type: opportunity.decline_type,
        customer_trust_score: opportunity.customer_trust_score,
        status: 'pending',
      });
      return;
    }

    // Other Razorpay events ignored safely
    res.status(200).json({ received: true, ignored: true, event: eventName });
  } catch (error) {
    console.error('Error handling webhook:', error);
    res.status(500).json({ error: 'Internal server error processing webhook' });
  }
}

/**
 * Isolated Simulation Webhook Handler (Test Traffic Only).
 * Explicitly marks all ingested opportunities as source='synthetic' unconditionally.
 */
export async function handleSimulatedWebhook(req: Request, res: Response): Promise<void> {
  try {
    const signature = req.headers['x-razorpay-signature'] as string | undefined;

    // Extract tenant_id from simulated request params or fallback to system default
    const rawTenantId = req.params.tenant_id;
    const tenantId = (Array.isArray(rawTenantId) ? rawTenantId[0] : rawTenantId) || 'tenant_system_default';
    const webhookSecrets = await RazorpayConnectionService.getWebhookSecrets(tenantId, 'test');
    
    // In simulated test routes without explicit webhook setup, we use the fallback
    if (webhookSecrets.length === 0 && process.env.RAZORPAY_WEBHOOK_SECRET === 'rzp_whsec_ctrl_test') {
      webhookSecrets.push('rzp_whsec_ctrl_test');
    }

    // Verify HMAC signature against raw payload
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);

    if (!signature || webhookSecrets.length === 0) {
      res.status(400).json({ error: 'Missing signature or no webhook secrets configured' });
      return;
    }

    let isValid = false;
    for (const secret of webhookSecrets) {
      if (verifyWebhookSignature(rawBody, signature, secret)) {
        isValid = true;
        break;
      }
    }

    if (!isValid) {
      res.status(400).json({ error: 'Invalid simulated webhook signature' });
      return;
    }

    const payload = req.body;
    const eventId: string | undefined = payload?.event_id || payload?.id;
    const eventName: string | undefined = payload?.event;

    // 1. Handle payment_link.paid event (Simulation)
    if (eventName === 'payment_link.paid') {
      const linkEntity = payload?.payload?.payment_link?.entity;
      const refId = linkEntity?.reference_id;
      const linkId = linkEntity?.id;

      let oppId = refId;
      if (!oppId && linkId) {
        const records = getAllExecutionRecords();
        const matched = records.find((r) => r.razorpay_payment_link_id === linkId);
        if (matched) oppId = matched.opportunity_id;
      }

      if (oppId) {
        const opp = getOpportunityById(oppId);
        if (opp) {
          const reconResult = await AuthoritativeReconciler.reconcileOpportunity(oppId, {
            providerPayloadOverride: linkEntity,
            actor: 'simulated_webhook',
          });

          res.status(200).json({
            received: true,
            reconciled: reconResult.is_recovered,
            simulated: true,
            status: reconResult.new_opportunity_status,
            idempotent: reconResult.is_idempotent_no_op,
            opportunity_id: oppId,
            ledger_entry_hash: reconResult.ledger_entry_hash,
          });
          return;
        }
      }

      res.status(200).json({ received: true, processed: false, simulated: true, reason: 'Opportunity not found' });
      return;
    }

    // 2. Handle payment.failed event (Simulation -> source='synthetic')
    if (eventName === 'payment.failed') {
      const paymentEntity = payload?.payload?.payment?.entity;
      if (!paymentEntity) {
        res.status(400).json({ error: 'Missing payment entity in payload' });
        return;
      }

      const paymentId: string = paymentEntity.id || `pay_sim_${Date.now()}`;

      if (eventId) {
        const existingByEvent = getOpportunityByRazorpayEventId(eventId);
        if (existingByEvent) {
          res.status(200).json({
            received: true,
            deduplicated: true,
            simulated: true,
            opportunity_id: existingByEvent.id,
          });
          return;
        }
      }

      const existingByPaymentId = getOpportunityById(paymentId);
      if (existingByPaymentId) {
        res.status(200).json({
          received: true,
          deduplicated: true,
          simulated: true,
          opportunity_id: existingByPaymentId.id,
        });
        return;
      }

      // Run Perception Normalization with source='synthetic' and environment='test' unconditionally
      const opportunity = normalizeOpportunity(paymentEntity, eventId, { source: 'synthetic', tenantId, environment: 'test' });

      // Insert synthetic opportunity
      insertOpportunity(opportunity);

      // Trigger instantaneous autonomous recovery sweep in background
      AutonomousRecoveryDaemon.getInstance().sweepOnce().catch((err: any) => {
        console.warn('⚠️ Auto-recovery trigger error:', err.message);
      });

      // Audit trail in ledger
      insertLedgerEntry({
        id: `led_sim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        opportunity_id: opportunity.id,
        event_type: 'webhook_received',
        amount_paise: opportunity.amount_paise,
        timestamp: opportunity.created_at,
        raw_payload_ref: JSON.stringify({
          event: eventName,
          event_id: eventId,
          simulated: true,
          payment_id: opportunity.id,
          reason_code: opportunity.reason_code,
          decline_type: opportunity.decline_type,
          customer_trust_score: opportunity.customer_trust_score,
        }),
      });

      res.status(200).json({
        received: true,
        simulated: true,
        opportunity_id: opportunity.id,
        decline_type: opportunity.decline_type,
        customer_trust_score: opportunity.customer_trust_score,
        status: 'pending',
      });
      return;
    }

    res.status(200).json({ received: true, ignored: true, simulated: true, event: eventName });
  } catch (error) {
    console.error('Error handling simulated webhook:', error);
    res.status(500).json({ error: 'Internal server error processing simulated webhook' });
  }
}
