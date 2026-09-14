import { Router, Response } from 'express';
import { TenancyEnforcer, TenantScopedRequest } from '../security/tenancy.js';
import {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  insertNotification,
  NotificationType,
} from '../db/database.js';

export const notificationsRouter = Router();

// 1. GET /v1/notifications - List Recent Notifications & Unread Count
notificationsRouter.get(
  '/',
  TenancyEnforcer.authenticateTenant(),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const tenantContext = req.tenantContext!;
      const limit = typeof req.query.limit === 'string' ? Math.min(100, Math.max(1, parseInt(req.query.limit, 10))) : 30;

      const unreadCount = getUnreadNotificationCount(tenantContext.tenantId);
      const notifications = getNotifications(tenantContext.tenantId, limit);

      res.json({
        success: true,
        tenant_id: tenantContext.tenantId,
        unread_count: unreadCount,
        count: notifications.length,
        notifications,
      });
    } catch (err: any) {
      console.error('❌ Error fetching notifications:', err);
      res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
  }
);

// 2. POST /v1/notifications/:id/read - Mark Single Notification as Read
notificationsRouter.post(
  '/:id/read',
  TenancyEnforcer.authenticateTenant(),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const tenantContext = req.tenantContext!;
      const rawId = req.params.id;
      const notificationId = (Array.isArray(rawId) ? rawId[0] : rawId) || '';
      if (!notificationId) {
        res.status(400).json({ error: 'Notification ID required' });
        return;
      }

      markNotificationAsRead(notificationId, tenantContext.tenantId);

      const unreadCount = getUnreadNotificationCount(tenantContext.tenantId);

      res.json({
        success: true,
        notification_id: notificationId,
        unread_count: unreadCount,
      });
    } catch (err: any) {
      console.error('❌ Error marking notification as read:', err);
      res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
  }
);

// 3. POST /v1/notifications/mark-all-read - Mark All Notifications as Read
notificationsRouter.post(
  '/mark-all-read',
  TenancyEnforcer.authenticateTenant(),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const tenantContext = req.tenantContext!;
      markAllNotificationsAsRead(tenantContext.tenantId);

      res.json({
        success: true,
        tenant_id: tenantContext.tenantId,
        unread_count: 0,
      });
    } catch (err: any) {
      console.error('❌ Error marking all notifications as read:', err);
      res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
  }
);

// 4. POST /v1/notifications/test - Generate a Test Notification
notificationsRouter.post(
  '/test',
  TenancyEnforcer.authenticateTenant(),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const tenantContext = req.tenantContext!;
      const type = (req.body.type || 'LINK_CREATED') as NotificationType;
      const title = req.body.title || 'Autonomous Payment Link Created';
      const message = req.body.message || 'Razorpay payment link created for opportunity opp_sample_999 (₹750.00).';
      const linkUrl = req.body.link_url || '/dashboard';

      const notificationId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      insertNotification({
        id: notificationId,
        tenant_id: tenantContext.tenantId,
        type,
        title,
        message,
        link_url: linkUrl,
        created_at: new Date().toISOString(),
      });

      const unreadCount = getUnreadNotificationCount(tenantContext.tenantId);

      res.status(201).json({
        success: true,
        notification_id: notificationId,
        unread_count: unreadCount,
      });
    } catch (err: any) {
      console.error('❌ Error creating test notification:', err);
      res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
  }
);

// 5. POST /v1/notifications/whatsapp/preview - Preview WhatsApp Message Template
notificationsRouter.post(
  '/whatsapp/preview',
  TenancyEnforcer.authenticateTenant(),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const { buildWhatsAppRecoveryMessage } = await import('../notifications/whatsapp.js');
      const amountPaise = req.body.amount_paise || 500000;
      const customerName = req.body.customer_name || 'Rahul Sharma';
      const recoveryUrl = req.body.recovery_url || 'https://rzp.io/i/plink_demo123';
      const reasonCode = req.body.reason_code || 'insufficient_funds';
      const merchantName = req.body.merchant_name || 'Acme Store';

      const previewText = buildWhatsAppRecoveryMessage({
        to: '+919876543210',
        customerName,
        amountPaise,
        currency: 'INR',
        recoveryUrl,
        opportunityId: 'opp_demo_102',
        reasonCode,
        merchantName,
      });

      res.json({
        success: true,
        preview_text: previewText,
        formatted_amount: `₹${(amountPaise / 100).toFixed(2)}`,
        channel: 'whatsapp',
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
  }
);

// 6. POST /v1/notifications/whatsapp/send - Test WhatsApp Recovery Dispatch
notificationsRouter.post(
  '/whatsapp/send',
  TenancyEnforcer.authenticateTenant(),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const tenantContext = req.tenantContext!;
      const { sendWhatsAppRecoveryNotification } = await import('../notifications/whatsapp.js');
      const to = req.body.to || '+919876543210';
      const customerName = req.body.customer_name || 'Customer';
      const amountPaise = req.body.amount_paise || 500000;
      const recoveryUrl = req.body.recovery_url || 'https://rzp.io/i/plink_demo123';
      const opportunityId = req.body.opportunity_id || `opp_manual_${Date.now()}`;
      const reasonCode = req.body.reason_code || 'insufficient_funds';

      const sendResult = await sendWhatsAppRecoveryNotification({
        to,
        customerName,
        amountPaise,
        currency: req.body.currency || 'INR',
        recoveryUrl,
        opportunityId,
        reasonCode,
        tenantId: tenantContext.tenantId,
      });

      res.json({
        success: sendResult.success,
        result: sendResult,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
  }
);

// 7. POST /v1/notifications/email/signup-confirm - Dispatch Signup Confirmation Email
notificationsRouter.post(
  '/email/signup-confirm',
  TenancyEnforcer.authenticateTenant(),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const { sendSignupConfirmationEmail } = await import('../notifications/email.js');
      const email = req.body.email || req.tenantContext?.user?.email;
      const businessName = req.body.business_name || req.tenantContext?.tenantId || 'Your Business';
      const userName = req.body.user_name || (req.tenantContext?.user as any)?.name || businessName;
      const loginUrl = req.body.login_url || `${process.env.APP_URL || 'http://localhost:3000'}/login`;

      if (!email) {
        res.status(400).json({ error: 'Validation Error', message: 'email is required.' });
        return;
      }

      const result = await sendSignupConfirmationEmail({
        email,
        businessName,
        userName,
        loginUrl,
      });

      res.json({
        success: result.success,
        id: result.id,
        service: 'confirm_signup',
        recipient: email,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
  }
);

// 8. POST /v1/notifications/email/relink - Dispatch Payment Recovery Relink Email
notificationsRouter.post(
  '/email/relink',
  TenancyEnforcer.authenticateTenant(),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const { sendPaymentRelinkEmail } = await import('../notifications/email.js');
      const { getOpportunityById, getExecutionRecordByOpportunityId } = await import('../db/database.js');

      let to = req.body.to;
      let customerName = req.body.customer_name;
      let amountPaise = req.body.amount_paise;
      let recoveryUrl = req.body.recovery_url;
      const opportunityId = req.body.opportunity_id;
      let reasonCode = req.body.reason_code;
      const merchantName = req.body.merchant_name || 'CTRL Recovery';

      // Auto-populate from DB if opportunity_id is given
      if (opportunityId) {
        const opp = getOpportunityById(opportunityId);
        if (opp) {
          amountPaise = amountPaise ?? opp.amount_paise;
          reasonCode = reasonCode ?? opp.reason_code;
          const exec = getExecutionRecordByOpportunityId(opportunityId);
          if (exec && !recoveryUrl) {
            recoveryUrl = exec.link_url;
          }
        }
      }

      if (!to) {
        res.status(400).json({ error: 'Validation Error', message: 'Recipient email (to) is required.' });
        return;
      }

      recoveryUrl = recoveryUrl || 'https://rzp.io/i/plink_demo';
      amountPaise = amountPaise || 50000;

      const result = await sendPaymentRelinkEmail({
        to,
        customerName: customerName || 'Valued Customer',
        amountPaise,
        currency: req.body.currency || 'INR',
        recoveryUrl,
        opportunityId: opportunityId || `opp_rel_${Date.now()}`,
        reasonCode: reasonCode || 'payment_failed',
        merchantName,
      });

      res.json({
        success: result.success,
        id: result.id,
        service: 'send_relink_to_pay',
        recipient: to,
        recovery_url: recoveryUrl,
        amount_paise: amountPaise,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
  }
);

// 9. POST /v1/notifications/email/preview - Preview Template for Signup or Relink
notificationsRouter.post(
  '/email/preview',
  TenancyEnforcer.authenticateTenant(),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const { buildSignupConfirmationHtml, buildPaymentRelinkHtml } = await import('../notifications/email.js');
      const type = req.body.type || 'relink'; // 'signup' | 'relink'

      if (type === 'signup') {
        const html = buildSignupConfirmationHtml({
          email: req.body.email || 'merchant@example.com',
          businessName: req.body.business_name || 'Acme Corporation',
          userName: req.body.user_name || 'Acme Merchant',
          loginUrl: req.body.login_url || 'https://ctrl-recovery.vercel.app/login',
        });
        res.json({
          success: true,
          type: 'confirm_signup',
          preview_html: html,
        });
        return;
      }

      const html = buildPaymentRelinkHtml({
        to: req.body.to || 'customer@example.com',
        customerName: req.body.customer_name || 'Rahul Sharma',
        amountPaise: req.body.amount_paise || 499900,
        currency: req.body.currency || 'INR',
        recoveryUrl: req.body.recovery_url || 'https://rzp.io/i/plink_preview_123',
        opportunityId: req.body.opportunity_id || 'opp_preview_888',
        reasonCode: req.body.reason_code || 'insufficient_funds',
        merchantName: req.body.merchant_name || 'Acme Merchant',
      });

      res.json({
        success: true,
        type: 'send_relink_to_pay',
        preview_html: html,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
  }
);


