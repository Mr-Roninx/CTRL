import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * CTRL — Input Sanitizer & Validation Layer
 * 
 * Protects against null-byte injection, control character poisoning,
 * non-UTF-8 payload exploits, and oversized memory exhaustion attacks.
 */

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    // Remove null bytes and non-printable control characters (except newline, tab, carriage return)
    const cleaned = value.replace(/\0/g, '').replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    // Truncate excessively long individual strings (max 250k chars per field)
    if (cleaned.length > 250000) {
      return cleaned.slice(0, 250000);
    }
    return cleaned;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (value !== null && typeof value === 'object') {
    const sanitizedObj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const cleanKey = key.replace(/\0/g, '');
      sanitizedObj[cleanKey] = sanitizeValue(val);
    }
    return sanitizedObj;
  }

  return value;
}

/**
 * Express middleware to sanitize incoming query, body, and params.
 */
export function inputSanitizerMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeValue(req.query) as any;
  }
  if (req.params && typeof req.params === 'object') {
    req.params = sanitizeValue(req.params) as any;
  }
  next();
}

/**
 * Factory for route-level Zod request validation.
 */
export function validateRequestBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = (result.error as ZodError).issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      res.status(400).json({
        error: 'Validation Failed',
        message: 'Invalid request payload format or missing required fields',
        details: errors,
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
