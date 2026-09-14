---
name: Financial Safety Rule
description: Rules for modifying financial states.
priority: 100
---

# Financial Safety

1. Never write to the database directly from an LLM.
2. Never touch raw payment API without going through the Financial FSM and Execution Tool.
3. All actions must be validated through the authority, risk, and policy engines.
4. "UNKNOWN" payment states block blind retries.
