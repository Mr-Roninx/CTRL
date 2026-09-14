import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema, ZodError } from 'zod';

/**
 * Standard RFC 7807 Problem Details error format
 */
export interface ValidationErrorDetail {
  field: string;
  message: string;
  code: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  errors?: ValidationErrorDetail[];
}

// ========================================================
// REUSABLE ZOD SCHEMAS FOR CTRL GATEWAY
// ========================================================

export const OpportunitySourceSchema = z.enum(['real', 'synthetic']);
export const DeclineTypeSchema = z.enum(['hard', 'soft', 'unknown']);
export const CurrencySchema = z.string().length(3).default('INR');

export const CreateOpportunitySchema = z.object({
  id: z.string().min(3).max(128).optional(),
  amount_paise: z.number().int().positive({ message: 'Amount in paise must be a positive integer' }),
  currency: z.string().length(3).default('INR'),
  reason_code: z.string().min(1, { message: 'Decline reason code is required' }),
  decline_type: DeclineTypeSchema.optional().default('unknown'),
  attempt_count: z.number().int().nonnegative().optional().default(1),
  customer_id: z.string().min(1, { message: 'Customer ID is required' }),
  customer_trust_score: z.number().min(0).max(1).optional().default(0.65),
  source: OpportunitySourceSchema.optional().default('synthetic'),
  razorpay_event_id: z.string().nullable().optional(),
  raw_payload_ref: z.string().nullable().optional(),
});

export const ScoreRequestSchema = z.object({
  opportunity_id: z.string().min(1, { message: 'opportunity_id is required' }),
});

export const MarketAllocationSchema = z.object({
  batch_size: z.number().int().positive().max(50).optional().default(10),
  capacity_limit: z.number().int().positive().max(20).optional().default(5),
  min_confidence: z.enum(['low', 'medium', 'high']).optional(),
  dry_run: z.boolean().optional().default(false),
});

export const KillSwitchToggleSchema = z.object({
  active: z.boolean({ message: 'active flag (boolean) is required' }),
  reason: z.string().max(256).optional(),
});

export const AuthLoginSchema = z.object({
  email: z.string().email({ message: 'Valid email required' }),
  password: z.string().min(6, { message: 'Password must be at least 6 characters' }),
});

export const AuthSignupSchema = z.object({
  email: z.string().email({ message: 'Valid email required' }),
  password: z.string().min(8, { message: 'Password must be at least 8 characters' }),
  business_name: z.string().min(2, { message: 'Business name must be at least 2 characters' }),
});

export const EventIngestionSchema = z.object({
  event_type: z.string().min(1, { message: 'event_type is required' }),
  amount_paise: z.number().int().positive().optional(),
  customer_id: z.string().optional(),
  failure_code: z.string().optional(),
  payload: z.record(z.any()).optional(),
});

// ========================================================
// VALIDATION MIDDLEWARE GENERATOR
// ========================================================

export interface ValidationTargetSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export function validateRequest(schemas: ValidationTargetSchemas) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const errorDetails: ValidationErrorDetail[] = [];

    if (schemas.body && req.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) {
        formatZodErrors('body', result.error, errorDetails);
      } else {
        req.body = result.data;
      }
    }

    if (schemas.query && req.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) {
        formatZodErrors('query', result.error, errorDetails);
      } else {
        req.query = result.data as any;
      }
    }

    if (schemas.params && req.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) {
        formatZodErrors('params', result.error, errorDetails);
      } else {
        req.params = result.data as any;
      }
    }

    if (errorDetails.length > 0) {
      const problem: ProblemDetails = {
        type: 'https://ctrl.dev/errors/validation-error',
        title: 'Request Validation Failed',
        status: 400,
        detail: `The request content failed schema validation with ${errorDetails.length} error(s).`,
        instance: req.originalUrl,
        errors: errorDetails,
      };

      res.status(400).json(problem);
      return;
    }

    next();
  };
}

function formatZodErrors(source: string, error: ZodError, target: ValidationErrorDetail[]): void {
  for (const issue of error.issues) {
    const fieldPath = issue.path.length > 0 ? issue.path.join('.') : source;
    target.push({
      field: `${source}.${fieldPath}`,
      message: issue.message,
      code: issue.code,
    });
  }
}
