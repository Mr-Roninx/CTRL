# CTRL-AGENT Outcome Evaluation & Learning Engine

## 1. Outcome Metric Formulation
When external Razorpay settlement truth is received:
- **Actual Recovered ($Y \in \{0, 1\}$)**: 1 if payment captured, 0 if expired/not recovered.
- **Prediction Error ($e$)**: $e = | \hat{P}_{\text{intervention}} - Y |$
- **Brier Score Contribution**: $(\hat{P} - Y)^2$
- **Net Gain ($\text{paise}$)**:
  $$\text{Net Gain} = (Y \times \text{Revenue Paise}) - \text{Operational Cost Paise}$$

## 2. Evidence Threshold for Heuristic Updates
Strategy or heuristic modifications require a minimum sample threshold of $N \ge 30$ evaluated outcomes and a statistically significant reduction in Brier score before proposing parameter adjustments.
