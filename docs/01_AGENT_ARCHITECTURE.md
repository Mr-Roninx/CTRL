# CTRL-AGENT: Autonomous Economic Control Plane Architecture

## 1. System Philosophy & Executive Summary

CTRL-AGENT is an autonomous, tool-using, memory-enabled, planning and replanning AI Agent that operates strictly above the deterministic financial control plane of CTRL.

### Core Architectural Invariant
```
┌────────────────────────────────────────────────────────┐
│                   CTRL AI AGENT                      │
│   (Perception, Reasoning, Planning, Memory, Signals)   │
└───────────────────────────┬────────────────────────────┘
                            │ Proposes Semantic Signals / Modifiers
                            ▼
┌────────────────────────────────────────────────────────┐
│             DETERMINISTIC FINANCIAL CORE               │
│ (Economics Scorer → Recovery Market → Action Authority)│
└───────────────────────────┬────────────────────────────┘
                            │ Sole Write Authority (Zero Bypass)
                            ▼
┌────────────────────────────────────────────────────────┐
│             RAZORPAY PAYMENT GATEWAY                   │
│               (Test Mode API Truth)                    │
└────────────────────────────────────────────────────────┘
```

> **Invariant**: AI = intelligence, deterministic CTRL = authority, Razorpay = external payment truth.

No AI model or prompt output ever possesses the capability to execute a payment link, modify ledger state, or override Action Authority rules.

---

## 2. Component Layer Breakdown

1. **State Machine (`src/agents/state_machine.ts`)**: 21-state explicit transition graph persisted to SQLite in real time.
2. **Agent Authority Gate (`src/agents/gate.ts`)**: 9-check deterministic security and sanity barrier evaluated before every tool call.
3. **Tool Registry (`src/agents/tool_registry.ts`)**: 14 Read-Only inspection tools + 4 Proposal-only bus tools. Zero financial write tools.
4. **Memory Store & Temporal Firewall (`src/agents/memory.ts`, `src/agents/temporal_firewall.ts`)**: Working, Episodic, and Semantic memory with strict anti-lookahead timestamp filtering ($T_{created} \le T_{cutoff}$).
5. **Planning & Replanning Engine (`src/agents/planner.ts`, `src/agents/replan_engine.ts`)**: Structured plans with explicit validity assumptions. When environment assumptions break mid-flight, automatically transitions to `REPLAN` to generate Plan $N+1$.
6. **Semantic-to-Economics Bridge (`src/agents/bridge.ts`)**: Bounded translation of LLM qualitative diagnoses to numerical probability and fatigue modifiers for IVEN calculation.
7. **Outcome Evaluation & Learning (`src/agents/learning.ts`)**: Compares provider settlement against predictions, calculates Brier calibration scores, and persists durable episodic records.
8. **Specialist Agents (`src/agents/specialists/`)**:
   - `PerceptionAgent`: Context enrichment and feature synthesis.
   - `StrategyAgent`: Offline strategy calibration ($\ge 30$ sample threshold).
   - `OutreachAgent`: Drafts customer communications with mandatory compliance footers.
   - `ComplianceCopilot`: Explains decisions by reading the SQLite audit trail directly.
   - `MerchantCopilot`: Answers merchant operational and capacity queries.
