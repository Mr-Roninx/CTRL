export interface SLOMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  latencyBuckets: {
    under100ms: number;
    under500ms: number;
    under2000ms: number;
    over2000ms: number;
  };
  windowStartTime: number;
}

export interface SLOStatus {
  availability: {
    target_pct: number;
    current_pct: number;
    burn_rate_1h: number;
    status: 'HEALTHY' | 'WARNING' | 'BREACHED';
  };
  latency: {
    target_pct_under_500ms: number;
    current_pct_under_500ms: number;
    status: 'HEALTHY' | 'WARNING' | 'BREACHED';
  };
  window_duration_seconds: number;
  timestamp: string;
}

/**
 * Enterprise Service Level Objective (SLO) & Error Budget Burn Rate Tracker.
 * Tracks multi-window burn rates against Google SRE 99.9% availability targets.
 */
export class SLOTracker {
  private static instance: SLOTracker | null = null;
  private readonly availabilityTarget = 0.999; // 99.9% availability (error budget = 0.1%)
  private readonly latencyTarget = 0.99; // 99.0% under 500ms

  private currentWindow: SLOMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    latencyBuckets: {
      under100ms: 0,
      under500ms: 0,
      under2000ms: 0,
      over2000ms: 0,
    },
    windowStartTime: Date.now(),
  };

  private constructor() {}

  public static getInstance(): SLOTracker {
    if (!SLOTracker.instance) {
      SLOTracker.instance = new SLOTracker();
    }
    return SLOTracker.instance;
  }

  /**
   * Records an API request outcome and latency for real-time SLO calculation.
   */
  public recordRequest(statusCode: number, latencyMs: number): void {
    this.currentWindow.totalRequests += 1;

    if (statusCode < 500) {
      this.currentWindow.successfulRequests += 1;
    } else {
      this.currentWindow.failedRequests += 1;
    }

    if (latencyMs < 100) {
      this.currentWindow.latencyBuckets.under100ms += 1;
    } else if (latencyMs < 500) {
      this.currentWindow.latencyBuckets.under500ms += 1;
    } else if (latencyMs < 2000) {
      this.currentWindow.latencyBuckets.under2000ms += 1;
    } else {
      this.currentWindow.latencyBuckets.over2000ms += 1;
    }
  }

  /**
   * Computes current availability, latency compliance, and 1-hour error budget burn rate.
   */
  public getSLOStatus(): SLOStatus {
    const total = Math.max(1, this.currentWindow.totalRequests);
    const failures = this.currentWindow.failedRequests;
    const currentAvailability = (total - failures) / total;

    // Error budget = 1 - 0.999 = 0.001 (0.1%)
    const errorBudget = 1 - this.availabilityTarget;
    const observedErrorRate = failures / total;

    // Burn rate = observed error rate / error budget
    // Normal consumption rate is 1.0. A burn rate of 14.4 burns 2% of budget in 1 hour.
    const burnRate1h = Number((observedErrorRate / errorBudget).toFixed(2));

    let availabilityStatus: 'HEALTHY' | 'WARNING' | 'BREACHED' = 'HEALTHY';
    if (burnRate1h >= 14.4 || currentAvailability < this.availabilityTarget) {
      availabilityStatus = 'BREACHED';
    } else if (burnRate1h > 2.0) {
      availabilityStatus = 'WARNING';
    }

    // Latency compliance (< 500ms)
    const fastRequests =
      this.currentWindow.latencyBuckets.under100ms + this.currentWindow.latencyBuckets.under500ms;
    const currentLatencyPct = fastRequests / total;

    let latencyStatus: 'HEALTHY' | 'WARNING' | 'BREACHED' = 'HEALTHY';
    if (currentLatencyPct < 0.95) {
      latencyStatus = 'BREACHED';
    } else if (currentLatencyPct < this.latencyTarget) {
      latencyStatus = 'WARNING';
    }

    const windowSeconds = Math.max(1, Math.floor((Date.now() - this.currentWindow.windowStartTime) / 1000));

    return {
      availability: {
        target_pct: Number((this.availabilityTarget * 100).toFixed(1)),
        current_pct: Number((currentAvailability * 100).toFixed(2)),
        burn_rate_1h: burnRate1h,
        status: availabilityStatus,
      },
      latency: {
        target_pct_under_500ms: Number((this.latencyTarget * 100).toFixed(1)),
        current_pct_under_500ms: Number((currentLatencyPct * 100).toFixed(2)),
        status: latencyStatus,
      },
      window_duration_seconds: windowSeconds,
      timestamp: new Date().toISOString(),
    };
  }

  public reset(): void {
    this.currentWindow = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      latencyBuckets: {
        under100ms: 0,
        under500ms: 0,
        under2000ms: 0,
        over2000ms: 0,
      },
      windowStartTime: Date.now(),
    };
  }
}

export const sloTracker = SLOTracker.getInstance();
