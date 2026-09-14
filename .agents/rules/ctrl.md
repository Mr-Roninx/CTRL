---
trigger: always_on
---

You are building **CTRL**, an autonomous economic control plane for failed-payment recovery on Razorpay. Read this in full before starting any task, and re-check it before deviating from anything below.

### The one-line pitch
CTRL doesn't ask "can we recover this payment?" It asks "is recovering this payment worth spending our next unit of limited recovery capacity?" — and it only acts when the answer survives a deterministic compliance check.

### Why this project exists (don't lose this framing)
Razorpay, Stripe, Adyen, and Zuora already do smart per-payment retry timing. That is NOT what we're building. We are building the layer above it: a system that treats every failed payment as a **Recovery Opportunity** competing against every other opportunity for scarce, costly recovery capacity (payment links, human attention, contact budget), and that can rationally choose to do **nothing** when acting isn't worth it.

### Non-negotiable design principles
1. Every failed payment becomes a `RecoveryOpportunity` record. Never act on a raw webhook event directly — always go through the pipeline.
2. Score by **incremental** probability, not raw probability: `incremental_prob = intervention_recovery_prob − natural_recovery_prob`. A payment that was going to recover on its own is worth acting on only if action meaningfully improves the odds.
3. Every opportunity resolves to exactly one of three decisions: **ACT / WAIT / ABSTAIN**. Never force an action just because a probability is nonzero.
4. Allocation happens at the **portfolio level**, under explicit capacity limits (e.g. max payment links per run) — not opportunity-by-opportunity. Expose the **shadow price** (the value of the marginal accepted opportunity) whenever capacity binds.
5. **Action Authority is a separate, deterministic gate that runs after allocation and can veto an ACT decision**, independent of economics (hard decline codes, retry caps, a kill switch). Compliance can override a good economic case. This two-stage design (economic decision, then compliance veto) is intentional — keep it as two distinct stages, not merged.
6. If an LLM is used anywhere, it may only **explain** a decision in natural language. It never outputs an action, an amount, or anything that gets executed. No LLM sits on the execution path.
7. Every stage writes its reasoning to a durable log/table as it happens. The audit trail and the "Why?" screen are built by **reading stored fields**, never by generating an explanation after the fact.
8. Every probability or "recovery rate" shown anywhere in the UI must be visibly labeled as **model-estimated**, not measured fact — because we never observe the counterfactual for a real payment.
9. Razorpay **Test Mode only**. Cap real payment-link creation per run well under the 30-links/test-mode limit (use 5).

### Explicitly do NOT build (cut for the 4-day scope — do not silently add these back)
- No CP-SAT / OR-Tools solver. Greedy allocation sorted by expected incremental value is sufficient and far easier to explain live.
- No hash-chained ledger. An append-only timestamped log table is enough.
- No LLM as decision-maker, and no LLM anywhere on the execution path.
- No trained ML model. Hand-coded, clearly-labeled probability tables are expected and fine.
- No claims of production-readiness or live-money execution, anywhere — code comments, UI copy, or README.
- No checkout-abandonment or invoice-collections modules. This build is Razorpay failed-payment recovery only.

### Tech stack (fixed — ask before deviating)
- Backend: Node.js + TypeScript + Express
- Storage: SQLite (file-based, zero setup) — one table per schema object below
- Frontend: React + Vite + Tailwind, single page
- Payments: official Razorpay Node SDK, Test Mode keys from `.env` (never commit keys; ship `.env.example`)
- All monetary values stored in paise (Razorpay convention), displayed in ₹

### Core schema (the contract — every feature must read/write these exact field names)

```
RecoveryOpportunity
  id, source [real|synthetic], amount_paise, currency,
  reason_code, decline_type [hard|soft|unknown],
  attempt_count, customer_id, customer_trust_score,
  created_at, status [pending|scored|allocated|deferred|blocked|abstained|executing|recovered|not_recovered]

Score (1:1 with Opportunity)
  natural_recovery_prob, intervention_recovery_prob, incremental_prob,
  operational_cost_paise, fatigue_cost_paise,
  expected_incremental_value_paise (IVEN), confidence [low|medium|high]

AllocationDecision
  opportunity_id, decision [ACT|WAIT|ABSTAIN], rank_in_batch,
  shadow_price_paise_at_decision, reason

AuthorityCheck (many:1 with Opportunity)
  opportunity_id, check_name, passed [bool], reason

ExecutionRecord
  opportunity_id, razorpay_payment_link_id, link_url, status, idempotency_key, created_at

LedgerEntry
  opportunity_id, event_type [webhook_received|reconciled|recovered|not_recovered],
  amount_paise, timestamp, raw_payload_ref
```

### Shared conventions for every feature
- Ship a seed script producing the fixed test scenarios listed in that feature's prompt — these scenarios are your acceptance criteria AND your demo script, keep them identical.
- Every module logs structured entries to one place the dashboard reads from directly.
- Verify each feature standalone (curl/Postman or browser) before moving to the next.
- Update `PROGRESS.md` (create it if absent) after each feature: what's built, what's verified, what's deferred.
- Commit after each feature passes its acceptance criteria.

### Build order — do not skip ahead
1. Event Fabric  2. Perception  3. Economic Reasoning  4. Recovery Market  5. Action Authority  6. Execution  7. Truth Engine + Dashboard
