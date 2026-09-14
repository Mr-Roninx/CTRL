# CTRL-AGENT Causal Experiments & Benchmarks

## 1. Experimental Methodology
CTRL-AGENT undergoes paired causal benchmarking across five controlled configurations:
1. `DETERMINISTIC_BASELINE`: Pure deterministic scoring and market allocation.
2. `LLM_ONLY`: LLM intent without tools or memory.
3. `LLM_WITH_TOOLS`: LLM + 18 bounded tools.
4. `LLM_WITH_MEMORY`: LLM + tools + working/episodic memory.
5. `FULL_AGENT`: Complete agent with dynamic assumption validation and replanning.

## 2. Experimental Outcomes (17 Durable Artifacts in `results/agent/`)
- `runtime.json`: Execution environment configuration.
- `llm_truth.json`: Real NVIDIA NIM token, latency, and reasoning logs.
- `agent_trace.json`: State machine step traces.
- `tool_trace.json`: Tool invocation inputs, outputs, and latencies.
- `plans.json`: Initial structured plans and assumption sets.
- `replans.json`: Replan triggering evidence and Plan v2 artifacts.
- `memory.json`: Working, episodic, and semantic memory state.
- `semantic_signals.json`: Signal bounds and modifier calculations.
- `economic_effect.json`: Empirical IVEN deltas.
- `market_effect.json`: Market allocations and shadow price dynamics.
- `authority.json`: Action Authority compliance verification.
- `execution.json`: Razorpay payment link records.
- `provider_truth.json`: Provider connectivity and settlement logs.
- `reconciliation.json`: Webhook and poller reconciliation logs.
- `security.json`: Security gate verification logs.
- `causal_influence.json`: Causal classification summary.
- `benchmark.json`: Multi-mission benchmark results.
