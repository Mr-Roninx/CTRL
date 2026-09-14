import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { trace, context, Span, SpanStatusCode, Tracer } from '@opentelemetry/api';

/**
 * CTRL — OpenTelemetry Distributed Tracing Subsystem
 * 
 * Provides W3C trace propagation, custom span instrumentation for agent loops,
 * economic calculations, and authority validation, exporting to Jaeger / OTLP backends.
 */

export const CTRL_SPANS = {
  AGENT_ITERATION: 'ctrl.agent.loop.iteration',
  MARKET_ALLOCATION: 'ctrl.market.allocation',
  AUTHORITY_CHECK: 'ctrl.authority.check',
  EXECUTION_DISPATCH: 'ctrl.execution.dispatch',
  HTTP_REQUEST: 'ctrl.http.request',
  WEBHOOK_INGESTION: 'ctrl.webhook.ingestion',
} as const;

let sdk: NodeSDK | null = null;
let isInitialized = false;

export function initOpenTelemetry(): void {
  if (isInitialized) return;

  const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces';
  const serviceName = process.env.OTEL_SERVICE_NAME || 'ctrl-recovery-plane';
  const enabled = process.env.OTEL_ENABLED !== 'false';

  if (!enabled) {
    console.log('🔭 OpenTelemetry: Disabled via OTEL_ENABLED=false');
    isInitialized = true;
    return;
  }

  try {
    const traceExporter = new OTLPTraceExporter({
      url: otelEndpoint,
      timeoutMillis: 3000,
    });

    sdk = new NodeSDK({
      serviceName,
      traceExporter,
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': { enabled: false },
          '@opentelemetry/instrumentation-dns': { enabled: false },
        }),
      ],
    });

    sdk.start();
    isInitialized = true;
    console.log(`🔭 OpenTelemetry: Distributed tracing initialized (Service: '${serviceName}', Target: ${otelEndpoint})`);
  } catch (err: any) {
    console.warn(`⚠️ OpenTelemetry initialization warning: ${err.message}. Continuing with no-op tracer.`);
    isInitialized = true;
  }
}

export function getTracer(name: string = 'ctrl-core'): Tracer {
  return trace.getTracer(name, '11.0.0');
}

/**
 * Executes an asynchronous function within a tracked OpenTelemetry span.
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean | undefined>,
  fn: (span: Span) => Promise<T>,
  tracerName: string = 'ctrl-core'
): Promise<T> {
  const tracer = getTracer(tracerName);

  return tracer.startActiveSpan(name, async (span) => {
    try {
      for (const [key, value] of Object.entries(attributes)) {
        if (value !== undefined) {
          span.setAttribute(key, value);
        }
      }

      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error: any) {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error?.message || 'Operation failed within span',
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Gracefully shuts down OpenTelemetry SDK on process termination.
 */
export async function shutdownOpenTelemetry(): Promise<void> {
  if (sdk) {
    try {
      await sdk.shutdown();
      console.log('🔭 OpenTelemetry: SDK cleanly terminated.');
    } catch (err: any) {
      console.warn('⚠️ Error shutting down OpenTelemetry:', err.message);
    }
    sdk = null;
    isInitialized = false;
  }
}
