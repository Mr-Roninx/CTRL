# CTRL-AGENT Tool Registry Specification

## 1. Registered Tools Overview
The Agent Tool Registry defines 18 bounded, sandboxed tools: 14 Read-Only inspection tools and 4 Proposal-only bus tools.

| Tool Name | Type | Permission | Description |
|-----------|------|------------|-------------|
| `get_opportunity` | READ | READ | Inspect raw failed payment opportunity details |
| `get_payment_context` | READ | READ | Fetch enriched payment telemetry and bank switch codes |
| `get_customer_history` | READ | READ | Query historical customer success rate & lifetime value |
| `get_payment_attempts` | READ | READ | List prior attempt records for this invoice/customer |
| `get_failure_history` | READ | READ | Aggregate failure trends across reason codes |
| `get_gateway_state` | READ | READ | Real-time Razorpay gateway health, latency & method uptime |
| `get_contact_history` | READ | READ | Customer communication fatigue & contact timestamps |
| `get_market_state` | READ | READ | Capacity utilization, limit (5), and current shadow price |
| `get_recovery_capacity` | READ | READ | Current available payment link quota in active batch |
| `get_reconciliation_state` | READ | READ | Razorpay webhook & poller settlement synchronization |
| `get_provider_status` | READ | READ | Provider connectivity status & environment check |
| `get_full_audit_trail` | READ | READ | Append-only ledger entries and compliance checks |
| `get_similar_cases` | READ | READ | Query historical nearest-neighbor failed payments |
| `get_agent_memory` | READ | READ | Query episodic and semantic memories behind temporal firewall |
| `create_agent_proposal` | PROPOSAL | PROPOSAL | Submit candidate recovery proposal to proposal bus |
| `create_perception_annotation` | PROPOSAL | PROPOSAL | Enrich opportunity with semantic failure intent & urgency |
| `create_strategy_proposal` | PROPOSAL | PROPOSAL | Propose parameter calibration (requires $\ge 30$ samples) |
| `create_outreach_draft` | PROPOSAL | PROPOSAL | Generate customer notification draft with mandatory compliance footer |

## 2. Invariants
- Zero Financial Write Tools: No tool can execute `paymentLink.create()`, modify `recovery_opportunities.status`, or write to `ledger_entries`.
- All tool executions pass through `AgentAuthorityGate.evaluate()` before execution.
