import { CacheManager } from '../cache/redis.js';

export interface CapacityPolicy {
  merchant_id: string;
  max_links_per_hour: number;
  max_links_per_day: number;
  max_links_per_customer_per_day: number;
  time_window_hours: number;
  monthly_budget_paise: number;
}

export interface CapacityCheckResult {
  allowed: boolean;
  reason?: string;
  hourly_remaining: number;
  daily_remaining: number;
  budget_remaining_paise: number;
}

export class CapacityPolicyManager {
  private static defaultPolicy: CapacityPolicy = {
    merchant_id: 'merchant_default',
    max_links_per_hour: 20,
    max_links_per_day: 100,
    max_links_per_customer_per_day: 1, // strict customer fatigue: max 1 link per 24h
    time_window_hours: 1,
    monthly_budget_paise: 5000000, // ₹50,000 max monthly budget
  };

  /**
   * Checks if an opportunity can be allocated under the merchant's capacity policy.
   */
  public static async evaluateCapacity(
    merchantId: string,
    customerId: string,
    operationalCostPaise: number,
    customPolicy?: Partial<CapacityPolicy>
  ): Promise<CapacityCheckResult> {
    const policy: CapacityPolicy = {
      ...this.defaultPolicy,
      ...customPolicy,
      merchant_id: merchantId,
    };

    const cache = CacheManager.getInstance();

    // 1. Customer-level fatigue check (max 1 link per 24h)
    const customerKey = `fatigue:${merchantId}:${customerId}`;
    const custCount = (await cache.get<number>(customerKey)) || 0;
    if (custCount >= policy.max_links_per_customer_per_day) {
      return {
        allowed: false,
        reason: `Customer fatigue limit reached (${custCount}/${policy.max_links_per_customer_per_day} in 24h)`,
        hourly_remaining: 0,
        daily_remaining: 0,
        budget_remaining_paise: 0,
      };
    }

    // 2. Merchant Hourly Capacity Check
    const hourlyKey = `capacity:hourly:${merchantId}`;
    const hourlyCount = (await cache.get<number>(hourlyKey)) || 0;
    if (hourlyCount >= policy.max_links_per_hour) {
      return {
        allowed: false,
        reason: `Merchant hourly capacity limit reached (${hourlyCount}/${policy.max_links_per_hour})`,
        hourly_remaining: 0,
        daily_remaining: Math.max(0, policy.max_links_per_day - hourlyCount),
        budget_remaining_paise: 0,
      };
    }

    // 3. Merchant Daily Capacity Check
    const dailyKey = `capacity:daily:${merchantId}`;
    const dailyCount = (await cache.get<number>(dailyKey)) || 0;
    if (dailyCount >= policy.max_links_per_day) {
      return {
        allowed: false,
        reason: `Merchant daily capacity limit reached (${dailyCount}/${policy.max_links_per_day})`,
        hourly_remaining: Math.max(0, policy.max_links_per_hour - hourlyCount),
        daily_remaining: 0,
        budget_remaining_paise: 0,
      };
    }

    // 4. Monthly Operational Budget Cap Check
    const budgetKey = `budget:monthly:${merchantId}`;
    const spentPaise = (await cache.get<number>(budgetKey)) || 0;
    if (spentPaise + operationalCostPaise > policy.monthly_budget_paise) {
      return {
        allowed: false,
        reason: `Merchant monthly operational budget exceeded (spent: ₹${(spentPaise / 100).toFixed(2)}, limit: ₹${(policy.monthly_budget_paise / 100).toFixed(2)})`,
        hourly_remaining: policy.max_links_per_hour - hourlyCount,
        daily_remaining: policy.max_links_per_day - dailyCount,
        budget_remaining_paise: Math.max(0, policy.monthly_budget_paise - spentPaise),
      };
    }

    return {
      allowed: true,
      hourly_remaining: policy.max_links_per_hour - hourlyCount - 1,
      daily_remaining: policy.max_links_per_day - dailyCount - 1,
      budget_remaining_paise: policy.monthly_budget_paise - (spentPaise + operationalCostPaise),
    };
  }

  /**
   * Consumes capacity and records link creation against limits.
   */
  public static async recordConsumption(
    merchantId: string,
    customerId: string,
    operationalCostPaise: number
  ): Promise<void> {
    const cache = CacheManager.getInstance();

    // 1. Customer Fatigue: 24h TTL
    const customerKey = `fatigue:${merchantId}:${customerId}`;
    const curCust = (await cache.get<number>(customerKey)) || 0;
    await cache.set(customerKey, curCust + 1, 86400); // 24 hours

    // 2. Hourly Counter: 1h TTL
    const hourlyKey = `capacity:hourly:${merchantId}`;
    const curHour = (await cache.get<number>(hourlyKey)) || 0;
    await cache.set(hourlyKey, curHour + 1, 3600); // 1 hour

    // 3. Daily Counter: 24h TTL
    const dailyKey = `capacity:daily:${merchantId}`;
    const curDaily = (await cache.get<number>(dailyKey)) || 0;
    await cache.set(dailyKey, curDaily + 1, 86400); // 24 hours

    // 4. Monthly Budget Counter: 30-day TTL
    const budgetKey = `budget:monthly:${merchantId}`;
    const curBudget = (await cache.get<number>(budgetKey)) || 0;
    await cache.set(budgetKey, curBudget + operationalCostPaise, 2592000); // 30 days

    // Update Lagrangian dual multiplier with new spend
    DualMirrorBudgetPacer.updateDualMultiplier(merchantId, operationalCostPaise);
  }
}

/**
 * Online Dual-Mirror Descent Lagrangian Budget Pacer
 * 
 * Solves constrained welfare optimization across continuous time windows:
 *   max sum_i (IVEN_i * x_i)  s.t.  sum_i (cost_i * x_i) <= DailyBudget
 * 
 * Maintains online dual multiplier lambda(t) updated via subgradient descent:
 *   lambda_{t+1} = max(0.1, lambda_t + eta * (spent_t - target_burn_rate_t))
 */
import { insertPacingBanditLog } from '../db/database.js';

export type PacingArm = 'CONSERVATIVE' | 'NEUTRAL' | 'AGGRESSIVE';
export type PacingTimeWindow = 'NIGHT_QUIET' | 'MORNING_PEAK' | 'AFTERNOON_TROUGH' | 'EVENING_SURGE';

export interface DualPacingState {
  merchant_id: string;
  lambda: number;
  daily_budget_paise: number;
  spent_today_paise: number;
  target_spend_rate_paise_per_hour: number;
  active_arm: PacingArm;
  time_window: PacingTimeWindow;
  update_count: number;
  last_updated: string;
}

interface ArmStats {
  pulls: number;
  reward_sum: number;
}

export class DualMirrorBudgetPacer {
  private static states: Map<string, DualPacingState> = new Map();
  private static readonly baseEta = 0.005; // Base learning rate
  private static armMultipliers: Record<PacingArm, number> = {
    CONSERVATIVE: 1.20, // Shades shadow price higher to conserve budget for later peaks
    NEUTRAL: 1.00,      // Standard dual descent
    AGGRESSIVE: 0.85,   // Lowers shadow threshold to clear queue aggressively
  };

  // In-memory bandit arm statistics per (window, arm)
  private static armStats: Map<string, ArmStats> = new Map();

  public static getTimeWindow(date: Date = new Date()): PacingTimeWindow {
    const hour = date.getUTCHours();
    if (hour < 6) return 'NIGHT_QUIET';
    if (hour < 12) return 'MORNING_PEAK';
    if (hour < 18) return 'AFTERNOON_TROUGH';
    return 'EVENING_SURGE';
  }

  private static getStatsKey(window: PacingTimeWindow, arm: PacingArm): string {
    return `${window}:${arm}`;
  }

  /**
   * Upper Confidence Bound (UCB1) arm selection for capacity pacing
   */
  public static selectPacingArm(window: PacingTimeWindow): PacingArm {
    const arms: PacingArm[] = ['CONSERVATIVE', 'NEUTRAL', 'AGGRESSIVE'];
    let totalPulls = 0;

    for (const arm of arms) {
      const stats = this.armStats.get(this.getStatsKey(window, arm));
      totalPulls += stats?.pulls || 0;
    }

    if (totalPulls < 3) {
      // Round-robin cold-start
      return arms[totalPulls % 3] ?? 'NEUTRAL';
    }

    let bestArm: PacingArm = 'NEUTRAL';
    let bestScore = -Infinity;

    for (const arm of arms) {
      const stats = this.armStats.get(this.getStatsKey(window, arm)) || { pulls: 0, reward_sum: 0 };
      const meanReward = stats.pulls > 0 ? stats.reward_sum / stats.pulls : 0.5;
      const explorationBonus = Math.sqrt((2.0 * Math.log(totalPulls + 1)) / (stats.pulls + 1));
      const ucbScore = meanReward + explorationBonus;

      if (ucbScore > bestScore) {
        bestScore = ucbScore;
        bestArm = arm;
      }
    }

    return bestArm;
  }

  public static getPacingState(merchantId: string, dailyBudgetPaise: number = 200000): DualPacingState {
    const existing = this.states.get(merchantId);
    const currentWindow = this.getTimeWindow();

    if (existing) {
      if (existing.time_window !== currentWindow) {
        existing.time_window = currentWindow;
        existing.active_arm = this.selectPacingArm(currentWindow);
      }
      return existing;
    }

    const chosenArm = this.selectPacingArm(currentWindow);
    const initial: DualPacingState = {
      merchant_id: merchantId,
      lambda: 1.0,
      daily_budget_paise: dailyBudgetPaise,
      spent_today_paise: 0,
      target_spend_rate_paise_per_hour: dailyBudgetPaise / 24,
      active_arm: chosenArm,
      time_window: currentWindow,
      update_count: 0,
      last_updated: new Date().toISOString(),
    };
    this.states.set(merchantId, initial);
    return initial;
  }

  /**
   * Updates dual variable lambda using decaying step-size subgradient descent:
   * eta_t = eta_0 / sqrt(t + 1)
   */
  public static updateDualMultiplier(merchantId: string, additionalSpendPaise: number = 0): number {
    const state = this.getPacingState(merchantId);
    state.spent_today_paise += additionalSpendPaise;
    state.update_count += 1;

    const now = new Date();
    const hoursElapsed = Math.max(1, now.getUTCHours() + now.getUTCMinutes() / 60);
    const expectedSpendAtThisHour = state.target_spend_rate_paise_per_hour * hoursElapsed;

    // Subgradient: (actual spend - expected target spend)
    const subgradient = state.spent_today_paise - expectedSpendAtThisHour;

    // Decayed step size: guarantees convergence
    const decayingEta = this.baseEta / Math.sqrt(state.update_count);

    // Raw dual multiplier step
    const rawLambda = state.lambda + decayingEta * (subgradient / 50000);

    // Apply active bandit arm multiplier
    const armMultiplier = this.armMultipliers[state.active_arm] || 1.0;
    const modulatedLambda = rawLambda * armMultiplier;

    // Clamp strictly within [0.10, 1000.0]
    state.lambda = Math.max(0.1, Math.min(1000.0, Number(modulatedLambda.toFixed(4))));
    state.last_updated = now.toISOString();

    // Durable audit logging to SQLite
    insertPacingBanditLog({
      id: `pacing_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      tenant_id: merchantId,
      time_window: state.time_window,
      pacing_arm: state.active_arm,
      lambda_applied: state.lambda,
      spent_paise: state.spent_today_paise,
      budget_paise: state.daily_budget_paise,
      reward: 0.0, // Updated when window outcome is reconciled
      created_at: now.toISOString(),
    });

    return state.lambda;
  }

  /**
   * Records window pacing outcome reward:
   * reward = (recovered_paise - overspend_penalty) / budget_paise normalized to [0, 1]
   */
  public static recordPacingReward(
    window: PacingTimeWindow,
    arm: PacingArm,
    reward: number
  ): void {
    const key = this.getStatsKey(window, arm);
    const existing = this.armStats.get(key) || { pulls: 0, reward_sum: 0 };
    existing.pulls += 1;
    existing.reward_sum += Math.max(0.0, Math.min(1.0, reward));
    this.armStats.set(key, existing);
  }

  /**
   * Checks if an opportunity's IVEN clears the dynamic Lagrangian hurdle
   */
  public static shouldAllocate(
    merchantId: string,
    ivenPaise: number,
    costPaise: number = 400
  ): {
    clears_hurdle: boolean;
    shadow_threshold_paise: number;
    current_lambda: number;
    active_arm: PacingArm;
    time_window: PacingTimeWindow;
  } {
    const state = this.getPacingState(merchantId);
    const shadow_threshold_paise = Math.round(state.lambda * costPaise);
    const clears_hurdle = ivenPaise >= shadow_threshold_paise;

    return {
      clears_hurdle,
      shadow_threshold_paise,
      current_lambda: state.lambda,
      active_arm: state.active_arm,
      time_window: state.time_window,
    };
  }

  /**
   * Resets internal state for unit testing
   */
  public static resetForTesting(): void {
    this.states.clear();
    this.armStats.clear();
  }
}
