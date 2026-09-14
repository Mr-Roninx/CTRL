# CTRL-AGENT Semantic-to-Economics Bridge

## 1. Overview
The bridge provides a mathematically bounded translation layer between qualitative LLM signals and the deterministic Expected Incremental Value (`IVEN`) calculation.

## 2. Bounded Signal Clamping & Modifiers

$$\Delta P_{calibrated} = \text{clamp}(\Delta P_{base} + \delta_P, 0.0, 0.95)$$

$$\text{Fatigue Cost}_{calibrated} = \text{Fatigue Cost}_{base} + \delta_{\text{fatigue}}$$

$$\text{IVEN}_{calibrated} = (\Delta P_{calibrated} \times \text{Amount Paise}) - \text{Operational Cost} - \text{Fatigue Cost}_{calibrated}$$

### Bounded Modifier Ranges
- `transient_failure`: $\delta_P \in [-0.05, +0.08]$
- `gateway_instability`: $\delta_P \in [-0.06, 0.00]$
- `customer_liquidity`: $\delta_P \in [-0.04, +0.05]$
- `fatigue`: $\delta_{\text{fatigue}} \in [0, +500 \text{ paise}]$

### Hard Invariant
For hard declines (`decline_type = 'hard'`), $\Delta P$ is strictly clamped to $0.0$, guaranteeing that no adversarial LLM signal can ever make a hard decline have a positive IVEN.
