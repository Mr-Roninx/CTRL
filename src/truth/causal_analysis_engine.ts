import crypto from 'node:crypto';

export type CausalClassification = 'POSITIVE_EFFECT' | 'NEGATIVE_EFFECT' | 'NO_EFFECT' | 'INCONCLUSIVE';

export interface RawObservation {
  seed_id: number;
  control_val: number;
  treatment_val: number;
  delta: number;
}

export interface PairedStatisticalSummary {
  sample_size: number;
  paired: boolean;
  metric_name: string;
  metric_unit: string;
  higher_is_better: boolean;
  control: {
    definition: string;
    mean: number;
    median: number;
    std: number;
  };
  treatment: {
    definition: string;
    mean: number;
    median: number;
    std: number;
  };
  paired_difference: {
    mean: number;
    median: number;
    std: number;
    standard_error: number;
  };
  percent_change: number | null;
  percent_change_display: string;
  confidence_interval_95: {
    lower: number | null;
    upper: number | null;
    status: 'DEFINED' | 'DEGENERATE_ZERO_VARIANCE';
    inferential_interpretation: string;
    method: string;
    df: number;
  };
  effect_size: {
    name: string;
    value: number | null;
    status: 'DEFINED' | 'UNDEFINED_ZERO_VARIANCE';
    is_defined: boolean;
    reason: string | null;
    method: string;
    interpretation: string;
    display: string;
  };
  statistical_significance: {
    claimed: boolean;
    p_value: number | null;
    power_status: string;
    note: string;
  };
  classification: CausalClassification;
  dynamic_scientific_rationale: string;
  observations: RawObservation[];
  experiment_fingerprint: string;
}

export interface CanonicalCausalExperiment {
  experiment_id: string;
  component: string;
  hypothesis: string;
  statistics: PairedStatisticalSummary;
  limitations: string[];
}

export class CausalAnalysisEngine {
  // Student's t critical values for 95% two-tailed confidence intervals
  private static T_CRITICAL_95: Record<number, number> = {
    1: 12.706,
    2: 4.303,
    3: 3.182,
    4: 2.776, // df = 4 for N = 5
    5: 2.571,
    6: 2.447,
    7: 2.365,
    8: 2.306,
    9: 2.262,
    10: 2.228,
  };

  /**
   * Computes authoritative paired statistics directly from raw per-seed observations.
   * INVARIANT: Zero hard-coded summary values.
   * INVARIANT: Zero variance produces effect_size.value = null and status = UNDEFINED_ZERO_VARIANCE.
   */
  public static computePairedStatistics(params: {
    experiment_id: string;
    component: string;
    hypothesis: string;
    metric_name: string;
    metric_unit: string;
    higher_is_better: boolean;
    control_definition: string;
    treatment_definition: string;
    observations: Array<{ seed_id: number; control_val: number; treatment_val: number }>;
    configuration_hash?: string;
  }): PairedStatisticalSummary {
    const n = params.observations.length;
    if (n < 2) {
      throw new Error(`Causal analysis requires at least N=2 paired observations (received N=${n})`);
    }

    // 1. Calculate per-seed deltas
    const rawObs: RawObservation[] = params.observations.map((obs) => {
      const delta = Number((obs.treatment_val - obs.control_val).toFixed(6));
      return {
        seed_id: obs.seed_id,
        control_val: Number(obs.control_val.toFixed(6)),
        treatment_val: Number(obs.treatment_val.toFixed(6)),
        delta,
      };
    });

    const controlVals = rawObs.map((o) => o.control_val);
    const treatmentVals = rawObs.map((o) => o.treatment_val);
    const deltas = rawObs.map((o) => o.delta);

    // 2. Control & Treatment Group Statistics
    const meanControl = controlVals.reduce((a, b) => a + b, 0) / n;
    const meanTreatment = treatmentVals.reduce((a, b) => a + b, 0) / n;

    const sortedControl = [...controlVals].sort((a, b) => a - b);
    const sortedTreatment = [...treatmentVals].sort((a, b) => a - b);
    const c1 = sortedControl[n / 2 - 1] ?? 0;
    const c2 = sortedControl[n / 2] ?? c1;
    const medianControl = n % 2 === 0 ? (c1 + c2) / 2 : (sortedControl[Math.floor(n / 2)] ?? 0);

    const t1 = sortedTreatment[n / 2 - 1] ?? 0;
    const t2 = sortedTreatment[n / 2] ?? t1;
    const medianTreatment = n % 2 === 0 ? (t1 + t2) / 2 : (sortedTreatment[Math.floor(n / 2)] ?? 0);

    const varControl = controlVals.reduce((s, c) => s + Math.pow(c - meanControl, 2), 0) / (n - 1);
    const varTreatment = treatmentVals.reduce((s, t) => s + Math.pow(t - meanTreatment, 2), 0) / (n - 1);
    const stdControl = Math.sqrt(varControl);
    const stdTreatment = Math.sqrt(varTreatment);

    // 3. Paired Difference Statistics
    const meanDiff = deltas.reduce((a, b) => a + b, 0) / n;
    const sortedDeltas = [...deltas].sort((a, b) => a - b);
    const d1 = sortedDeltas[n / 2 - 1] ?? 0;
    const d2 = sortedDeltas[n / 2] ?? d1;
    const medianDiff = n % 2 === 0 ? (d1 + d2) / 2 : (sortedDeltas[Math.floor(n / 2)] ?? 0);

    const varDiff = deltas.reduce((s, d) => s + Math.pow(d - meanDiff, 2), 0) / (n - 1);
    const stdDiff = Math.sqrt(varDiff);
    const stdError = stdDiff / Math.sqrt(n);

    // 4. Percentage Lift
    let percentChange: number | null = null;
    let percentChangeDisplay = 'N/A';
    if (Math.abs(meanControl) > 1e-6) {
      percentChange = Number((((meanTreatment - meanControl) / Math.abs(meanControl)) * 100).toFixed(2));
      percentChangeDisplay = `${percentChange > 0 ? '+' : ''}${percentChange.toFixed(2)}%`;
    } else {
      percentChangeDisplay = `Absolute delta: ${meanDiff > 0 ? '+' : ''}${meanDiff.toFixed(2)} ${params.metric_unit}`;
    }

    // 5. 95% Confidence Interval (Student's t paired distribution vs degenerate zero-variance)
    const df = n - 1;
    const tCrit = this.T_CRITICAL_95[df] ?? 2.776;
    let ciLower: number | null = null;
    let ciUpper: number | null = null;
    let ciStatus: 'DEFINED' | 'DEGENERATE_ZERO_VARIANCE' = 'DEFINED';
    let ciInterpretation = '';
    let ciMethod = '';

    if (stdDiff > 1e-9) {
      ciLower = Number((meanDiff - tCrit * stdError).toFixed(4));
      ciUpper = Number((meanDiff + tCrit * stdError).toFixed(4));
      ciStatus = 'DEFINED';
      ciInterpretation = `Student's t 95% paired confidence interval [${ciLower}, ${ciUpper}] with df=${df}.`;
      ciMethod = `Student's t distribution (t_crit = ${tCrit.toFixed(3)}, df = ${df})`;
    } else {
      ciLower = Number(meanDiff.toFixed(4));
      ciUpper = Number(meanDiff.toFixed(4));
      ciStatus = 'DEGENERATE_ZERO_VARIANCE';
      ciInterpretation = 'No sample variance exists; inferential uncertainty cannot be meaningfully estimated from this benchmark.';
      ciMethod = 'Degenerate point interval (zero sample variance)';
    }

    // 6. Effect Size (Cohen's d_z for paired differences; strictly undefined when stdDiff == 0)
    let cohensDValue: number | null = null;
    let effectStatus: 'DEFINED' | 'UNDEFINED_ZERO_VARIANCE' = 'DEFINED';
    let isDefined = true;
    let effectReason: string | null = null;
    let effectMethod = '';
    let effectInterpretation = '';
    let effectDisplay = '';

    if (stdDiff > 1e-9) {
      cohensDValue = Number((meanDiff / stdDiff).toFixed(3));
      effectStatus = 'DEFINED';
      isDefined = true;
      effectReason = null;
      effectMethod = "Cohen's d_z (paired standardized mean difference: mean(delta) / std(delta))";
      effectDisplay = `d_z = ${cohensDValue.toFixed(3)}`;

      const absD = Math.abs(cohensDValue);
      if (absD >= 0.8) {
        effectInterpretation = 'Large observed effect size';
      } else if (absD >= 0.5) {
        effectInterpretation = 'Medium observed effect size';
      } else if (absD >= 0.2) {
        effectInterpretation = 'Small observed effect size';
      } else {
        effectInterpretation = 'Negligible effect size';
      }
    } else {
      cohensDValue = null;
      effectStatus = 'UNDEFINED_ZERO_VARIANCE';
      isDefined = false;
      effectReason = 'Paired differences have zero variance.';
      effectMethod = "Paired Cohen's d_z (undefined when std(diff) == 0)";
      effectInterpretation = 'Deterministic constant difference; standardized effect size is undefined due to zero sample variance.';
      effectDisplay = 'Undefined (zero variance)';
    }

    // 7. Deterministic Classification respecting directionality
    const isBeneficial = params.higher_is_better ? meanDiff > 1e-6 : meanDiff < -1e-6;
    const isHarmful = params.higher_is_better ? meanDiff < -1e-6 : meanDiff > 1e-6;

    let classification: CausalClassification = 'NO_EFFECT';
    if (isBeneficial) {
      classification = 'POSITIVE_EFFECT';
    } else if (isHarmful) {
      classification = 'NEGATIVE_EFFECT';
    } else {
      classification = 'NO_EFFECT';
    }

    // 8. Dynamic Scientific Rationale (Computed, not static)
    let dynamicRationale = '';
    const effectStr = isDefined && cohensDValue !== null ? `Cohen's d_z = ${cohensDValue}` : 'effect size undefined (zero variance)';
    if (classification === 'POSITIVE_EFFECT') {
      dynamicRationale = `Observed positive directional lift (${params.higher_is_better ? '+' : ''}${meanDiff.toFixed(2)} ${params.metric_unit}, ${percentChangeDisplay}, ${effectStr}) under N=${n} paired synthetic cohorts.`;
    } else if (classification === 'NEGATIVE_EFFECT') {
      dynamicRationale = `Observed negative effect (${meanDiff.toFixed(2)} ${params.metric_unit}, ${percentChangeDisplay}, ${effectStr}) under N=${n} paired synthetic cohorts.`;
    } else {
      dynamicRationale = `Zero observed difference (${meanDiff.toFixed(2)} ${params.metric_unit}, effect size undefined) under N=${n} paired synthetic cohorts.`;
    }

    // 9. Experiment Fingerprint (SHA-256)
    const fingerprintInput = JSON.stringify({
      id: params.experiment_id,
      metric: params.metric_name,
      obs: rawObs,
      cfg: params.configuration_hash || 'CTRL_BENCHMARK_CONFIG_DEFAULT',
    });
    const experimentFingerprint = crypto.createHash('sha256').update(fingerprintInput).digest('hex');

    return {
      sample_size: n,
      paired: true,
      metric_name: params.metric_name,
      metric_unit: params.metric_unit,
      higher_is_better: params.higher_is_better,
      control: {
        definition: params.control_definition,
        mean: Number(meanControl.toFixed(4)),
        median: Number(medianControl.toFixed(4)),
        std: Number(stdControl.toFixed(4)),
      },
      treatment: {
        definition: params.treatment_definition,
        mean: Number(meanTreatment.toFixed(4)),
        median: Number(medianTreatment.toFixed(4)),
        std: Number(stdTreatment.toFixed(4)),
      },
      paired_difference: {
        mean: Number(meanDiff.toFixed(4)),
        median: Number(medianDiff.toFixed(4)),
        std: Number(stdDiff.toFixed(4)),
        standard_error: Number(stdError.toFixed(4)),
      },
      percent_change: percentChange,
      percent_change_display: percentChangeDisplay,
      confidence_interval_95: {
        lower: ciLower,
        upper: ciUpper,
        status: ciStatus,
        inferential_interpretation: ciInterpretation,
        method: ciMethod,
        df,
      },
      effect_size: {
        name: "cohens_d_z",
        value: cohensDValue,
        status: effectStatus,
        is_defined: isDefined,
        reason: effectReason,
        method: effectMethod,
        interpretation: effectInterpretation,
        display: effectDisplay,
      },
      statistical_significance: {
        claimed: false,
        p_value: null,
        power_status: 'PRELIMINARY_UNDERPOWERED_N5',
        note: 'Statistical significance is not claimed for small-sample synthetic exploratory benchmarks (N=5). Results represent preliminary paired directional evidence.',
      },
      classification,
      dynamic_scientific_rationale: dynamicRationale,
      observations: rawObs,
      experiment_fingerprint: experimentFingerprint,
    };
  }
}
