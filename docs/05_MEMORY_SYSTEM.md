# CTRL-AGENT Memory System & Temporal Firewall

## 1. Multi-Tier Memory Store
CTRL-AGENT utilizes three distinct memory stores:

1. **Working Memory (`memory_type = 'working'`)**: Short-term mission scratchpad storing intermediate perceptions, tool outputs, and diagnostic notes during active mission execution.
2. **Episodic Memory (`memory_type = 'episodic'`)**: Historical case episodes recording context summary, action taken, predicted probability, actual settlement truth, and prediction error ($|\hat{P} - Y|$).
3. **Semantic Memory (`memory_type = 'semantic'`)**: Generalized heuristic facts extracted from episodic clusters (e.g. `pattern:bank_timeouts`, `cluster:weekend_soft_declines`).

## 2. Temporal Memory Firewall (Anti-Lookahead)
To prevent lookahead bias and oracle leakage in both production simulations and historical replays:
- Every memory query requires a `cutoffTimestamp` ($T_{cutoff}$).
- All returned memories must satisfy $T_{created} \le T_{cutoff}$.
- Records with timestamps $T_{created} > T_{cutoff}$ are strictly excluded.
