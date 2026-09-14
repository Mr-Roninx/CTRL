import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'node:crypto';
import { metrics } from '../observability/metrics.js';

export interface TraceContext {
  traceId: string;
  spanId: string;
  requestId: string;
  startTime: number;
}

declare global {
  namespace Express {
    interface Request {
      trace?: TraceContext;
    }
  }
}

/**
 * Enterprise Tracing Middleware
 * Generates and propagates W3C Trace Context and X-Request-ID headers.
 */
export function tracingMiddleware(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();

  // Extract or generate W3C Trace ID
  const traceparent = req.headers['traceparent'] as string | undefined;
  let traceId = randomBytes(16).toString('hex');
  let parentSpanId = randomBytes(8).toString('hex');

  if (traceparent && traceparent.startsWith('00-')) {
    const parts = traceparent.split('-');
    if (parts.length >= 4 && parts[1] && parts[2]) {
      traceId = parts[1];
      parentSpanId = parts[2];
    }
  }

  const requestId = (req.headers['x-request-id'] as string) || `req_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const spanId = randomBytes(8).toString('hex');

  req.trace = {
    traceId,
    spanId,
    requestId,
    startTime,
  };

  // Set outgoing headers
  res.setHeader('x-request-id', requestId);
  res.setHeader('x-trace-id', traceId);
  res.setHeader('traceparent', `00-${traceId}-${spanId}-01`);

  // Log on response completion and record metrics
  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const durationSec = durationMs / 1000;
    const routePath = req.route?.path || req.path;

    metrics.observeHistogram('ctrl_provider_latency_seconds', durationSec, {
      method: req.method,
      status: String(res.statusCode),
    });
  });

  next();
}
