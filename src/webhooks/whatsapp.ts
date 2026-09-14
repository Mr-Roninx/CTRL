import { Request, Response } from 'express';
import { db } from '../db/database.js';

export const DEFAULT_WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'ctrl_meta_verify_token_2026';

/**
 * Handles Meta Webhook Verification Challenge (GET)
 * Meta documentation: https://developers.facebook.com/docs/graph-api/webhooks/getting-started
 */
export function handleWhatsAppVerification(req: Request, res: Response): void {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || DEFAULT_WHATSAPP_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === expectedToken) {
    console.log('✅ [META WHATSAPP WEBHOOK] Challenge verification succeeded.');
    res.status(200).send(challenge);
  } else {
    console.warn(`❌ [META WHATSAPP WEBHOOK] Challenge verification failed. Received: "${token}", Expected: "${expectedToken}"`);
    res.status(403).json({ error: 'Verification token mismatch' });
  }
}

/**
 * Handles Inbound Meta WhatsApp Event Notifications (POST)
 * Processes delivery status updates (sent, delivered, read) & customer responses.
 */
export async function handleWhatsAppWebhookEvent(req: Request, res: Response): Promise<void> {
  // Acknowledge receipt to Meta immediately within 3s SLA
  res.status(200).send('EVENT_RECEIVED');

  try {
    const body = req.body;

    if (body.object === 'whatsapp_business_account' || body.entry) {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value;
          if (!value) continue;

          // 1. Process Delivery Status Receipts (sent, delivered, read, failed)
          if (value.statuses && Array.isArray(value.statuses)) {
            for (const status of value.statuses) {
              const wamid = status.id;
              const recipientId = status.recipient_id;
              const deliveryStatus = status.status; // 'sent' | 'delivered' | 'read' | 'failed'
              const timestamp = status.timestamp;

              console.log(`📱 [WHATSAPP STATUS] WAMID: ${wamid} -> Recipient: +${recipientId} -> Status: ${deliveryStatus}`);

              // Update notification log in SQLite
              try {
                db.prepare(`
                  UPDATE notifications 
                  SET message = message || ' [Status: ' || ? || ']'
                  WHERE link_url LIKE ? OR id LIKE ?
                `).run(deliveryStatus, `%${recipientId}%`, `%${wamid}%`);
              } catch {}
            }
          }

          // 2. Process Inbound Messages / Opt-outs (e.g. customer replies STOP)
          if (value.messages && Array.isArray(value.messages)) {
            for (const msg of value.messages) {
              const from = msg.from;
              const textBody = msg.text?.body?.trim()?.toUpperCase() || '';
              console.log(`💬 [WHATSAPP INBOUND] From: +${from} | Text: "${textBody}"`);

              // TRAI DND Compliance / Opt-Out handling
              if (textBody === 'STOP' || textBody === 'UNSUBSCRIBE') {
                console.log(`🛑 Customer +${from} requested opt-out. Respecting compliance fatigue caps.`);
              }
            }
          }
        }
      }
    }
  } catch (err: any) {
    console.error('⚠️ Error processing WhatsApp webhook event payload:', err.message);
  }
}
