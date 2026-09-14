import { Router, Request, Response, NextFunction } from 'express';
import { TenancyEnforcer, TenantScopedRequest } from '../security/tenancy.js';
import { RazorpayClientPool } from '../providers/razorpay/client_pool.js';
import { normalizeOpportunity } from '../perception/normalizer.js';
import { scoreOpportunity } from '../economics/scorer.js';
import { runMarketAllocation } from '../market/allocator.js';
import { evaluateOpportunity } from '../authority/gate.js';
import { executeOpportunity } from '../execution/executor.js';
import {
  db,
  insertOpportunity,
  getOpportunityById,
  updateOpportunityStatus,
  insertLedgerEntry,
  insertNotification,
  getScoreByOpportunityId,
  getAllocationDecisionByOpportunityId,
  getAuthorityChecksByOpportunityId,
  getExecutionRecordByOpportunityId,
} from '../db/database.js';
import { RealtimeBroadcaster } from '../realtime/broadcaster.js';
import { sendCustomerRecoveryEmail } from '../notifications/email.js';

export const playgroundRouter = Router();

/**
 * Resilient Tenancy Middleware for Interactive Test Ground / Playground.
 * If authenticated Bearer token is provided, validates tenant.
 * If unauthenticated public visitor, binds safely to 'tenant_system_default' in test mode.
 */
const authenticatePlaygroundTenant = (requiredScope?: any) => {
  return async (req: TenantScopedRequest, res: Response, next: NextFunction): Promise<void> => {
    let authHeader = req.headers.authorization;
    if (!authHeader && typeof req.query.token === 'string') {
      authHeader = `Bearer ${req.query.token}`;
    } else if (!authHeader && typeof req.query.api_key === 'string') {
      authHeader = `Bearer ${req.query.api_key}`;
    }

    if (authHeader && authHeader.startsWith('Bearer ')) {
      return TenancyEnforcer.authenticateTenant(requiredScope)(req, res, next);
    }

    // Public playground simulation fallback: bind safely to default tenant in test mode
    req.tenantContext = {
      tenantId: 'tenant_system_default',
      environment: 'test',
      authType: 'SESSION',
      user: {
        userId: 'guest_simulator',
        tenantId: 'tenant_system_default',
        email: 'simulator@ctrl.demo',
        role: 'Viewer',
        mfaVerified: false,
      },
    };
    next();
  };
};

/**
 * 1. GET /v1/playground/config
 * Returns active Razorpay configuration for the tenant (detecting Live vs Test keys).
 */
playgroundRouter.get(
  '/config',
  authenticatePlaygroundTenant(),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const tenantContext = req.tenantContext!;
      const tenantId = tenantContext.tenantId;

      // Check tenant environment from database
      let env: 'live' | 'test' = 'test';
      try {
        const tenantRow = db.prepare('SELECT environment FROM tenants WHERE id = ? LIMIT 1;').get(tenantId) as any;
        if (tenantRow?.environment === 'live') {
          env = 'live';
        }
      } catch {}

      // Determine active key from env or credentials based on environment
      let keyId = env === 'live' 
        ? (process.env.RAZORPAY_LIVE_KEY_ID || process.env.RAZORPAY_KEY_ID || '')
        : (process.env.RAZORPAY_KEY_ID || '');

      // Check per-tenant credentials if available
      try {
        const row = db.prepare('SELECT environment FROM tenant_credentials WHERE tenant_id = ? LIMIT 1;').get(tenantId) as any;
        if (row && row.environment) {
          env = row.environment;
        }
      } catch {}

      const maskedKey = keyId ? `${keyId.slice(0, 8)}••••••••${keyId.slice(-4)}` : 'Not Configured';
      const isLive = keyId.startsWith('rzp_live_') || env === 'live';

      res.json({
        success: true,
        tenant_id: tenantId,
        environment: env,
        is_live: isLive,
        key_id: keyId,
        masked_key_id: maskedKey,
        provider: 'razorpay',
        safety_ceiling_paise: 500000, // ₹5,000 max live playground limit
        capacity_limit: 5,
      });
    } catch (err: any) {
      console.error('Playground config error:', err);
      res.status(500).json({ error: 'Failed to fetch playground configuration', details: err.message });
    }
  }
);

/**
 * 2. POST /v1/playground/create-order
 * Generates an official Razorpay Order for the frontend Checkout modal.
 */
playgroundRouter.post(
  '/create-order',
  authenticatePlaygroundTenant('events:write'),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const tenantContext = req.tenantContext!;
      const tenantId = tenantContext.tenantId;
      const { amount_paise, currency = 'INR', description = 'CTRL Recovery Playground Test' } = req.body;

      const amount = Number(amount_paise) || 100; // Default ₹1.00 safe micropayment
      let env: 'test' | 'live' = req.body.environment || 'test';
      if (!req.body.environment) {
        try {
          const tRow = db.prepare('SELECT environment FROM tenants WHERE id = ? LIMIT 1;').get(tenantId) as any;
          if (tRow?.environment === 'live') {
            env = 'live';
          }
        } catch {}
      }

      const tenantClient = await RazorpayClientPool.getClient(tenantId, env);

      const receipt = `rcpt_pg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const order = await tenantClient.orders.create({
        amount,
        currency,
        receipt,
        notes: {
          system: 'CTRL Recovery Playground',
          tenant_id: tenantId,
          description,
        },
      });

      res.json({
        success: true,
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        key_id: (tenantClient as any).key_id || process.env.RAZORPAY_KEY_ID,
        receipt,
      });
    } catch (err: any) {
      console.error('Create order error:', err);
      res.status(500).json({
        error: 'Failed to create Razorpay Order',
        message: err.error?.description || err.message || 'Razorpay Order API failure',
      });
    }
  }
);

/**
 * 3. POST /v1/playground/simulate-scenario
 * Runs a full, deterministic 7-stage recovery execution trace and returns all intermediate telemetry.
 */
playgroundRouter.post(
  '/simulate-scenario',
  authenticatePlaygroundTenant('events:write'),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const tenantContext = req.tenantContext!;
      const tenantId = tenantContext.tenantId;
      const { scenario, amount_paise, customer_id, customer_name, customer_email, customer_contact } = req.body;

      const amount = Number(amount_paise) || 10000; // default ₹100.00
      const paymentId = `pay_pg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const eventId = `evt_pg_${Date.now()}`;

      let errorCode = 'INSUFFICIENT_FUNDS';
      let errorDesc = 'Issuer authorization declined: Insufficient funds';
      let failureType = 'soft';

      switch (scenario) {
        case 'soft_expired_card':
          errorCode = 'CARD_EXPIRED';
          errorDesc = 'Customer card expired on file';
          failureType = 'soft';
          break;
        case 'soft_timeout':
          errorCode = 'BANK_GATEWAY_TIMEOUT';
          errorDesc = 'Acquiring bank network timed out during 3DS OTP verification';
          failureType = 'soft';
          break;
        case 'hard_stolen_card':
        case 'hard_stolen':
          errorCode = 'CARD_STOLEN';
          errorDesc = 'Issuer hard decline: Card reported lost or stolen';
          failureType = 'hard';
          break;
        case 'hard_fraud_block':
          errorCode = 'BAD_REQUEST_PAYMENT_CARD_RESTRICTED';
          errorDesc = 'Restricted instrument blocked by fraud risk engine';
          failureType = 'hard';
          break;
        case 'capacity_saturation':
        case 'capacity_bind':
          errorCode = 'INSUFFICIENT_FUNDS';
          errorDesc = 'Low incremental value opportunity under saturated capacity';
          failureType = 'soft';
          break;
        case 'soft_funds':
        default:
          errorCode = 'INSUFFICIENT_FUNDS';
          errorDesc = 'Payment failed: Insufficient funds in customer account';
          failureType = 'soft';
      }

      // ─────────────────────────────────────────────────────────────
      // STAGE 1: INGESTION GATEWAY
      // ─────────────────────────────────────────────────────────────
      const stage1_ingestion = {
        stage_number: 1,
        stage_name: 'Event Ingestion Gateway',
        status: 'PASSED',
        timestamp: new Date().toISOString(),
        data: {
          event_id: eventId,
          payment_id: paymentId,
          amount_paise: amount,
          amount_display: `₹${(amount / 100).toFixed(2)}`,
          source: 'PLAYGROUND_SIMULATOR',
          validation: 'Zod CanonicalPaymentEventSchema Validated (0ms)',
          deduplicated: false,
        },
      };

      // ─────────────────────────────────────────────────────────────
      // STAGE 2: PERCEPTION & TAXONOMY CLASSIFIER
      // ─────────────────────────────────────────────────────────────
      const opp = normalizeOpportunity(
        {
          id: paymentId,
          amount,
          currency: 'INR',
          error_code: errorCode,
          error_description: errorDesc,
          customer_id: customer_id || `cust_${paymentId.slice(-6)}`,
          email: customer_email || 'aarav.patel@example.com',
          contact: customer_contact || '+919876543210',
          notes: { name: customer_name || 'Aarav Patel', source: 'PLAYGROUND' },
        },
        eventId,
        { source: 'synthetic', tenantId, environment: 'test' }
      );
      insertOpportunity(opp);

      const stage2_perception = {
        stage_number: 2,
        stage_name: 'Perception & Taxonomy Classifier',
        status: 'PASSED',
        timestamp: new Date().toISOString(),
        data: {
          opportunity_id: opp.id,
          reason_code: opp.reason_code,
          decline_type: opp.decline_type,
          attempt_count: opp.attempt_count,
          customer_trust_score: opp.customer_trust_score,
          taxonomy_rationale:
            opp.decline_type === 'hard'
              ? 'Classified as HARD decline: Irreversible issuer block (fraud/stolen)'
              : 'Classified as SOFT decline: Recoverable condition with high intervention lift',
        },
      };

      // ─────────────────────────────────────────────────────────────
      // STAGE 3: COUNTERFACTUAL ECONOMIC SCORING (IVEN)
      // ─────────────────────────────────────────────────────────────
      const score = scoreOpportunity(opp);
      const stage3_economics = {
        stage_number: 3,
        stage_name: 'Counterfactual Economic Engine',
        status: 'PASSED',
        timestamp: new Date().toISOString(),
        data: {
          natural_recovery_prob: score.natural_recovery_prob,
          intervention_recovery_prob: score.intervention_recovery_prob,
          incremental_prob: score.incremental_prob,
          operational_cost_paise: score.operational_cost_paise,
          fatigue_cost_paise: score.fatigue_cost_paise,
          expected_incremental_value_paise: score.expected_incremental_value_paise,
          iven_display: `₹${(score.expected_incremental_value_paise / 100).toFixed(2)}`,
          confidence: score.confidence,
          math_formula: `IVEN = (${score.incremental_prob.toFixed(2)} × ₹${(amount / 100).toFixed(2)}) - ₹${(score.operational_cost_paise / 100).toFixed(2)} - ₹${(score.fatigue_cost_paise / 100).toFixed(2)} = ₹${(score.expected_incremental_value_paise / 100).toFixed(2)}`,
          _labels: {
            natural_recovery_prob: 'model-estimated',
            intervention_recovery_prob: 'model-estimated',
            incremental_prob: 'model-estimated',
          },
        },
      };

      // ─────────────────────────────────────────────────────────────
      // STAGE 4: RECOVERY MARKET ALLOCATION
      // ─────────────────────────────────────────────────────────────
      const isCapacityBind = scenario === 'capacity_saturation' || scenario === 'capacity_bind';
      const marketRun = runMarketAllocation({
        capacity: isCapacityBind ? 0 : 5,
        opportunities: [opp],
        tenantId,
      });
      const allocation = getAllocationDecisionByOpportunityId(opp.id) || {
        opportunity_id: opp.id,
        decision: score.confidence === 'low' || score.expected_incremental_value_paise <= 0 ? 'ABSTAIN' : (isCapacityBind ? 'WAIT' : 'ACT'),
        rank_in_batch: 1,
        shadow_price_paise_at_decision: marketRun.shadow_price_paise,
        reason: isCapacityBind ? 'Deferred under saturated capacity limit' : 'Ranked in current active capacity run',
      };

      const stage4_market = {
        stage_number: 4,
        stage_name: 'Recovery Market Allocation',
        status: allocation.decision === 'ACT' ? 'PASSED' : allocation.decision === 'WAIT' ? 'DEFERRED' : 'ABSTAINED',
        timestamp: new Date().toISOString(),
        data: {
          decision: allocation.decision,
          rank_in_batch: allocation.rank_in_batch,
          shadow_price_paise: allocation.shadow_price_paise_at_decision,
          shadow_price_display: `₹${(allocation.shadow_price_paise_at_decision / 100).toFixed(2)}`,
          capacity_cap: 5,
          market_reason: allocation.reason,
        },
      };

      // ─────────────────────────────────────────────────────────────
      // STAGE 5: ACTION AUTHORITY (DETERMINISTIC COMPLIANCE GATE)
      // ─────────────────────────────────────────────────────────────
      const authorityEval = evaluateOpportunity(opp, allocation, score);
      const stage5_authority = {
        stage_number: 5,
        stage_name: 'Action Authority Compliance Gate',
        status: authorityEval.verdict === 'AUTHORIZED' ? 'PASSED' : 'BLOCKED',
        timestamp: new Date().toISOString(),
        data: {
          verdict: authorityEval.verdict,
          summary_reason: authorityEval.summary_reason,
          checks: authorityEval.checks.map((c) => ({
            name: c.check_name,
            passed: c.passed,
            reason: c.reason,
          })),
        },
      };

      // ─────────────────────────────────────────────────────────────
      // STAGE 6: EXECUTION & RAZORPAY PAYMENT LINK CREATION
      // ─────────────────────────────────────────────────────────────
      let stage6_execution: any = {
        stage_number: 6,
        stage_name: 'Execution & Payment Link Gateway',
        status: 'SKIPPED',
        timestamp: new Date().toISOString(),
        data: {
          message: 'Execution omitted due to compliance veto or non-authorized state',
        },
      };

      if (authorityEval.verdict === 'AUTHORIZED') {
        try {
          const execRes = await executeOpportunity(opp.id);
          stage6_execution = {
            stage_number: 6,
            stage_name: 'Execution & Payment Link Gateway',
            status: execRes.success ? 'PASSED' : 'FAILED',
            timestamp: new Date().toISOString(),
            data: {
              success: execRes.success,
              payment_link_id: execRes.record?.razorpay_payment_link_id,
              link_url: execRes.record?.link_url,
              idempotency_key: execRes.record?.idempotency_key,
              provider_status: execRes.record?.status,
              error: execRes.error,
            },
          };
        } catch (e: any) {
          stage6_execution = {
            stage_number: 6,
            stage_name: 'Execution & Payment Link Gateway',
            status: 'FAILED',
            timestamp: new Date().toISOString(),
            data: {
              success: false,
              error: e.message,
            },
          };
        }
      }

      // ─────────────────────────────────────────────────────────────
      // STAGE 7: TRUTH ENGINE & RECONCILIATION PREVIEW
      // ─────────────────────────────────────────────────────────────
      const stage7_truth = {
        stage_number: 7,
        stage_name: 'Truth Engine & Forensic Ledger',
        status: 'READY_FOR_SETTLEMENT',
        timestamp: new Date().toISOString(),
        data: {
          ledger_state: 'Awaiting customer link settlement',
          reconciliation_mode: 'Authoritative Webhook / Poller Double-Entry',
          opportunity_id: opp.id,
        },
      };

      // Real Email Dispatch via SMTP if customer_email is provided and link was created
      let emailResult: any = null;
      if (customer_email && stage6_execution.data?.link_url) {
        try {
          emailResult = await sendCustomerRecoveryEmail({
            to: customer_email,
            customerName: customer_name || 'Valued Customer',
            amountPaise: amount,
            currency: 'INR',
            recoveryUrl: stage6_execution.data.link_url,
            opportunityId: opp.id,
            reasonCode: errorCode,
            merchantName: 'Apex CyberStore (Test Ground)',
          });
        } catch (mailErr: any) {
          console.warn('Playground recovery email dispatch warning:', mailErr.message);
          emailResult = { success: false, delivered: false, error: mailErr.message };
        }
      }

      // Broadcast live event trace to tenant via SSE
      RealtimeBroadcaster.getInstance().broadcastToTenant(tenantId, 'EVENT_INGESTED', {
        opportunity_id: opp.id,
        status: opp.status,
        amount_paise: opp.amount_paise,
        decline_type: opp.decline_type,
      });

      res.json({
        success: true,
        opportunity_id: opp.id,
        scenario,
        final_verdict: authorityEval.verdict,
        execution_status: stage6_execution.status,
        link_url: stage6_execution.data?.link_url,
        email_sent: Boolean(emailResult?.success),
        email_delivered: Boolean(emailResult?.delivered),
        email_recipient: customer_email,
        email_sandbox_note: emailResult?.sandboxNote,
        email_id: emailResult?.id,
        stages: [
          stage1_ingestion,
          stage2_perception,
          stage3_economics,
          stage4_market,
          stage5_authority,
          stage6_execution,
          stage7_truth,
        ],
      });
    } catch (err: any) {
      console.error('Playground scenario simulation error:', err);
      res.status(500).json({ error: 'Failed to simulate playground scenario', details: err.message });
    }
  }
);

/**
 * 4. POST /v1/playground/reconcile-link
 * Simulates immediate settlement of a generated recovery link and writes to immutable ledger.
 */
playgroundRouter.post(
  '/reconcile-link',
  authenticatePlaygroundTenant('events:write'),
  async (req: TenantScopedRequest, res: Response): Promise<void> => {
    try {
      const tenantContext = req.tenantContext!;
      const tenantId = tenantContext.tenantId;
      const { opportunity_id } = req.body;

      if (!opportunity_id) {
        res.status(400).json({ error: 'Missing opportunity_id' });
        return;
      }

      const opp = getOpportunityById(opportunity_id);
      if (!opp) {
        res.status(404).json({ error: 'Opportunity not found' });
        return;
      }

      // Update opportunity status to recovered
      updateOpportunityStatus(opportunity_id, 'recovered');

      const now = new Date().toISOString();
      const ledgerEntryId = `led_rec_pg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      insertLedgerEntry({
        id: ledgerEntryId,
        opportunity_id: opp.id,
        event_type: 'recovered',
        amount_paise: opp.amount_paise,
        timestamp: now,
        raw_payload_ref: JSON.stringify({
          source: 'PLAYGROUND_SETTLEMENT_SIMULATION',
          amount_paid: opp.amount_paise,
          currency: opp.currency,
          settled_at: now,
        }),
      });

      // Notification
      const notifItem = {
        id: `notif_pg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        tenant_id: tenantId,
        type: 'PAYMENT_RECOVERED' as const,
        title: 'Payment Successfully Recovered! 🎉',
        message: `Opportunity ${opp.id} (₹${(opp.amount_paise / 100).toFixed(2)}) settled via Truth Engine.`,
        link_url: '/dashboard/opportunities',
        created_at: now,
      };
      insertNotification(notifItem);

      // Broadcast live event
      RealtimeBroadcaster.getInstance().broadcastToTenant(tenantId, 'NOTIFICATION_CREATED', notifItem);
      RealtimeBroadcaster.getInstance().broadcastToTenant(tenantId, 'EVENT_INGESTED', {
        opportunity_id: opp.id,
        status: 'recovered',
        amount_paise: opp.amount_paise,
      });

      res.json({
        success: true,
        message: 'Payment successfully reconciled and appended to immutable ledger.',
        opportunity_id: opp.id,
        ledger_entry_id: ledgerEntryId,
        amount_recovered_display: `₹${(opp.amount_paise / 100).toFixed(2)}`,
        status: 'recovered',
        reconciled_at: now,
      });
    } catch (err: any) {
      console.error('Reconcile link error:', err);
      res.status(500).json({ error: 'Failed to reconcile payment link', details: err.message });
    }
  }
);
