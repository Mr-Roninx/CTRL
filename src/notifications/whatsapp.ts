import dotenv from 'dotenv';
import path from 'node:path';
import { insertNotification } from '../db/database.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export interface SendWhatsAppOptions {
  to: string; // E.164 phone number, e.g. +919876543210 or 9876543210
  customerName?: string;
  amountPaise: number;
  currency?: string;
  recoveryUrl: string;
  opportunityId: string;
  reasonCode?: string;
  merchantName?: string;
  tenantId?: string;
  tailoredMessage?: string;
}

export interface WhatsAppSendResult {
  success: boolean;
  messageId?: string;
  channel: 'whatsapp';
  destination: string;
  body: string;
  error?: string;
}

/**
 * Formats a user-friendly failed payment reason into readable text.
 */
function formatFriendlyReason(reasonCode?: string): string {
  if (!reasonCode) return 'a temporary payment processing interruption';
  const clean = reasonCode.toLowerCase();
  if (clean.includes('insufficient')) return 'insufficient balance in your account';
  if (clean.includes('timeout') || clean.includes('network')) return 'a temporary bank network timeout';
  if (clean.includes('auth') || clean.includes('otp')) return 'a payment authentication interruption';
  if (clean.includes('limit')) return 'a daily transaction limit restriction';
  return reasonCode.replace(/_/g, ' ');
}

/**
 * Formats the standard CTRL customer recovery message text for WhatsApp.
 */
export function buildWhatsAppRecoveryMessage(options: SendWhatsAppOptions): string {
  if (options.tailoredMessage && options.tailoredMessage.trim().length > 0) {
    return options.tailoredMessage.trim();
  }

  const amountRupees = (options.amountPaise / 100).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
  const merchant = options.merchantName || 'Our Merchant Checkout';
  const greeting = options.customerName ? `Hi ${options.customerName},` : 'Hello,';
  const reason = formatFriendlyReason(options.reasonCode);

  return [
    `🔔 *Payment Incomplete Notification*`,
    ``,
    `${greeting}`,
    `Your payment of *₹${amountRupees}* for *${merchant}* could not be completed due to ${reason}.`,
    ``,
    `Your transaction is still pending. You can securely complete your payment with 1-click via UPI (Google Pay, PhonePe, Paytm, BHIM), NetBanking, or Cards:`,
    ``,
    `👉 *Pay ₹${amountRupees} securely:*`,
    `${options.recoveryUrl}`,
    ``,
    `_This verified payment link is issued directly via Razorpay Secure Gateway._`,
    `_If you did not initiate this transaction, you can safely ignore this message._`,
  ].join('\n');
}

/**
 * Dispatches a WhatsApp Recovery Notification via Meta Cloud API or graceful dev simulation.
 */
export async function sendWhatsAppRecoveryNotification(options: SendWhatsAppOptions): Promise<WhatsAppSendResult> {
  const messageBody = buildWhatsAppRecoveryMessage(options);
  const rawTo = options.to.replace(/\D/g, '');
  const formattedTo = rawTo.length === 10 ? `91${rawTo}` : rawTo;

  const whatsappToken = process.env.WHATSAPP_API_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  try {
    // 1. Live WhatsApp Business / Cloud API dispatch if configured
    if (whatsappToken && phoneNumberId) {
      const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${whatsappToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: formattedTo,
          type: 'text',
          text: {
            preview_url: true,
            body: messageBody,
          },
        }),
      });

      const resJson: any = await response.json();
      if (!response.ok) {
        throw new Error(resJson?.error?.message || `WhatsApp API error (${response.status})`);
      }

      const messageId = resJson?.messages?.[0]?.id || `wamid_${Date.now()}`;
      
      // Store in notification audit trail
      insertNotification({
        id: `notif_wa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        tenant_id: options.tenantId || 'tenant_system_default',
        type: 'WHATSAPP_DISPATCHED',
        title: 'WhatsApp Recovery Dispatched',
        message: `Recovery link dispatched to +${formattedTo} for opportunity ${options.opportunityId}`,
        link_url: options.recoveryUrl,
        created_at: new Date().toISOString(),
      });

      return {
        success: true,
        messageId,
        channel: 'whatsapp',
        destination: `+${formattedTo}`,
        body: messageBody,
      };
    }

    // 2. High-Fidelity Simulation Mode for Dev & Buildathon Demonstrations
    const simMessageId = `wamid_sim_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    console.log(`📱 [WHATSAPP RECOVERY DISPATCH] To: +${formattedTo} | Opp: ${options.opportunityId}`);
    console.log(`--------------------------------------------------------------------------------`);
    console.log(messageBody);
    console.log(`--------------------------------------------------------------------------------`);

    insertNotification({
      id: `notif_wa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      tenant_id: options.tenantId || 'tenant_system_default',
      type: 'WHATSAPP_DISPATCHED',
      title: 'WhatsApp Recovery Dispatched (Dev Mode)',
      message: `Recovery link delivered to +${formattedTo} for opportunity ${options.opportunityId}`,
      link_url: options.recoveryUrl,
      created_at: new Date().toISOString(),
    });

    return {
      success: true,
      messageId: simMessageId,
      channel: 'whatsapp',
      destination: `+${formattedTo}`,
      body: messageBody,
    };
  } catch (error: any) {
    console.error(`❌ Failed to dispatch WhatsApp message to +${formattedTo}:`, error.message);
    return {
      success: false,
      channel: 'whatsapp',
      destination: `+${formattedTo}`,
      body: messageBody,
      error: error.message,
    };
  }
}
