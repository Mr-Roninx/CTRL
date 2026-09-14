---
name: Agent Development Rule
description: Guidelines for building the CTRL agent loop.
priority: 100
---

# Agent Development

1. Do not use an infinite loop. Use `MAX_STEPS` and `MAX_REPLANS`.
2. The agent must follow strict phases: OBSERVE -> INVESTIGATE -> HYPOTHESIZE -> PLAN -> FEASIBILITY_CHECK -> AUTHORITY_CHECK -> RISK_CHECK -> EXECUTE -> WAIT -> EVALUATE -> LEARN -> REPLAN -> ESCALATE -> COMPLETE.
3. Re-planning is triggered by significant prediction errors.
