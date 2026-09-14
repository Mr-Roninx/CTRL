import { RecoveryOpportunity } from '../types/index.js';

export interface DiffInDiffInput {
  treatedPre: { recovered: number; total: number };
  treatedPost: { recovered: number; total: number };
  controlPre: { recovered: number; total: number };
  controlPost: { recovered: number; total: number };
}

export interface DiffInDiffResult {
  att: number; // Average Treatment Effect on Treated (incremental probability lift)
  att_display_pct: string;
  y_treated_pre: number;
  y_treated_post: number;
  y_control_pre: number;
  y_control_post: number;
  delta_treated: number;
  delta_control: number;
  standard_error: number;
  z_score: number;
  p_value: number;
  is_significant: boolean;
  parallel_trends_passed: boolean;
  parallel_trends_diff: number;
  causal_lift_pct: number;
  classification:
    | 'STATISTICALLY_SIGNIFICANT_LIFT'
    | 'DIRECTIONALLY_POSITIVE'
    | 'NO_CAUSAL_EFFECT'
    | 'PARALLEL_TRENDS_VIOLATION';
  interpretation: string;
}

export class CausalAttributionEngine {
  /**
   * Computes Difference-in-Differences (Diff-in-Diff) Average Treatment Effect on the Treated (ATT)
   * 
   * ATT = (Y_treated_post - Y_treated_pre) - (Y_control_post - Y_control_pre)
   */
  public static computeDiffInDiff(input: DiffInDiffInput): DiffInDiffResult {
    const { treatedPre, treatedPost, controlPre, controlPost } = input;

    // Proportions
    const yTreatedPre = treatedPre.total > 0 ? treatedPre.recovered / treatedPre.total : 0;
    const yTreatedPost = treatedPost.total > 0 ? treatedPost.recovered / treatedPost.total : 0;
    const yControlPre = controlPre.total > 0 ? controlPre.recovered / controlPre.total : 0;
    const yControlPost = controlPost.total > 0 ? controlPost.recovered / controlPost.total : 0;

    const deltaTreated = yTreatedPost - yTreatedPre;
    const deltaControl = yControlPost - yControlPre;

    const att = deltaTreated - deltaControl;

    // Parallel Trends Check: Pre-intervention baseline difference tolerance (<= 15%)
    const parallelTrendsDiff = Math.abs(yTreatedPre - yControlPre);
    const parallelTrendsPassed = parallelTrendsDiff <= 0.15;

    // Standard Error calculation via pooled variance propagation
    const varTreatedPost = treatedPost.total > 0 ? (yTreatedPost * (1 - yTreatedPost)) / treatedPost.total : 0;
    const varTreatedPre = treatedPre.total > 0 ? (yTreatedPre * (1 - yTreatedPre)) / treatedPre.total : 0;
    const varControlPost = controlPost.total > 0 ? (yControlPost * (1 - yControlPost)) / controlPost.total : 0;
    const varControlPre = controlPre.total > 0 ? (yControlPre * (1 - yControlPre)) / controlPre.total : 0;

    const se = Math.sqrt(varTreatedPost + varTreatedPre + varControlPost + varControlPre);
    const zScore = se > 0 ? att / se : 0;

    // Two-tailed p-value approximation
    const absZ = Math.abs(zScore);
    const pValue = absZ > 0 ? Math.max(0.0001, Number((2 * (1 - (0.5 * (1 + Math.tanh(absZ * 0.797884))))).toFixed(4))) : 1.0;
    const isSignificant = pValue < 0.05 && att > 0;

    const counterfactualPost = yControlPost;
    const causalLiftPct = counterfactualPost > 0 ? Number(((att / counterfactualPost) * 100).toFixed(1)) : 0;

    let classification: DiffInDiffResult['classification'] = 'NO_CAUSAL_EFFECT';
    let interpretation = '';

    if (!parallelTrendsPassed) {
      classification = 'PARALLEL_TRENDS_VIOLATION';
      interpretation = `Pre-intervention baseline divergence (${(parallelTrendsDiff * 100).toFixed(1)}%) violates parallel trends assumption.`;
    } else if (isSignificant) {
      classification = 'STATISTICALLY_SIGNIFICANT_LIFT';
      interpretation = `Intervention causally generated a +${(att * 100).toFixed(1)}% absolute recovery lift (p=${pValue} < 0.05, +${causalLiftPct}% relative lift vs holdout).`;
    } else if (att > 0) {
      classification = 'DIRECTIONALLY_POSITIVE';
      interpretation = `Positive estimated lift of +${(att * 100).toFixed(1)}%, but sample size is insufficient for p < 0.05 (p=${pValue}).`;
    } else {
      classification = 'NO_CAUSAL_EFFECT';
      interpretation = `Intervention showed no statistically detectable positive causal lift over natural recovery.`;
    }

    return {
      att: Number(att.toFixed(4)),
      att_display_pct: `${(att * 100).toFixed(1)}%`,
      y_treated_pre: Number(yTreatedPre.toFixed(4)),
      y_treated_post: Number(yTreatedPost.toFixed(4)),
      y_control_pre: Number(yControlPre.toFixed(4)),
      y_control_post: Number(yControlPost.toFixed(4)),
      delta_treated: Number(deltaTreated.toFixed(4)),
      delta_control: Number(deltaControl.toFixed(4)),
      standard_error: Number(se.toFixed(4)),
      z_score: Number(zScore.toFixed(2)),
      p_value: pValue,
      is_significant: isSignificant,
      parallel_trends_passed: parallelTrendsPassed,
      parallel_trends_diff: Number(parallelTrendsDiff.toFixed(4)),
      causal_lift_pct: causalLiftPct,
      classification,
      interpretation,
    };
  }

  /**
   * Partitions opportunities into Treated vs Synthetic Holdout groups and calculates ATT.
   */
  public static evaluateSyntheticHoldoutLift(
    opportunities: RecoveryOpportunity[],
    cutoffTimestamp: string
  ): DiffInDiffResult {
    const cutoff = new Date(cutoffTimestamp).getTime();

    const treatedPre = { recovered: 0, total: 0 };
    const treatedPost = { recovered: 0, total: 0 };
    const controlPre = { recovered: 0, total: 0 };
    const controlPost = { recovered: 0, total: 0 };

    for (const opp of opportunities) {
      const isPost = new Date(opp.created_at).getTime() >= cutoff;
      const isRecovered = opp.status === 'recovered';
      const isTreated = opp.status === 'executing' || opp.status === 'recovered' || opp.status === 'allocated' || opp.status === 'authorized';
      const isControl = opp.status === 'abstained' || opp.status === 'blocked';

      if (isTreated) {
        if (isPost) {
          treatedPost.total += 1;
          if (isRecovered) treatedPost.recovered += 1;
        } else {
          treatedPre.total += 1;
          if (isRecovered) treatedPre.recovered += 1;
        }
      } else if (isControl) {
        if (isPost) {
          controlPost.total += 1;
          if (isRecovered) controlPost.recovered += 1;
        } else {
          controlPre.total += 1;
          if (isRecovered) controlPre.recovered += 1;
        }
      }
    }

    return this.computeDiffInDiff({
      treatedPre,
      treatedPost,
      controlPre,
      controlPost,
    });
  }
}
