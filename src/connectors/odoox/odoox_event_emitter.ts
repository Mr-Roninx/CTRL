export interface OdooXEventPayload {
  event_id: string;
  source: 'ODOOX_EVENT';
  provider: 'razorpay' | 'stripe' | 'manual';
  environment: 'live' | 'test';
  payment_id?: string;
  order_id?: string;
  payment_link_id?: string;
  amount_paise: number;
  currency?: string;
  method?: string;
  status: 'created' | 'authorized' | 'failed' | 'captured' | 'paid' | 'cancelled' | 'expired';
  failure_code?: string;
  failure_description?: string;
  failure_type?: 'hard' | 'soft' | 'unknown';
  attempt_number?: number;
  customer_reference: string;
  customer_email?: string;
  customer_phone?: string;
  occurred_at?: string;
  metadata?: Record<string, any>;
}

export interface OdooXEmissionResult {
  success: boolean;
  delivered: boolean;
  statusCode?: number;
  opportunityId?: string;
  deduplicated?: boolean;
  error?: string;
}

export class OdooXEventEmitter {
  private ctrlBaseUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(options: {
    ctrlBaseUrl?: string;
    baseUrl?: string;
    apiKey: string;
    timeoutMs?: number;
  }) {
    const url = options.ctrlBaseUrl || options.baseUrl || 'http://localhost:3001';
    this.ctrlBaseUrl = url.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs || 8000;
  }

  /**
   * Resilient, non-blocking dispatch of payment failure/checkout events to CTRL.
   * INVARIANT: If CTRL is down or unresponsive, OdooX ordinary payment flow continues unaffected.
   */
  public async emitPaymentEvent(event: OdooXEventPayload): Promise<OdooXEmissionResult> {
    const endpoint = `${this.ctrlBaseUrl}/v1/events`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          ...event,
          occurred_at: event.occurred_at || new Date().toISOString(),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`⚠️ [OdooX Connector] CTRL returned status ${response.status}: ${errorText}`);
        return {
          success: false,
          delivered: false,
          statusCode: response.status,
          error: `HTTP ${response.status}: ${errorText}`,
        };
      }

      const data: any = await response.json();
      return {
        success: true,
        delivered: true,
        statusCode: response.status,
        opportunityId: data.opportunity_id,
        deduplicated: data.deduplicated,
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      // Non-blocking fail-safe: log warning, never crash merchant application
      console.warn(`⚠️ [OdooX Connector] Non-blocking dispatch failure (CTRL offline / timeout): ${err.message}`);
      return {
        success: false,
        delivered: false,
        error: err.message || 'Network / connection failure',
      };
    }
  }

  /**
   * Fire-and-forget helper ensuring zero latency impact on synchronous OdooX checkout requests.
   */
  public fireAndForget(event: OdooXEventPayload): void {
    this.emitPaymentEvent(event).catch((err) => {
      console.warn(`⚠️ [OdooX Connector] Background dispatch error:`, err.message);
    });
  }
}
