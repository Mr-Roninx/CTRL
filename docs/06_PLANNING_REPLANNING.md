# CTRL-AGENT Planning & Replanning Engine

## 1. Structured Plan Formulation
Plans are constructed with explicit goals, step sequences, candidate action pools, and critical validity assumptions:

```json
{
  "plan_version": 1,
  "goal": "Recover payment opportunity synth_02",
  "steps": ["Observe context", "Evaluate gateway", "Bridge signals", "Market allocation", "Execution"],
  "validity_assumptions": [
    { "parameter": "gateway_health", "condition": ">=", "expected_value": 0.75 },
    { "parameter": "capacity_available", "condition": ">=", "expected_value": 1 }
  ],
  "candidate_actions": ["WAIT", "SEND_PAYMENT_LINK"],
  "preferred_action": "SEND_PAYMENT_LINK"
}
```

## 2. Dynamic Invalidation & Replanning Flow
1. While an opportunity is in `WAIT` state, changes in telemetry (gateway degradation, customer contact limit reached, or capacity exhaustion) trigger validation.
2. If `validateActivePlan()` finds any assumption violated, the state machine transitions to `PLAN_INVALIDATED`.
3. `AgentReplanEngine.executeReplan()` creates revised Plan version $N+1$ and transitions through `REPLAN` $\to$ `PLAN` $\to$ `VALIDATE_PLAN`.
4. Maximum replan count per mission is hard-capped at 3.
