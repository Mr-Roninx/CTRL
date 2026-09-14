import Razorpay from 'razorpay';
import dotenv from 'dotenv';
import path from 'node:path';
import {
  db,
  getOpportunityById,
  getCustomerById,
  getScoreByOpportunityId,
  getAllocationDecisionByOpportunityId,
  getExecutionRecordByOpportunityId,
  upsertExecutionRecord,
  updateOpportunityStatus,
  insertLedgerEntry,
  insertNotification,
  getOutreachDraftsByOpportunityId,
  getPerceptionAnnotationByOpportunityId,
} from '../db/database.js';
import { scoreOpportunity } from '../economics/scorer.js';
import { evaluateOpportunity, runAuthorityPipeline } from '../authority/gate.js';
import { ExecutionRecord, RecoveryOpportunity } from '../types/index.js';
import { CircuitBreaker } from './circuit_breaker.js';
import { ExecutionDLQ } from './dlq.js';
import { RazorpayClientPool } from '../providers/razorpay/client_pool.js';
import { sendWhatsAppRecoveryNotification } from '../notifications/whatsapp.js';
import { sendCustomerRecoveryEmail } from '../notifications/email.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Backward-compatible fallback client for system-default tenant / local dev
function createDefaultRazorpayClient(): Razorpay {
  const key_id = process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder';
  const key_secret = process.env.RAZORPAY_KEY_SECRET || 'placeholder_secret';
  try {
    return new Razorpay({ key_id, key_secret });
  } catch (err: any) {
    return new Razorpay({ key_id: 'rzp_test_placeholder', key_secret: 'placeholder_secret' });
  }
}

export const rzpClient = createDefaultRazorpayClient();

export interface SingleExecutionResult {
  opportunity_id: string;
  success: boolean;
  created_new: boolean;
  test_mode_fallback?: boolean;
  record?: ExecutionRecord;
  error?: string;
}

export interface BatchExecutionResult {
  max_links_cap: number;
  total_authorized: number;
  executed_count: number;
  skipped_count: number;
  failed_count: number;
  results: SingleExecutionResult[];
}

/**
 * Creates a real Razorpay payment link for an AUTHORIZED opportunity with strict compliance checks and idempotency.
 */
export async function executeOpportunity(opportunityId: string): Promise<SingleExecutionResult> {
  const opp = getOpportunityById(opportunityId);
  if (!opp) {
    throw new Error(`Opportunity not found: ${opportunityId}`);
  }

  // 1. Zero-Bypass Authority Check: Explicit assertion of AUTHORIZED status
  let score = getScoreByOpportunityId(opp.id);
  if (!score) score = scoreOpportunity(opp);

  let decision = getAllocationDecisionByOpportunityId(opp.id);
  if (!decision) {
    decision = {
      opportunity_id: opp.id,
      decision: 'WAIT',
      rank_in_batch: 999,
      shadow_price_paise_at_decision: 0,
      reason: 'Unallocated execution attempt',
    };
  }

  const evalResult = evaluateOpportunity(opp, decision, score);
  if (evalResult.verdict !== 'AUTHORIZED') {
    throw new Error(
      `Compliance Violation: Opportunity ${opp.id} is not AUTHORIZED (verdict: ${evalResult.verdict}, reason: "${evalResult.summary_reason}"). Real payment link creation strictly rejected.`
    );
  }

  // 2. Idempotency Check: Local SQLite lookup by opportunity_id
  const existingRecord = getExecutionRecordByOpportunityId(opp.id);
  if (existingRecord) {
    if (opp.status !== 'recovered') {
      updateOpportunityStatus(opp.id, 'executing');
    }
    return {
      opportunity_id: opp.id,
      success: true,
      created_new: false,
      record: existingRecord,
    };
  }

  // 3. Call Razorpay API — dynamically resolve client for tenant's active environment ('live' vs 'test')
  const tenantId = opp.tenant_id;
  let executionEnv: 'test' | 'live' = opp.environment;
  try {
    const tenantRow = db.prepare('SELECT environment FROM tenants WHERE id = ? LIMIT 1;').get(tenantId) as any;
    if (tenantRow?.environment === 'live' || opp.environment === 'live') {
      executionEnv = 'live';
    }
  } catch {}

  let tenantClient: Razorpay;
  try {
    tenantClient = await RazorpayClientPool.getClient(tenantId, executionEnv);
  } catch (err: any) {
    if (executionEnv === 'live') {
      throw new Error(`Production Execution Blocked: ${err.message}`);
    }
    tenantClient = rzpClient;
  }

  // 4. Production Live Money Safety Ceilings (Phase 1 Pilot: Max ₹50,000/link)
  const MAX_LIVE_SINGLE_OPPORTUNITY_PAISE = 5000000;
  if (executionEnv === 'live' && opp.amount_paise > MAX_LIVE_SINGLE_OPPORTUNITY_PAISE) {
    throw new Error(
      `Financial Safety Ceiling Exceeded: Opportunity ${opp.id} amount (₹${(opp.amount_paise / 100).toFixed(2)}) exceeds maximum live safety limit of ₹50,000.00. Automatic recovery blocked.`
    );
  }

  try {
    const circuitBreaker = CircuitBreaker.getInstance();

    // Resolve customer details from direct identifiers, raw payload, or customer profile
    let payloadRef: any = {};
    try {
      if (opp.raw_payload_ref) {
        payloadRef = JSON.parse(opp.raw_payload_ref);
      }
    } catch {}

    const customerRecord = opp.customer_id ? getCustomerById(opp.customer_id) : undefined;
    const customerEmail =
      (opp.customer_id && opp.customer_id.includes('@') ? opp.customer_id : undefined) ||
      payloadRef?.email ||
      payloadRef?.notes?.email ||
      (customerRecord as any)?.email;
    const customerContact =
      (opp.customer_id && (opp.customer_id.startsWith('+') || /^\d{10,12}$/.test(opp.customer_id)) ? opp.customer_id : undefined) ||
      payloadRef?.contact ||
      payloadRef?.phone ||
      payloadRef?.notes?.phone ||
      payloadRef?.notes?.contact ||
      (customerRecord as any)?.phone;
    const customerName =
      (customerRecord as any)?.name ||
      payloadRef?.name ||
      payloadRef?.notes?.name ||
      (customerEmail ? customerEmail.split('@')[0] : opp.customer_id);

    const rzpResponse: any = await circuitBreaker.executeWithResilience(
      async () => {
        return tenantClient.paymentLink.create({
          amount: opp.amount_paise,
          currency: opp.currency || 'INR',
          accept_partial: false,
          reference_id: opp.id,
          description: `CTRL automated recovery for opportunity ${opp.id}`,
          customer: {
            name: customerName,
            email: customerEmail,
            contact: customerContact,
          },
          notify: {
            sms: Boolean(customerContact),
            email: Boolean(customerEmail),
          },
          reminder_enable: true,
          notes: {
            opportunity_id: opp.id,
            source: opp.source,
            reason_code: opp.reason_code,
            system: 'CTRL Economic Recovery Control Plane',
          },
        });
      },
      `RazorpayPaymentLinkCreate(${opp.id})`
    );

    const now = new Date().toISOString();
    const linkUrl = rzpResponse.short_url || `https://rzp.io/i/${rzpResponse.id}`;

    const executionRecord: ExecutionRecord = {
      opportunity_id: opp.id,
      razorpay_payment_link_id: rzpResponse.id,
      link_url: linkUrl,
      status: rzpResponse.status || 'created',
      idempotency_key: `ref_${opp.id}`,
      created_at: now,
    };

    // Store in SQLite execution_records
    upsertExecutionRecord(executionRecord);

    // Update opportunity status to executing
    updateOpportunityStatus(opp.id, 'executing');

    // Audit trail in ledger
    insertLedgerEntry({
      id: `led_exec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      opportunity_id: opp.id,
      event_type: 'reconciled',
      amount_paise: opp.amount_paise,
      timestamp: now,
      raw_payload_ref: JSON.stringify({
        razorpay_payment_link_id: rzpResponse.id,
        short_url: linkUrl,
        amount_paise: opp.amount_paise,
      }),
    });

    // Notification in-app
    insertNotification({
      id: `notif_link_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      tenant_id: tenantId,
      type: 'LINK_CREATED',
      title: 'Payment Link Created',
      message: `Recovery link created for opportunity ${opp.id} (₹${(opp.amount_paise / 100).toFixed(2)})`,
      link_url: '/dashboard',
      created_at: now,
    });

    // Omnichannel Customer Recovery: Dispatch via WhatsApp & Email asynchronously
    setImmediate(async () => {
      let tailoredMsg: string | undefined = undefined;
      let tailoredAdvice: string | undefined = undefined;

      try {
        const drafts = getOutreachDraftsByOpportunityId(opp.id);
        if (drafts && drafts.length > 0 && drafts[0]?.body) {
          tailoredMsg = drafts[0].body;
        }
        const perception = getPerceptionAnnotationByOpportunityId(opp.id);
        if (perception?.semantic_notes) {
          const match = perception.semantic_notes.match(/\[Explanation:\s*([^\]]+)\]/);
          if (match && match[1]) tailoredAdvice = match[1].trim();
        }
      } catch {}

      if (customerContact) {
        try {
          await sendWhatsAppRecoveryNotification({
            to: customerContact,
            customerName,
            amountPaise: opp.amount_paise,
            currency: opp.currency || 'INR',
            recoveryUrl: linkUrl,
            opportunityId: opp.id,
            reasonCode: opp.reason_code,
            tenantId,
            tailoredMessage: tailoredMsg,
          });
        } catch (waErr: any) {
          console.warn(`[WhatsApp Delivery Warning] Could not dispatch to ${customerContact}:`, waErr.message);
        }
      }

      if (customerEmail) {
        try {
          await sendCustomerRecoveryEmail({
            to: customerEmail,
            customerName,
            amountPaise: opp.amount_paise,
            currency: opp.currency || 'INR',
            recoveryUrl: linkUrl,
            opportunityId: opp.id,
            reasonCode: opp.reason_code,
            tailoredMessage: tailoredMsg,
            tailoredAdvice,
          });
        } catch (mailErr: any) {
          console.warn(`[Email Delivery Warning] Could not dispatch to ${customerEmail}:`, mailErr.message);
        }
      }
    });

    return {
      opportunity_id: opp.id,
      success: true,
      created_new: true,
      record: executionRecord,
    };
  } catch (error: any) {
    const errorDesc = error?.error?.description || error?.message || '';

    // Handle remote idempotency conflict if link already exists in Razorpay
    if (errorDesc.includes('already exists') || errorDesc.includes('reference_id')) {
      try {
        const existingList: any = await (tenantClient.paymentLink as any).all({ reference_id: opp.id });
        const existingPlink = existingList?.payment_links?.[0];
        if (existingPlink) {
          const now = new Date().toISOString();
          const linkUrl = existingPlink.short_url || `https://rzp.io/i/${existingPlink.id}`;
          const executionRecord: ExecutionRecord = {
            opportunity_id: opp.id,
            razorpay_payment_link_id: existingPlink.id,
            link_url: linkUrl,
            status: existingPlink.status || 'created',
            idempotency_key: `ref_${opp.id}`,
            created_at: now,
          };

          upsertExecutionRecord(executionRecord);
          updateOpportunityStatus(opp.id, 'executing');

          return {
            opportunity_id: opp.id,
            success: true,
            created_new: false,
            record: executionRecord,
          };
        }
      } catch (e) {
        // fall through
      }
    }

    let userFacingError = error?.error?.description || error?.message || 'Razorpay API execution failed';
    if (userFacingError.includes('auth') || userFacingError.includes('key_id') || userFacingError.includes('Unauthorized') || error?.statusCode === 401) {
      userFacingError = 'Razorpay credentials unauthorized or missing. Please configure valid Test Mode Key ID & Secret in Settings > Integrations.';
    }

    // Handle Test Mode rate limit / sandbox quota / circuit breaker in Test Mode
    // NOTE: Returns test_mode_fallback: true with isolated simulated link metadata
    if (executionEnv === 'test') {
      console.warn(`⚠️ [TEST_MODE_FALLBACK] Razorpay API failed for ${opp.id}: ${userFacingError}. Using isolated simulated payment link.`);
      const mockPlinkId = `plink_test_${opp.id.replace(/[^a-zA-Z0-9]/g, '').slice(-12)}`;
      const linkUrl = `https://rzp.io/i/${mockPlinkId}`;
      const linkStatus = 'simulated';

      const now = new Date().toISOString();
      const executionRecord: ExecutionRecord = {
        opportunity_id: opp.id,
        razorpay_payment_link_id: mockPlinkId,
        link_url: linkUrl,
        status: linkStatus,
        idempotency_key: `ref_${opp.id}`,
        created_at: now,
      };

      upsertExecutionRecord(executionRecord);
      updateOpportunityStatus(opp.id, 'executing');

      insertLedgerEntry({
        id: `led_exec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        opportunity_id: opp.id,
        event_type: 'reconciled',
        amount_paise: opp.amount_paise,
        timestamp: now,
        raw_payload_ref: JSON.stringify({
          razorpay_payment_link_id: mockPlinkId,
          short_url: linkUrl,
          amount_paise: opp.amount_paise,
          test_mode_fallback: true,
          simulated: true,
          original_error: userFacingError,
        }),
      });

      insertNotification({
        id: `notif_link_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        tenant_id: tenantId,
        type: 'LINK_CREATED',
        title: 'Simulated Payment Link (Razorpay API Unavailable)',
        message: `Simulated recovery link for opportunity ${opp.id} (₹${(opp.amount_paise / 100).toFixed(2)}) — Razorpay API was unavailable in test mode`,
        link_url: '/dashboard',
        created_at: now,
      });

      return {
        opportunity_id: opp.id,
        success: true,
        created_new: true,
        test_mode_fallback: true,
        record: executionRecord,
      };
    }

    // Record failure in Dead Letter Queue for live production
    await ExecutionDLQ.recordExecutionFailure(opp.id, userFacingError);

    return {
      opportunity_id: opp.id,
      success: false,
      created_new: false,
      error: userFacingError,
    };
  }
}

/**
 * Executes payment link creation for all currently AUTHORIZED opportunities up to capacity cap (default 5).
 */
export async function executeAuthorizedBatch(
  options: { maxLinks?: number; capacity?: number; tenantId?: string; environment?: 'test' | 'live' } = {}
): Promise<BatchExecutionResult> {
  const maxLinks = options.maxLinks || Number(process.env.MAX_LINKS_PER_RUN) || 5;

  let env = options.environment;
  if (!env && options.tenantId) {
    try {
      const stmt = db.prepare('SELECT environment FROM tenants WHERE id = ? LIMIT 1;');
      const row = stmt.get(options.tenantId) as { environment?: 'test' | 'live' } | undefined;
      if (row?.environment) env = row.environment;
    } catch { /* fallthrough */ }
  }

  // 1. Run Authority Pipeline scoped to tenant & environment to get up-to-date compliance verdicts
  const authorityRun = runAuthorityPipeline({ capacity: options.capacity || maxLinks, tenantId: options.tenantId, environment: env });
  const authorizedOpps = authorityRun.results.filter((r) => r.verdict === 'AUTHORIZED');

  const executionResults: SingleExecutionResult[] = [];
  let executed_count = 0;
  let skipped_count = 0;
  let failed_count = 0;

  // 2. Process up to maxLinks cap
  const targetBatch = authorizedOpps.slice(0, maxLinks);

  for (const item of targetBatch) {
    try {
      const res = await executeOpportunity(item.opportunity_id);
      executionResults.push(res);
      if (res.success) {
        executed_count++;
      } else {
        failed_count++;
      }
    } catch (err: any) {
      failed_count++;
      executionResults.push({
        opportunity_id: item.opportunity_id,
        success: false,
        created_new: false,
        error: err?.message || 'Execution error',
      });
    }
  }

  skipped_count = Math.max(0, authorizedOpps.length - targetBatch.length);

  return {
    max_links_cap: maxLinks,
    total_authorized: authorizedOpps.length,
    executed_count,
    skipped_count,
    failed_count,
    results: executionResults,
  };
}
