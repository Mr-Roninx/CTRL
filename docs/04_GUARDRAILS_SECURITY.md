# CTRL-AGENT Guardrails & Security Model

## 1. Agent Authority Gate (9 Deterministic Security Checks)
Before any tool call or action proposal is dispatched, the `AgentAuthorityGate` executes 9 security checks:

1. **Kill Switch Check**: If `isKillSwitchActive()` is true, immediately blocks tool call and aborts mission.
2. **Agent Identity Check**: Validates that caller is a registered specialist agent.
3. **Tool Scope Check**: Ensures requested tool belongs to the agent's allowed permission set.
4. **Mission Budget Check**: Rejects tool call if mission limits (steps, LLM calls, tool calls, timeouts) are exceeded.
5. **Rate Limit Check**: Enforces tool-specific queries per minute limits.
6. **Write Boundary Check**: Disallows any write tool or financial mutation.
7. **Environment Check**: Enforces Razorpay Test Mode restrictions.
8. **Injection Taint Check**: Analyzes input payload for hostile prompt injection or SQL injection patterns.
9. **Loop Guard Check**: Fingerprints consecutive identical tool calls to prevent reasoning loops.

## 2. Hard Budget Limits
- Max LLM calls per mission: 8
- Max Tool calls per mission: 20
- Max Replans per mission: 3
- Max Total steps per mission: 40
- Max Wall-clock timeout: 30,000ms
