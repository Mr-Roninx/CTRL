import dotenv from 'dotenv';
import path from 'node:path';
import nodemailer from 'nodemailer';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const rawSmtpUser = process.env.SMTP_USER?.trim();
const rawSmtpPass = process.env.SMTP_PASS?.trim();
const rawSmtpHost = process.env.SMTP_HOST?.trim() || 'smtp.gmail.com';
const rawSmtpService = process.env.SMTP_SERVICE?.trim().toLowerCase() || 'gmail';

const isGmail = rawSmtpService === 'gmail' || (rawSmtpHost ? rawSmtpHost.includes('gmail') : false);
const fromEmail = process.env.SMTP_FROM || (isGmail && rawSmtpUser ? `CTRL Recovery <${rawSmtpUser}>` : `CTRL Recovery <notifications@ctrl.app>`);

// Initialize Gmail / Custom SMTP Transporter
let smtpTransporter: nodemailer.Transporter | null = null;
if (rawSmtpUser && rawSmtpPass) {
  // Automatically strip spaces from 16-character Google App Passwords (e.g. 'abcd efgh ijkl mnop' -> 'abcdefghijklmnop')
  const smtpPass = isGmail ? rawSmtpPass.replace(/\s+/g, '') : rawSmtpPass;
  const port = Number(process.env.SMTP_PORT) || 465;
  const isSecure = process.env.SMTP_SECURE !== undefined
    ? process.env.SMTP_SECURE === 'true'
    : port === 465;

  smtpTransporter = nodemailer.createTransport({
    host: rawSmtpHost,
    port,
    secure: isSecure,
    auth: {
      user: rawSmtpUser,
      pass: smtpPass,
    },
  });
  console.log(`📧 EmailService: Initialized Gmail SMTP transporter (${rawSmtpHost}:${port}) for ${rawSmtpUser}`);
} else {
  console.log('📧 EmailService: No SMTP credentials configured. Running in sandbox / evaluation simulation mode.');
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
}

export interface SendEmailResult {
  success: boolean;
  delivered: boolean;
  id?: string;
  error?: string;
  sandboxNote?: string;
}

/**
 * Dispatches an email via Gmail SMTP with graceful evaluation simulation fallback.
 */
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  try {
    const recipient = String(Array.isArray(options.to) ? options.to.join(',') : options.to || '').toLowerCase();
    if (recipient.includes('@example.com') || recipient.includes('@test.com')) {
      return { success: true, delivered: false, sandboxNote: 'Mock test domain safely acknowledged in sandbox mode.' };
    }

    // 1. Dispatch via Gmail SMTP (100% real inbox delivery without third-party sandboxes)
    if (smtpTransporter) {
      try {
        const info = await smtpTransporter.sendMail({
          from: fromEmail,
          to: options.to,
          subject: options.subject,
          html: options.html,
        });
        console.log(`📧 [GMAIL SMTP SENT] Delivered email to ${options.to} (Message ID: ${info.messageId})`);
        return { success: true, delivered: true, id: info.messageId };
      } catch (smtpErr: any) {
        console.error('❌ [GMAIL SMTP ERROR] Failed to send via SMTP:', smtpErr.message);
        return {
          success: false,
          delivered: false,
          error: smtpErr.message,
          sandboxNote: `SMTP delivery failed: ${smtpErr.message}`,
        };
      }
    }

    // 2. Fallback to Local Sandbox Simulation if SMTP credentials not configured
    console.log(`📧 [EMAIL SIMULATION] To: ${options.to} | Subject: ${options.subject}`);
    return {
      success: true,
      delivered: false,
      id: `sim_${Date.now()}`,
      sandboxNote: 'Gmail SMTP credentials not configured in environment. Verification code logged for local evaluation.',
    };
  } catch (err: any) {
    console.error('Error sending email:', err);
    return { success: false, delivered: false, error: err.message };
  }
}

/**
 * Sends a Team Invitation email.
 */
export async function sendTeamInviteEmail(recipientEmail: string, role: string, inviterName: string, inviteUrl: string) {
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 20px; color: #1e293b;">
      <h2 style="color: #0f172a; margin-bottom: 16px;">You've been invited to join CTRL</h2>
      <p style="font-size: 15px; line-height: 1.6; color: #475569;">
        <strong>${inviterName}</strong> has invited you to join their autonomous payment recovery workspace as a <strong>${role}</strong>.
      </p>
      <div style="margin: 28px 0;">
        <a href="${inviteUrl}" style="background: #3b82f6; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block;">
          Accept Invitation
        </a>
      </div>
      <p style="font-size: 13px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 16px;">
        CTRL — Autonomous Economic Control Plane for Failed Payments.
      </p>
    </div>
  `;

  return sendEmail({
    to: recipientEmail,
    subject: `Invitation to join CTRL (${role})`,
    html,
  });
}

/**
 * Sends a Magic Link sign-in / verification email.
 */
export async function sendMagicLinkEmail(recipientEmail: string, magicLinkUrl: string, businessName: string = 'CTRL') {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Sign in to CTRL</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #060b18; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f1f5f9;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #060b18; padding: 40px 20px;">
          <tr>
            <td align="center">
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background: linear-gradient(135deg, #0d1527 0%, #111a33 100%); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
                <!-- Header / Logo -->
                <tr>
                  <td style="padding: 36px 36px 20px 36px; text-align: center;">
                    <div style="display: inline-block; padding: 12px 16px; background: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 12px; margin-bottom: 12px;">
                      <span style="font-size: 20px; font-weight: 800; letter-spacing: 2px; color: #38bdf8;">🛡️ CTRL</span>
                    </div>
                    <h1 style="margin: 12px 0 6px 0; font-size: 22px; font-weight: 700; color: #ffffff;">Sign in with Magic Link</h1>
                    <p style="margin: 0; font-size: 14px; color: #94a3b8;">Access your autonomous recovery control plane</p>
                  </td>
                </tr>

                <!-- Content -->
                <tr>
                  <td style="padding: 10px 36px 30px 36px; text-align: center;">
                    <p style="font-size: 15px; line-height: 1.6; color: #cbd5e1; margin-bottom: 28px;">
                      Click the button below to securely sign in to your <strong>${businessName}</strong> merchant workspace. This link expires in 15 minutes.
                    </p>

                    <!-- CTA Button -->
                    <table border="0" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
                      <tr>
                        <td align="center" style="border-radius: 10px; background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);">
                          <a href="${magicLinkUrl}" target="_blank" style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 10px; letter-spacing: 0.3px;">
                            Sign in to Control Plane →
                          </a>
                        </td>
                      </tr>
                    </table>

                    <p style="font-size: 12px; line-height: 1.5; color: #64748b; margin-top: 28px; word-break: break-all;">
                      Or copy and paste this link into your browser:<br>
                      <a href="${magicLinkUrl}" style="color: #38bdf8; text-decoration: underline;">${magicLinkUrl}</a>
                    </p>
                  </td>
                </tr>

                <!-- Security Note / Footer -->
                <tr>
                  <td style="padding: 20px 36px; background: rgba(15, 23, 42, 0.6); border-top: 1px solid rgba(255, 255, 255, 0.06); text-align: center;">
                    <p style="margin: 0 0 6px 0; font-size: 12px; color: #64748b;">
                      If you did not request this link, you can safely ignore this email.
                    </p>
                    <p style="margin: 0; font-size: 11px; color: #475569;">
                      CTRL Control Plane • Razorpay Failed-Payment Autonomous Recovery
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  return sendEmail({
    to: recipientEmail,
    subject: `Sign in to CTRL Control Plane`,
    html,
  });
}

export interface SendOtpEmailOptions {
  to: string;
  otp: string;
  expiresInMinutes?: number;
}

/**
 * Builds HTML template for Merchant OTP Verification Code Email.
 * Compatible with Resend HTML, Webhook dispatch, and direct SMTP.
 */
export function buildOtpVerificationHtml(options: { otp: string; expiresInMinutes?: number }): string {
  const expiry = options.expiresInMinutes || 10;
  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your CTRL Verification Code</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 16px;">
          <tr>
            <td align="center">
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 500px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);">
                
                <!-- Brand Header -->
                <tr>
                  <td style="padding: 28px 32px 20px 32px; border-bottom: 1px solid #f1f5f9; text-align: left;">
                    <table border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="width: 32px; height: 32px; background: #1a73e8; border-radius: 8px; text-align: center; vertical-align: middle; color: #ffffff; font-weight: 800; font-size: 16px;">
                          U
                        </td>
                        <td style="padding-left: 12px; font-size: 17px; font-weight: 700; color: #0f172a; letter-spacing: -0.3px;">
                          CTRL
                        </td>
                        <td style="padding-left: 8px;">
                          <span style="font-size: 11px; font-weight: 600; color: #1a73e8; background: #e8f0fe; padding: 3px 8px; border-radius: 12px;">Security</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Code Body -->
                <tr>
                  <td style="padding: 32px 32px 24px 32px; text-align: left;">
                    <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 700; color: #0f172a; letter-spacing: -0.3px;">
                      Verification Code
                    </h1>
                    <p style="margin: 0 0 24px 0; font-size: 14px; color: #64748b; line-height: 1.6;">
                      Use this 6-digit one-time code to sign in to your CTRL merchant dashboard. It expires in <strong>${expiry} minutes</strong>.
                    </p>

                    <!-- Large OTP Code Container -->
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 0 0 24px 0;">
                      <tr>
                        <td align="center" style="background: #f1f5f9; border: 1.5px dashed #cbd5e1; border-radius: 12px; padding: 22px 16px;">
                          <span style="font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace; font-size: 36px; font-weight: 800; letter-spacing: 10px; color: #1a73e8; display: inline-block;">
                            ${options.otp}
                          </span>
                        </td>
                      </tr>
                    </table>

                    <!-- Security Alert Callout -->
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; padding: 12px 14px; margin-bottom: 24px;">
                      <tr>
                        <td style="font-size: 13px; color: #92400e; line-height: 1.5;">
                          🔒 <strong>Security Warning:</strong> Never share this code with anyone. CTRL support engineers will never ask for your verification code.
                        </td>
                      </tr>
                    </table>

                    <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.5;">
                      If you did not initiate this request, you can safely disregard this email. Your account remains protected.
                    </p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding: 16px 32px; background: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center;">
                    <p style="margin: 0; font-size: 11px; color: #94a3b8;">
                      CTRL Autonomous Recovery Engine • Deterministic Safety Controls
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

/**
 * Sends a 6-digit OTP verification email to the user.
 */
export async function sendOtpEmail(options: SendOtpEmailOptions) {
  const html = buildOtpVerificationHtml({ otp: options.otp, expiresInMinutes: options.expiresInMinutes });
  return sendEmail({
    to: options.to,
    subject: `${options.otp} is your CTRL verification code`,
    html,
  });
}

export interface SendSignupConfirmationOptions {
  email: string;
  businessName: string;
  userName?: string;
  loginUrl?: string;
}

/**
 * Builds HTML template for Merchant Signup Confirmation / Welcome Email.
 */
export function buildSignupConfirmationHtml(options: SendSignupConfirmationOptions): string {
  const name = options.userName || options.businessName || 'Valued Merchant';
  const loginUrl = options.loginUrl || `${process.env.APP_URL || 'http://localhost:3000'}/dashboard`;

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to CTRL</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #060b18; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f1f5f9;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #060b18; padding: 40px 20px;">
          <tr>
            <td align="center">
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 560px; background: linear-gradient(135deg, #0d1527 0%, #111a33 100%); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
                <!-- Header / Brand -->
                <tr>
                  <td style="padding: 36px 36px 20px 36px; text-align: center;">
                    <div style="display: inline-block; padding: 10px 18px; background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.35); border-radius: 12px; margin-bottom: 12px;">
                      <span style="font-size: 20px; font-weight: 800; letter-spacing: 2px; color: #38bdf8;">🛡️ CTRL</span>
                    </div>
                    <h1 style="margin: 12px 0 6px 0; font-size: 22px; font-weight: 700; color: #ffffff;">Welcome to CTRL, ${name}!</h1>
                    <p style="margin: 0; font-size: 14px; color: #94a3b8;">Your Autonomous Economic Control Plane is Ready</p>
                  </td>
                </tr>

                <!-- Content -->
                <tr>
                  <td style="padding: 10px 36px 28px 36px;">
                    <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin-bottom: 20px;">
                      Your merchant workspace for <strong>${options.businessName}</strong> has been successfully initialized. CTRL is now ready to autonomously recover failed payments on your Razorpay gateway using incremental economic reasoning.
                    </p>

                    <!-- Workspace Info Box -->
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; margin-bottom: 24px;">
                      <tr>
                        <td style="padding: 16px 20px;">
                          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #38bdf8; letter-spacing: 1px; margin-bottom: 8px;">Workspace Details</div>
                          <div style="font-size: 13px; color: #e2e8f0; margin-bottom: 4px;"><strong>Account Email:</strong> ${options.email}</div>
                          <div style="font-size: 13px; color: #e2e8f0; margin-bottom: 4px;"><strong>Merchant Tenant:</strong> ${options.businessName}</div>
                          <div style="font-size: 13px; color: #e2e8f0; margin-bottom: 4px;"><strong>Gateway:</strong> Razorpay (Test Mode)</div>
                          <div style="font-size: 13px; color: #e2e8f0;"><strong>Default Policy:</strong> Scored Allocation &bull; Deterministic Authority Gate</div>
                        </td>
                      </tr>
                    </table>

                    <!-- CTA Button -->
                    <table border="0" cellspacing="0" cellpadding="0" style="margin: 0 auto 24px auto;">
                      <tr>
                        <td align="center" style="border-radius: 10px; background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);">
                          <a href="${loginUrl}" target="_blank" style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 10px; letter-spacing: 0.3px;">
                            Launch Workspace Dashboard →
                          </a>
                        </td>
                      </tr>
                    </table>

                    <p style="font-size: 12px; line-height: 1.5; color: #64748b; margin: 0; text-align: center;">
                      Or sign in via: <a href="${loginUrl}" style="color: #38bdf8; text-decoration: underline;">${loginUrl}</a>
                    </p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding: 20px 36px; background: rgba(15, 23, 42, 0.6); border-top: 1px solid rgba(255, 255, 255, 0.06); text-align: center;">
                    <p style="margin: 0 0 6px 0; font-size: 12px; color: #64748b;">
                      This confirmation was sent because you registered an account on CTRL.
                    </p>
                    <p style="margin: 0; font-size: 11px; color: #475569;">
                      CTRL Control Plane &bull; Autonomous Economic Recovery on Razorpay
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

/**
 * Service 1: Sends Merchant Signup Confirmation / Welcome Email.
 */
export async function sendSignupConfirmationEmail(options: SendSignupConfirmationOptions) {
  const html = buildSignupConfirmationHtml(options);
  return sendEmail({
    to: options.email,
    subject: `Welcome to CTRL - Your Recovery Workspace is Active (${options.businessName})`,
    html,
  });
}

export interface SendPaymentRelinkOptions {
  to: string;
  customerName?: string;
  amountPaise: number;
  currency?: string;
  recoveryUrl: string;
  opportunityId: string;
  reasonCode?: string;
  merchantName?: string;
  tailoredMessage?: string;
  tailoredAdvice?: string;
}

// Backward-compatible alias
export type SendCustomerRecoveryEmailOptions = SendPaymentRelinkOptions;

/**
 * Builds HTML template for Customer Payment Relink Email.
 */
export function buildPaymentRelinkHtml(options: SendPaymentRelinkOptions): string {
  const amountRupees = (options.amountPaise / 100).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
  const merchant = options.merchantName || 'Our Merchant Checkout';
  const name = options.customerName || 'Valued Customer';
  const reason = options.tailoredAdvice
    ? options.tailoredAdvice
    : (options.reasonCode || 'a temporary bank network timeout').replace(/_/g, ' ').toLowerCase();

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Complete Your Payment</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #060b18; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f1f5f9;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #060b18; padding: 40px 20px;">
          <tr>
            <td align="center">
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 540px; background: #0f172a; border: 1px solid rgba(59, 130, 246, 0.25); border-radius: 16px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
                <!-- Header -->
                <tr>
                  <td style="padding: 32px 32px 16px 32px; text-align: center;">
                    <div style="display: inline-block; padding: 8px 14px; background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 10px; margin-bottom: 12px;">
                      <span style="font-size: 16px; font-weight: 800; color: #38bdf8;">🔔 Payment Incomplete</span>
                    </div>
                    <h1 style="margin: 8px 0 4px 0; font-size: 20px; font-weight: 700; color: #ffffff;">Complete your payment for ${merchant}</h1>
                    <p style="margin: 0; font-size: 13px; color: #94a3b8;">Opportunity Reference: ${options.opportunityId}</p>
                  </td>
                </tr>

                <!-- Content -->
                <tr>
                  <td style="padding: 10px 32px 28px 32px;">
                    <p style="font-size: 14px; color: #cbd5e1; line-height: 1.6; margin-bottom: 16px;">
                      Hi <strong>${name}</strong>,
                    </p>
                    <p style="font-size: 14px; color: #cbd5e1; line-height: 1.6; margin-bottom: 20px;">
                      Your payment of <strong>₹${amountRupees}</strong> for <strong>${merchant}</strong> could not be completed due to <em>${reason}</em>.
                    </p>
                    <p style="font-size: 14px; color: #cbd5e1; line-height: 1.6; margin-bottom: 24px;">
                      Your order is reserved on hold. You can securely complete your transaction with 1-click via UPI (Google Pay, PhonePe, Paytm, BHIM), NetBanking, or Cards:
                    </p>

                    <!-- CTA Button -->
                    <table border="0" cellspacing="0" cellpadding="0" style="margin: 0 auto 24px auto;">
                      <tr>
                        <td align="center" style="border-radius: 10px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);">
                          <a href="${options.recoveryUrl}" target="_blank" style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 10px;">
                            👉 Pay ₹${amountRupees} Securely →
                          </a>
                        </td>
                      </tr>
                    </table>

                    <p style="font-size: 12px; line-height: 1.5; color: #64748b; margin: 0; word-break: break-all; text-align: center;">
                      Or copy and paste this link in your browser:<br>
                      <a href="${options.recoveryUrl}" style="color: #38bdf8; text-decoration: underline;">${options.recoveryUrl}</a>
                    </p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding: 16px 32px; background: rgba(15, 23, 42, 0.8); border-top: 1px solid rgba(255, 255, 255, 0.06); text-align: center;">
                    <p style="margin: 0; font-size: 11px; color: #64748b;">
                      Verified payment link powered by Razorpay Secure Gateway & CTRL.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

/**
 * Service 2: Sends Customer Recovery Payment Relink Email.
 */
export async function sendPaymentRelinkEmail(options: SendPaymentRelinkOptions) {
  const amountRupees = (options.amountPaise / 100).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
  const merchant = options.merchantName || 'Our Merchant Checkout';
  const html = buildPaymentRelinkHtml(options);

  return sendEmail({
    to: options.to,
    subject: `Action Required: Complete your ₹${amountRupees} payment for ${merchant}`,
    html,
  });
}

/**
 * Backward-compatible alias for sendPaymentRelinkEmail
 */
export const sendCustomerRecoveryEmail = sendPaymentRelinkEmail;


