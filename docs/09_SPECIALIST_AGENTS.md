# CTRL-AGENT Specialist Agents Specification

## 1. Specialist Agent Roster

CTRL-AGENT employs five specialized sub-agents orchestrated by the central `AgentOrchestrator`:

### 1. Perception Agent (`src/agents/specialists/perception_agent.ts`)
- **Mission**: Context enrichment, failure taxonomy mapping, and heuristic urgency/risk evaluation.
- **Allowed Tools**: `get_opportunity`, `get_payment_context`, `get_customer_history`, `get_failure_history`, `create_perception_annotation`.
- **Output**: Persisted `perception_annotations` records.

### 2. Strategy Agent (`src/agents/specialists/strategy_agent.ts`)
- **Mission**: Offline evaluation of parameter calibrations and policy optimization.
- **Allowed Tools**: `get_failure_history`, `get_similar_cases`, `get_agent_memory`, `create_strategy_proposal`.
- **Safety Gate**: Requires minimum sample size $N \ge 30$ outcomes before submitting proposals.

### 3. Outreach Agent (`src/agents/specialists/outreach_agent.ts`)
- **Mission**: Drafting customer notifications across SMS and WhatsApp.
- **Allowed Tools**: `get_opportunity`, `get_customer_history`, `get_contact_history`, `create_outreach_draft`.
- **Safety Gate**: Drafts only (`PENDING_REVIEW`). Never auto-dispatches. Appends mandatory regulatory opt-out compliance footers.

### 4. Compliance Copilot (`src/agents/specialists/compliance_copilot.ts`)
- **Mission**: Explaining decisions to compliance and risk auditors.
- **Allowed Tools**: `get_full_audit_trail`, `get_opportunity`.
- **Data Source**: Reads durable SQLite tables (`authority_checks`, `ledger_entries`, `scores`) directly; zero hallucinations.

### 5. Merchant Copilot (`src/agents/specialists/merchant_copilot.ts`)
- **Mission**: Answering merchant operational queries about capacity, gateway health, and recovery metrics.
- **Allowed Tools**: `get_market_state`, `get_gateway_state`, `get_recovery_capacity`, `get_failure_history`.
