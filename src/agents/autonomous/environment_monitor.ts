import { EventEmitter } from 'node:events';

export interface BankingRailStatus {
  bank_code: string;
  network: 'VISA' | 'MASTERCARD' | 'RUPAY';
  success_rate: number;
  avg_latency_ms: number;
  is_operational: boolean;
  last_checked_at: string;
}

export interface EnvironmentTelemetry {
  razorpay_api_health: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  active_downtimes: string[];
  rails: Record<string, BankingRailStatus>;
  overall_health_score: number;
}

export class EnvironmentMonitor {
  private static emitter = new EventEmitter();
  private static railsState: Record<string, BankingRailStatus> = {
    HDFC: { bank_code: 'HDFC', network: 'VISA', success_rate: 0.95, avg_latency_ms: 780, is_operational: true, last_checked_at: new Date().toISOString() },
    ICICI: { bank_code: 'ICICI', network: 'MASTERCARD', success_rate: 0.93, avg_latency_ms: 820, is_operational: true, last_checked_at: new Date().toISOString() },
    SBI: { bank_code: 'SBI', network: 'RUPAY', success_rate: 0.74, avg_latency_ms: 3100, is_operational: false, last_checked_at: new Date().toISOString() },
    AXIS: { bank_code: 'AXIS', network: 'VISA', success_rate: 0.91, avg_latency_ms: 910, is_operational: true, last_checked_at: new Date().toISOString() },
  };

  /**
   * Query real-time banking rails status.
   */
  public static getTelemetry(): EnvironmentTelemetry {
    const activeDowntimes = Object.values(this.railsState)
      .filter((r) => !r.is_operational)
      .map((r) => r.bank_code);

    const operationalCount = Object.values(this.railsState).filter((r) => r.is_operational).length;
    const totalCount = Object.values(this.railsState).length;
    const score = totalCount > 0 ? operationalCount / totalCount : 1.0;

    return {
      razorpay_api_health: 'HEALTHY',
      active_downtimes: activeDowntimes,
      rails: { ...this.railsState },
      overall_health_score: Number(score.toFixed(2)),
    };
  }

  /**
   * Update a bank's rail state and broadcast change if downtime status toggles.
   */
  public static updateRailState(bankCode: string, isOperational: boolean, successRate: number, latencyMs: number): void {
    const prev = this.railsState[bankCode];
    this.railsState[bankCode] = {
      bank_code: bankCode,
      network: prev?.network || 'VISA',
      success_rate: successRate,
      avg_latency_ms: latencyMs,
      is_operational: isOperational,
      last_checked_at: new Date().toISOString(),
    };

    if (prev && prev.is_operational !== isOperational) {
      this.emitter.emit('rail_status_change', {
        bank_code: bankCode,
        is_operational: isOperational,
        timestamp: new Date().toISOString(),
      });
    }
  }

  public static onRailStatusChange(listener: (event: any) => void): () => void {
    this.emitter.on('rail_status_change', listener);
    return () => this.emitter.off('rail_status_change', listener);
  }
}
