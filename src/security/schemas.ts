import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

// Schema for Opportunity Ingestion / Simulation
export const SimulateWebhookSchema = z.object({
  entity: z.string().optional(),
  account_id: z.string().optional(),
  event: z.string().min(1),
  contains: z.array(z.string()).optional(),
  payload: z.record(z.any()),
  created_at: z.number().optional(),
});

// Schema for Market Allocation Run
export const MarketRunSchema = z.object({
  capacity: z.number().int().positive().max(50).optional(),
});

// Schema for Action Authority Run
export const AuthorityRunSchema = z.object({
  capacity: z.number().int().positive().max(50).optional(),
});

// Schema for Kill Switch Toggle
export const KillSwitchSchema = z.object({
  enabled: z.boolean(),
});

// Schema for Execution Run
export const ExecutionRunSchema = z.object({
  maxLinks: z.number().int().positive().max(30).optional(),
});

// Schema for Agent Mission Dispatch
export const StartAgentMissionSchema = z.object({
  opportunity_id: z.string().min(1),
  goal: z
    .object({
      type: z.string().optional(),
      desired_outcome: z.string().optional(),
    })
    .optional(),
});

// Schema for Tool Execution via Gate
export const ExecuteToolSchema = z.object({
  tool_id: z.string().min(1),
  run_id: z.string().optional(),
  agent_name: z.string().optional(),
  payload: z.record(z.any()).optional(),
});

// Schema for Merchant Copilot Query
export const MerchantQuerySchema = z.object({
  query: z.string().min(1).max(500),
});

// Schema for Outreach Draft Review
export const OutreachReviewSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  feedback: z.string().max(1000).optional(),
});

// Schema for Canonical Inbound Payment Event (v6)
export const CanonicalPaymentEventSchema = z.object({
  event_id: z.string().min(1, 'event_id is required'),
  tenant_id: z.string().min(1, 'tenant_id is required'),
  source: z.enum([
    'ODOOX_EVENT',
    'RAZORPAY_WEBHOOK',
    'RAZORPAY_API_FETCH',
    'CTRL_RECONCILIATION',
    'SYNTHETIC_SIMULATION',
    'CLIENT_SDK',
    'WEB_APP',
    'SDK_INTERCEPTOR',
  ]),
  provider: z.enum(['razorpay', 'stripe', 'manual']).default('razorpay'),
  environment: z.enum(['live', 'test']).default('test'),
  payment_id: z.string().nullable().optional(),
  order_id: z.string().nullable().optional(),
  payment_link_id: z.string().nullable().optional(),
  amount_paise: z.coerce.number().int().positive('amount_paise must be a positive integer'),
  currency: z.string().length(3).default('INR'),
  method: z.string().nullable().optional(),
  status: z.enum(['created', 'authorized', 'failed', 'captured', 'paid', 'cancelled', 'expired']),
  failure_code: z.string().nullable().optional(),
  failure_description: z.string().nullable().optional(),
  failure_type: z.enum(['hard', 'soft', 'unknown']).nullable().optional(),
  attempt_number: z.coerce.number().int().positive().default(1),
  customer_reference: z.string().min(1, 'customer_reference is required'),
  customer_email: z.string().email().nullable().optional().or(z.literal('')),
  customer_phone: z.string().nullable().optional(),
  occurred_at: z.string().nullable().optional(),
  received_at: z.string().nullable().optional(),
  correlation_id: z.string().default(() => `corr_${Date.now()}`),
  metadata: z.record(z.any()).nullable().optional(),
});

// Schema for Web App Connection Heartbeat / Ping
export const WebAppPingSchema = z.object({
  app_origin: z.string().min(1, 'app_origin is required'),
  app_url: z.string().nullable().optional(),
  app_name: z.string().nullable().optional(),
  sdk_version: z.string().nullable().optional().default('6.1.0'),
  user_agent: z.string().nullable().optional(),
  timestamp: z.string().nullable().optional(),
  metadata: z.record(z.any()).nullable().optional(),
});

/**
 * Express middleware factory for validating request body with Zod schema.
 */
export function validateBody(schema: z.ZodSchema<any>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: result.error.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

