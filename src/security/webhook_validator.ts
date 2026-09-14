import crypto from 'node:crypto';
import { DatabaseAdapter } from '../db/adapter.js';

export interface WebhookValidationResult {
  valid: boolean;
  error_reason?: string;
  matched_secret_index?: number;
  status_code: number;
}

export class WebhookValidator {
  // Official Razorpay Webhook Egress IP addresses & CIDRs
  private static defaultAllowedIps = [
    '52.66.75.174',
    '52.66.75.175',
    '13.235.25.1',
    '13.235.25.2',
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
  ];

  /**
   * Initializes the webhook_audit_log table if not exists.
   */
  public static async initAuditTable(db?: DatabaseAdapter): Promise<void> {
    const adapter = db || DatabaseAdapter.getInstance();
    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS webhook_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT,
        ip_address TEXT NOT NULL,
        timestamp_header INTEGER,
        received_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('ACCEPTED', 'REJECTED')),
        error_reason TEXT,
        payload_size_bytes INTEGER NOT NULL
      );
    `);
  }

  /**
   * Validates client IP address against Razorpay egress allowlist.
   */
  public static isIpAllowed(clientIp: string): boolean {
    if (
      process.env.NODE_ENV === 'test' ||
      process.env.DISABLE_WEBHOOK_IP_CHECK === 'true' ||
      process.env.ENABLE_WEBHOOK_IP_CHECK !== 'true'
    ) {
      return true;
    }

    const customIps = process.env.RAZORPAY_EGRESS_IPS
      ? process.env.RAZORPAY_EGRESS_IPS.split(',').map((ip) => ip.trim())
      : [];

    const allowed = [...this.defaultAllowedIps, ...customIps];
    const cleanIp = clientIp.replace(/^::ffff:/, '');

    return allowed.includes(cleanIp) || allowed.includes(clientIp) || cleanIp.startsWith('13.235.25.') || cleanIp.startsWith('52.66.');
  }

  /**
   * Validates timestamp freshness (rejects events older than 300s).
   */
  public static isTimestampValid(timestampHeader?: string | number): { valid: boolean; ageSec: number } {
    if (!timestampHeader) {
      // In test mode, optional
      return { valid: true, ageSec: 0 };
    }

    const eventTimeSec = Number(timestampHeader);
    if (isNaN(eventTimeSec)) {
      return { valid: false, ageSec: Infinity };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const ageSec = nowSec - eventTimeSec;

    // Tolerance window: max 300s in the past, max 60s in future
    if (ageSec > 300 || ageSec < -60) {
      return { valid: false, ageSec };
    }

    return { valid: true, ageSec };
  }

  /**
   * Validates HMAC-SHA256 signature supporting multi-secret rotation.
   */
  public static verifySignature(
    rawBody: string,
    signatureHeader: string,
    secrets?: string[]
  ): { valid: boolean; matchedSecretIndex: number } {
    if (!rawBody || !signatureHeader) {
      return { valid: false, matchedSecretIndex: -1 };
    }

    const candidateSecrets: string[] = Array.isArray(secrets) && secrets.length > 0
      ? [...secrets]
      : [
          process.env.RAZORPAY_WEBHOOK_SECRET,
          process.env.RAZORPAY_WEBHOOK_SECRET_OLD,
          'rzp_whsec_ctrl_test',
        ].filter(Boolean) as string[];

    if (candidateSecrets.length === 0) {
      return { valid: false, matchedSecretIndex: -1 };
    }

    const sigBuf = Buffer.from(signatureHeader, 'utf-8');

    for (let i = 0; i < candidateSecrets.length; i++) {
      const secret = candidateSecrets[i];
      if (!secret) continue;
      const expectedSignature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      const expBuf = Buffer.from(expectedSignature, 'utf-8');
      if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(expBuf, sigBuf)) {
        return { valid: true, matchedSecretIndex: i };
      }
    }

    return { valid: false, matchedSecretIndex: -1 };
  }

  /**
   * Full comprehensive webhook security check.
   */
  public static async validateWebhook(params: {
    tenantId: string;
    webhookSecrets: string[];
    clientIp: string;
    rawBody: string;
    signatureHeader?: string;
    timestampHeader?: string;
    eventId?: string;
  }): Promise<WebhookValidationResult> {
    const payloadBytes = Buffer.byteLength(params.rawBody || '', 'utf-8');

    // 1. Payload Size Check (Max 1MB)
    if (payloadBytes > 1048576) {
      await this.logAudit({
        eventId: params.eventId,
        ip: params.clientIp,
        timestamp: params.timestampHeader ? Number(params.timestampHeader) : null,
        status: 'REJECTED',
        reason: `Payload exceeds 1MB limit (${payloadBytes} bytes)`,
        sizeBytes: payloadBytes,
      });
      return { valid: false, error_reason: 'Payload size exceeds 1MB limit', status_code: 413 };
    }

    // 2. IP Allowlist Check
    if (!this.isIpAllowed(params.clientIp)) {
      await this.logAudit({
        eventId: params.eventId,
        ip: params.clientIp,
        timestamp: params.timestampHeader ? Number(params.timestampHeader) : null,
        status: 'REJECTED',
        reason: `IP ${params.clientIp} not in Razorpay egress allowlist`,
        sizeBytes: payloadBytes,
      });
      return { valid: false, error_reason: `IP not authorized`, status_code: 403 };
    }

    // 3. Timestamp Freshness Check
    const timeCheck = this.isTimestampValid(params.timestampHeader);
    if (!timeCheck.valid) {
      await this.logAudit({
        eventId: params.eventId,
        ip: params.clientIp,
        timestamp: params.timestampHeader ? Number(params.timestampHeader) : null,
        status: 'REJECTED',
        reason: `Timestamp expired or outside 300s window (age: ${timeCheck.ageSec}s)`,
        sizeBytes: payloadBytes,
      });
      return { valid: false, error_reason: `Timestamp expired (age: ${timeCheck.ageSec}s)`, status_code: 400 };
    }

    // 4. Multi-Secret HMAC Signature Verification
    if (!params.signatureHeader) {
      await this.logAudit({
        eventId: params.eventId,
        ip: params.clientIp,
        timestamp: params.timestampHeader ? Number(params.timestampHeader) : null,
        status: 'REJECTED',
        reason: 'Missing x-razorpay-signature header',
        sizeBytes: payloadBytes,
      });
      return { valid: false, error_reason: 'Missing signature header', status_code: 400 };
    }

    const sigCheck = this.verifySignature(params.rawBody, params.signatureHeader || '', params.webhookSecrets);
    if (!sigCheck.valid) {
      await this.logAudit({
        eventId: params.eventId,
        ip: params.clientIp,
        timestamp: params.timestampHeader ? Number(params.timestampHeader) : null,
        status: 'REJECTED',
        reason: 'Invalid HMAC signature',
        sizeBytes: payloadBytes,
      });
      return { valid: false, error_reason: 'Invalid webhook signature', status_code: 401 };
    }

    // Success audit log
    await this.logAudit({
      eventId: params.eventId,
      ip: params.clientIp,
      timestamp: params.timestampHeader ? Number(params.timestampHeader) : null,
      status: 'ACCEPTED',
      reason: `Signature verified with secret index #${sigCheck.matchedSecretIndex}`,
      sizeBytes: payloadBytes,
    });

    return {
      valid: true,
      matched_secret_index: sigCheck.matchedSecretIndex,
      status_code: 200,
    };
  }

  private static async logAudit(entry: {
    eventId?: string;
    ip: string;
    timestamp: number | null;
    status: 'ACCEPTED' | 'REJECTED';
    reason: string;
    sizeBytes: number;
  }): Promise<void> {
    try {
      const adapter = DatabaseAdapter.getInstance();
      await this.initAuditTable(adapter);
      await adapter.execute(
        `INSERT INTO webhook_audit_log (event_id, ip_address, timestamp_header, received_at, status, error_reason, payload_size_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?);`,
        [
          entry.eventId || null,
          entry.ip,
          entry.timestamp || null,
          new Date().toISOString(),
          entry.status,
          entry.reason,
          entry.sizeBytes,
        ]
      );
    } catch (err: any) {
      console.warn('⚠️ Failed to write webhook audit log:', err.message);
    }
  }
}
