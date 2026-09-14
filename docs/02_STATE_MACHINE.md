# CTRL-AGENT State Machine Specification

## 1. State Machine Overview
The agent operates under a strict 21-state explicit transition graph. Every transition is validated against `VALID_STATE_TRANSITIONS` and durably persisted to SQLite table `agent_states`.

## 2. Complete State Enumeration
1. `IDLE` - Initial dormant state awaiting mission ingestion.
2. `TRIGGERED` - Failed payment event received and mission initialized.
3. `OBSERVE` - Primary observation gathering (payment, customer, gateway).
4. `INVESTIGATE` - Tool-assisted context exploration by specialist agents.
5. `DIAGNOSE` - Root-cause analysis and failure classification.
6. `HYPOTHESIZE` - Counterfactual hypothesis generation.
7. `PLAN` - Bounded execution plan generation with explicit validity assumptions.
8. `VALIDATE_PLAN` - Pre-execution validation of plan assumptions against live telemetry.
9. `PROPOSE` - Submitting semantic modifiers to the deterministic bridge.
10. `WAIT_AUTHORITY` - Awaiting deterministic Market Allocation & Action Authority checks.
11. `EXECUTE` - Invoking Razorpay executor if and only if AUTHORIZED.
12. `WAIT` - Temporal waiting for external async signals (customer response, settlement).
13. `WAKE` - Triggered by timeout, webhook, or operator action.
14. `OBSERVE_OUTCOME` - Retrieving Razorpay settlement ground truth.
15. `LEARN` - Computing prediction error (Brier score) and net economic gain.
16. `MEMORY_UPDATE` - Persisting durable episodic and semantic memories.
17. `PLAN_INVALIDATED` - Assumption violated mid-flight; triggers replan.
18. `REPLAN` - Formulating Plan version $N+1$.
19. `HUMAN_REVIEW` - Awaiting operator sign-off (e.g. strategy adjustments).
20. `ABORTED` - Mission terminated early (kill switch, budget limit, fatal error).
21. `COMPLETE` - Mission successfully closed and reconciled.

## 3. Transition Invariants
- Direct jumps from `TRIGGERED` to `COMPLETE` or `EXECUTE` are rejected with runtime exceptions.
- Replanning path: `WAIT` $\to$ `WAKE` $\to$ `PLAN_INVALIDATED` $\to$ `REPLAN` $\to$ `PLAN`.
- Kill switch triggers immediate transition to `ABORTED` from any non-terminal state.
