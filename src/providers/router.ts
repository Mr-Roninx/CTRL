/**
 * Enterprise Multi-Provider Router & Health Arbitrage Engine
 * 
 * Provides dynamic gateway routing, health tracking, and automatic failover
 * across payment recovery providers (Razorpay, Cashfree, Stripe).
 */

export type PaymentProviderType = 'razorpay' | 'cashfree' | 'stripe';

export interface ProviderHealth {
  provider: PaymentProviderType;
  environment: 'test' | 'live';
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  avg_latency_ms: number;
  consecutive_failures: number;
  circuit_state: 'CLOSED' | 'HALF_OPEN' | 'OPEN';
  success_rate: number;
  supported_currencies: string[];
  capabilities: string[];
  last_checked: string;
}

export interface RouteResolution {
  selected_provider: PaymentProviderType;
  environment: 'test' | 'live';
  routing_reason: string;
  is_fallback: boolean;
  fallback_chain: PaymentProviderType[];
}

export class ProviderRouter {
  private static healthRegistry: Map<string, ProviderHealth> = new Map();

  static {
    this.initDefaultProviders();
  }

  private static initDefaultProviders() {
    // Primary: Razorpay (Standard India UPI / Cards / NetBanking)
    this.healthRegistry.set('razorpay:test', {
      provider: 'razorpay',
      environment: 'test',
      status: 'HEALTHY',
      avg_latency_ms: 120,
      consecutive_failures: 0,
      circuit_state: 'CLOSED',
      success_rate: 0.98,
      supported_currencies: ['INR'],
      capabilities: ['PAYMENT_LINKS_CREATE', 'WEBHOOK_EVENT_INGESTION', 'STATUS_POLLING', 'UPI_DIRECT'],
      last_checked: new Date().toISOString(),
    });

    // Fallback: Cashfree (India Alternative)
    this.healthRegistry.set('cashfree:test', {
      provider: 'cashfree',
      environment: 'test',
      status: 'HEALTHY',
      avg_latency_ms: 140,
      consecutive_failures: 0,
      circuit_state: 'CLOSED',
      success_rate: 0.96,
      supported_currencies: ['INR'],
      capabilities: ['PAYMENT_LINKS_CREATE', 'WEBHOOK_EVENT_INGESTION'],
      last_checked: new Date().toISOString(),
    });

    // Fallback: Stripe (International Cards)
    this.healthRegistry.set('stripe:test', {
      provider: 'stripe',
      environment: 'test',
      status: 'HEALTHY',
      avg_latency_ms: 95,
      consecutive_failures: 0,
      circuit_state: 'CLOSED',
      success_rate: 0.99,
      supported_currencies: ['USD', 'EUR', 'GBP', 'INR'],
      capabilities: ['PAYMENT_LINKS_CREATE', 'WEBHOOK_EVENT_INGESTION', 'SMART_RETRIES'],
      last_checked: new Date().toISOString(),
    });
  }

  /**
   * Resolves the optimal provider for an opportunity based on currency, health, and latency.
   */
  public static resolveProvider(options: {
    currency?: string;
    preferredProvider?: PaymentProviderType;
    environment?: 'test' | 'live';
  }): RouteResolution {
    const currency = (options.currency || 'INR').toUpperCase();
    const env = options.environment || 'test';
    const preferred = options.preferredProvider || 'razorpay';

    const preferredKey = `${preferred}:${env}`;
    const preferredHealth = this.healthRegistry.get(preferredKey);

    // If preferred provider is healthy and supports currency, route to it
    if (
      preferredHealth &&
      preferredHealth.status !== 'DOWN' &&
      preferredHealth.circuit_state !== 'OPEN' &&
      preferredHealth.supported_currencies.includes(currency)
    ) {
      return {
        selected_provider: preferred,
        environment: env,
        routing_reason: `Primary provider ${preferred} is healthy (latency: ${preferredHealth.avg_latency_ms}ms)`,
        is_fallback: false,
        fallback_chain: ['cashfree', 'stripe'],
      };
    }

    // Dynamic Failover: Find first healthy alternate provider supporting this currency
    for (const [key, health] of this.healthRegistry.entries()) {
      if (
        health.provider !== preferred &&
        health.environment === env &&
        health.status === 'HEALTHY' &&
        health.supported_currencies.includes(currency)
      ) {
        return {
          selected_provider: health.provider,
          environment: env,
          routing_reason: `Failover activated: ${preferred} is ${preferredHealth?.status || 'UNAVAILABLE'}; routing to ${health.provider}`,
          is_fallback: true,
          fallback_chain: [preferred],
        };
      }
    }

    // Fallback to primary regardless with warning
    return {
      selected_provider: preferred,
      environment: env,
      routing_reason: `Default fallback to ${preferred} (all alternates exhausted)`,
      is_fallback: false,
      fallback_chain: [],
    };
  }

  /**
   * Updates provider health telemetry (e.g. from circuit breaker or API response times)
   */
  public static updateProviderTelemetry(
    provider: PaymentProviderType,
    latencyMs: number,
    isSuccess: boolean,
    environment: 'test' | 'live' = 'test'
  ): void {
    const key = `${provider}:${environment}`;
    const existing = this.healthRegistry.get(key);
    if (!existing) return;

    if (isSuccess) {
      existing.consecutive_failures = 0;
      existing.avg_latency_ms = Math.round(existing.avg_latency_ms * 0.8 + latencyMs * 0.2);
      if (existing.circuit_state === 'OPEN') existing.circuit_state = 'HALF_OPEN';
      else existing.status = 'HEALTHY';
    } else {
      existing.consecutive_failures += 1;
      if (existing.consecutive_failures >= 3) {
        existing.status = 'DEGRADED';
      }
      if (existing.consecutive_failures >= 5) {
        existing.status = 'DOWN';
        existing.circuit_state = 'OPEN';
      }
    }
    existing.last_checked = new Date().toISOString();
  }

  /**
   * Returns health status of all registered providers
   */
  public static getAllProviderHealth(): ProviderHealth[] {
    return Array.from(this.healthRegistry.values());
  }
}
