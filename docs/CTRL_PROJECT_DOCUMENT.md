# CTRL — AI Revenue Recovery Control Plane

## 1. Project Overview

**CTRL** is an autonomous AI-powered **Revenue Recovery Control Plane** designed to recover revenue lost from failed digital payments.

Unlike conventional payment-retry or dunning systems that simply retry a failed payment or send a fixed notification, CTRL treats every failed payment as a **recovery opportunity** and autonomously determines:

> **Should we intervene, when should we intervene, how should we intervene, and is that intervention economically worthwhile?**

The system continuously connects:

**Payment failure → AI investigation → economic evaluation → intervention allocation → authorized execution → customer recovery → provider verification → reconciliation → learning**

The most important characteristic is that **CTRL continues working even after the customer has left the original checkout page.**

For example:

```text
Customer attempts ₹5,000 payment
             ↓
       Razorpay Checkout
             ↓
       PAYMENT FAILED
             ↓
Customer closes webpage
             ↓
        Razorpay Webhook
             ↓
           CTRL
             ↓
     Autonomous Recovery
             ↓
   WhatsApp Recovery Link
             ↓
     Razorpay Payment Link
             ↓
     UPI / Google Pay
             ↓
      Payment Successful
             ↓
      Razorpay confirms
             ↓
          CTRL
             ↓
          RECOVERED
```

---

# 2. Problem Statement

## The problem

A large amount of potential revenue is lost **after a customer has already demonstrated purchase intent**.

Consider:

```text
Customer discovers product
        ↓
Adds product to cart
        ↓
Starts checkout
        ↓
Attempts payment
        ↓
Payment fails
        ↓
Customer leaves
```

The merchant may know that:

> "The payment failed."

But knowing that a payment failed is not enough.

The real questions are:

* Why did it fail?
* Is the customer likely to recover naturally?
* Is intervention actually worthwhile?
* Should the merchant contact the customer?
* Which recovery action should be used?
* When should the customer be contacted?
* How many times should CTRL intervene?
* Which failed payments deserve scarce recovery capacity?
* What is the expected incremental revenue?
* When should CTRL stop?
* Did the intervention actually cause additional recovery?
* Did the customer ultimately pay?

Traditional systems frequently reduce the problem to:

```text
Payment failed
     ↓
Retry
```

or:

```text
Payment failed
     ↓
Send reminder
```

This ignores the **economic value and opportunity cost of intervention**.

---

# 3. The Core Insight

CTRL reframes the problem.

Instead of:

> **"How do we retry failed payments?"**

CTRL asks:

> **"Given a portfolio of failed payments, where should the next unit of recovery effort be allocated to maximize incremental economic value?"**

This transforms failed-payment recovery into an **economic allocation problem**.

Each failed payment becomes a:

## Recovery Opportunity

```text
Recovery Opportunity
│
├── Customer
├── Payment
├── Amount
├── Failure reason
├── Historical behavior
├── Natural recovery probability
├── Intervention recovery probability
├── Incremental probability
├── Intervention cost
├── Customer fatigue
├── Confidence
├── Capacity
├── Recommended action
└── Expected incremental value
```

---

# 4. Proposed Solution

CTRL is an autonomous control plane that sits **above the payment infrastructure**.

```text
                    MERCHANT
                       │
                       ▼
                 Razorpay
                       │
                 Payment Event
                       │
                       ▼
              ┌─────────────────┐
              │      CTRL      │
              │                 │
              │  Observe        │
              │  Investigate    │
              │  Diagnose       │
              │  Evaluate       │
              │  Allocate       │
              │  Authorize      │
              │  Execute        │
              │  Reconcile      │
              │  Learn          │
              └────────┬────────┘
                       │
             Recovery intervention
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
        WhatsApp            Payment Link
                                 │
                                 ▼
                             Razorpay
                                 │
                                 ▼
                         UPI / Google Pay
                                 │
                                 ▼
                            Customer
```

CTRL does not replace Razorpay.

**Razorpay remains the payment authority.**

CTRL becomes the **intelligence and decision layer for revenue recovery**.

---

# 5. What Makes CTRL Different

CTRL is not simply:

* a payment gateway
* a retry engine
* a notification system
* a chatbot
* a dashboard
* an LLM wrapper
* a static rules engine

It combines:

### AI Agent
understands the situation.

### Economics Engine
determines whether intervention has positive expected incremental value.

### Recovery Market
allocates limited intervention capacity.

### Authority Layer
prevents unsafe actions.

### Execution Engine
actually performs the authorized recovery action.

### Provider Truth
determines what actually happened at Razorpay.

### Reconciliation
connects external payment truth back into CTRL.

### Learning
uses outcomes to improve future decisions.

---

# 6. Innovation

## 6.1 Recovery Opportunity Market

One of CTRL's strongest innovations is treating recovery opportunities as a **market**.

Suppose CTRL has:

```text
100 failed payments
```

but only enough operational capacity to actively recover:

```text
10 customers
```

A conventional system might process them sequentially.

CTRL ranks them economically.

Example:

| Opportunity |  Amount | Expected Incremental Value |
| ----------- | ------: | -------------------------: |
| A           | ₹10,000 |                     ₹2,900 |
| B           |  ₹4,000 |                     ₹1,850 |
| C           |  ₹8,000 |                     ₹1,420 |
| D           |  ₹2,500 |                       ₹950 |
| E           |  ₹6,000 |                       ₹730 |

The available recovery capacity is allocated to the highest-value opportunities.

---

# 7. IVEN — Incremental Value of Economic Notification

CTRL's economic layer uses **IVEN**.

The key idea is:

```text
Recovery with intervention
       -
Recovery without intervention
       =
Incremental recovery
```

The implemented calculation is based on:

```text
incremental probability =
max(
    0,
    intervention recovery probability
    -
    natural recovery probability
)
```

Then:

```text
Expected Incremental Value
=
incremental probability × payment amount
-
intervention costs
```

The existing implementation also models customer fatigue costs.

The current forensic analysis confirms this IVEN model and the implemented fatigue curve. 

This means CTRL doesn't simply ask:

> "Can this customer pay?"

It asks:

> **"How much additional value is expected because CTRL intervenes?"**

---

# 8. Customer Fatigue

Repeated communication can itself have a cost.

Therefore CTRL models intervention fatigue.

Current implementation includes:

```text
Attempt 1 → ₹0 fatigue cost
Attempt 2 → ₹2.50
Attempt 3 → ₹7.50
Attempt 4+ → increasing cost
```

This creates an economic reason to stop contacting customers unnecessarily. 

This is important because:

> **More intervention does not necessarily mean more recovery.**

---

# 9. Recovery Market and Shadow Price

CTRL also models limited recovery capacity.

Eligible opportunities are ranked by expected incremental value.

When capacity is limited:

```text
Highest-value opportunities
        ↓
ACT

Remaining opportunities
        ↓
WAIT
```

The marginal accepted opportunity establishes the:

## Shadow Price

```text
Shadow Price =
IVEN of the last accepted opportunity
```

This gives CTRL an economic answer to:

> "How valuable must another recovery opportunity be before it deserves intervention capacity?"

The existing allocator implements this ranking, capacity cutoff and shadow-price concept. 

---

# 10. AI Agent

CTRL is designed as an actual autonomous agent rather than an LLM-generated recommendation.

Its lifecycle is:

```text
TRIGGERED
    ↓
OBSERVE
    ↓
INVESTIGATE
    ↓
DIAGNOSE
    ↓
HYPOTHESIZE
    ↓
PLAN
    ↓
VALIDATE PLAN
    ↓
PROPOSE
    ↓
WAIT AUTHORITY
    ↓
EXECUTE
    ↓
OBSERVE OUTCOME
    ↓
LEARN
    ↓
MEMORY UPDATE
    ↓
COMPLETE
```

This state-machine architecture is already implemented in the project. 

---

# 11. What the Agent Investigates

For a failed payment, CTRL can inspect:

* payment information
* failure reason
* payment history
* previous attempts
* customer history
* contact history
* customer fatigue
* gateway state
* historical failure patterns
* similar cases
* recovery capacity
* market state
* previous agent decisions
* reconciliation state
* provider state

The existing agent architecture already contains read-only tools for these areas, plus proposal tools. 

---

# 12. Why the LLM Does Not Control Money

This is a fundamental security architecture decision.

The LLM can say:

> "I recommend creating a recovery payment link."

But it cannot directly execute that action.

Instead:

```text
LLM Agent
    ↓
Proposal
    ↓
Economic Engine
    ↓
Market Allocation
    ↓
Action Authority
    ↓
Executor
    ↓
Razorpay
```

The existing Action Authority performs deterministic checks including hard-decline handling, retry caps, kill switch, confidence and capacity. 

This provides:

## AI autonomy without AI financial authority.

---

# 13. Real Razorpay Integration

The current CTRL architecture uses the official Razorpay Node SDK and maintains tenant/environment-specific Razorpay clients.

The existing implementation is configured around Razorpay Test Mode credentials. 

The intended real flow is:

```text
Razorpay payment
      ↓
payment.failed
      ↓
Webhook
      ↓
CTRL
```

CTRL then creates a recovery opportunity.

---

# 14. Failed Payment → Dashboard

This is one of the most important requested capabilities.

When a customer attempts:

```text
₹5,000
```

and Razorpay reports:

```text
payment.failed
```

CTRL should automatically produce:

```text
┌─────────────────────────────────────────┐
│ PAYMENT FAILED                          │
│                                         │
│ Amount             ₹5,000               │
│ Razorpay Payment   pay_xxxxx            │
│ Failure            Insufficient Funds   │
│ Attempt            1                    │
│ Status             RECOVERY OPEN        │
│                                         │
│ IVEN               ₹1,996               │
│ Confidence         HIGH                 │
│ Market Decision    ACT                  │
│ Agent              INVESTIGATING        │
└─────────────────────────────────────────┘
```

No manual database insertion should be required.

---

# 15. Customer Leaves the Website

This is where CTRL becomes particularly valuable.

The original customer journey ends:

```text
Payment failed
     ↓
Customer closes browser
```

But CTRL's process continues:

```text
Payment failed
     ↓
Razorpay webhook
     ↓
CTRL
     ↓
Recovery opportunity
     ↓
AI investigation
     ↓
Recovery decision
```

The customer does not need to remain on the merchant's webpage.

---

# 16. Autonomous Recovery

Suppose the failed payment is:

```text
₹5,000
Reason: insufficient_funds
```

CTRL may determine:

```text
Natural recovery probability = 35%
Intervention probability = 55%

Incremental probability = 20%

Expected incremental cash =
₹5,000 × 20%
= ₹1,000
```

After costs:

```text
IVEN > 0
```

Therefore:

```text
ACT
```

If the expected incremental value is negative:

```text
ABSTAIN
```

That is a major design principle.

> **CTRL is allowed to do nothing.**

---

# 17. Razorpay Recovery Payment Link

Once authorized:

```text
Action Authority
       ↓
Executor
       ↓
Razorpay Payment Link API
       ↓
Recovery Link
```

The existing execution architecture already protects this boundary and prevents unauthorized callers from directly creating payment links. 

---

# 18. WhatsApp Recovery

The recovery link can then be delivered through an authorized WhatsApp Business/API integration.

Example:

> **Your payment could not be completed.**
>
> Your ₹5,000 payment is still pending.
>
> Complete your payment securely here:
>
> **Pay ₹5,000**
>
> `<Razorpay Recovery Link>`

The architecture keeps:

```text
Payment Provider
```

and:

```text
Communication Provider
```

as separate adapters.

```text
CTRL
 ├── Razorpay Adapter
 │       └── Payment Link
 │
 └── WhatsApp Adapter
         └── Customer notification
```

This makes the system extensible to other compliant channels later.

---

# 19. UPI / Google Pay Recovery

CTRL does not need to directly integrate with Google's payment infrastructure.

Instead:

```text
CTRL
    ↓
Razorpay Payment Link
    ↓
Razorpay Checkout
    ↓
UPI
    ↓
Google Pay where supported
    ↓
Razorpay
```

The customer uses the payment method available in the Razorpay payment experience.

This preserves Razorpay as the payment authority.

---

# 20. Provider Truth

One of the most important CTRL principles is:

# `LINK_CREATED ≠ RECOVERED`

Creating a payment link proves only:

```text
Recovery action executed
```

It does not prove:

```text
Customer paid
```

The existing Provider Truth implementation requires provider-confirmed success/captured state, positive amount paid and a real provider payment ID before recovery can be recognized. 

Therefore:

```text
Payment Link Created
       ↓
Customer may ignore it
       ↓
No recovery
```

or:

```text
Payment Link Created
       ↓
Customer pays
       ↓
Razorpay confirms
       ↓
RECOVERED
```

---

# 21. Reconciliation

CTRL reconciles external Razorpay state with its internal state.

Example:

```text
CTRL:
EXECUTING

Razorpay:
PAYMENT CAPTURED

        ↓

CTRL:
RECOVERED
```

The existing reconciliation architecture handles successful and unsuccessful transitions and protects against out-of-order events. 

---

# 22. Double-Entry Ledger

When provider-confirmed recovery occurs:

```text
Debit:
bank_settlement

Credit:
recovered_revenue
```

The current ledger is cryptographically hash chained and mathematically balanced. The forensic analysis records equal debit and credit totals. 

This provides an auditable financial history.

---

# 23. End-to-End Working Concept

The complete CTRL lifecycle is:

```text
┌───────────────────────┐
│ Customer              │
│ Attempts Payment      │
└──────────┬────────────┘
           ↓
┌───────────────────────┐
│ Razorpay Checkout     │
└──────────┬────────────┘
           ↓
       PAYMENT FAILED
           ↓
┌───────────────────────┐
│ Razorpay Webhook      │
└──────────┬────────────┘
           ↓
┌───────────────────────┐
│ Webhook Verification  │
└──────────┬────────────┘
           ↓
┌───────────────────────┐
│ Recovery Opportunity  │
└──────────┬────────────┘
           ↓
┌───────────────────────┐
│ CTRL Dashboard      │
└──────────┬────────────┘
           ↓
┌───────────────────────┐
│ AI Agent              │
│ Investigate/Diagnose  │
└──────────┬────────────┘
           ↓
┌───────────────────────┐
│ IVEN                  │
│ Economic Evaluation   │
└──────────┬────────────┘
           ↓
┌───────────────────────┐
│ Recovery Market       │
│ Capacity Allocation   │
└──────────┬────────────┘
           ↓
┌───────────────────────┐
│ Action Authority      │
└──────────┬────────────┘
           ↓
       AUTHORIZED
           ↓
┌───────────────────────┐
│ Razorpay Executor     │
└──────────┬────────────┘
           ↓
┌───────────────────────┐
│ Payment Link          │
└──────────┬────────────┘
           ↓
┌───────────────────────┐
│ WhatsApp              │
└──────────┬────────────┘
           ↓
        Customer
           ↓
    UPI / Google Pay
           ↓
┌───────────────────────┐
│ Razorpay              │
└──────────┬────────────┘
           ↓
   Provider Confirmation
           ↓
┌───────────────────────┐
│ Reconciliation        │
└──────────┬────────────┘
           ↓
       RECOVERED
           ↓
┌───────────────────────┐
│ Double Entry Ledger   │
└──────────┬────────────┘
           ↓
┌───────────────────────┐
│ Agent Learning        │
└───────────────────────┘
```

---

# 24. System Architecture

## High-Level Architecture

```text
                       ┌───────────────────┐
                       │     CUSTOMER      │
                       └─────────┬─────────┘
                                 │
                                 ▼
                       ┌───────────────────┐
                       │     RAZORPAY      │
                       │ Payment Gateway   │
                       └─────────┬─────────┘
                                 │
                    payment.failed webhook
                                 │
                                 ▼
                    ┌──────────────────────┐
                    │ Webhook Ingress      │
                    │ HMAC + Idempotency   │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Webhook Queue        │
                    │ Async Processing     │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Recovery Opportunity │
                    │ Service              │
                    └──────────┬───────────┘
                               │
                ┌──────────────┼───────────────┐
                │              │               │
                ▼              ▼               ▼
          ┌──────────┐  ┌────────────┐  ┌────────────┐
          │ Economics│  │ AI Agent   │  │ Customer   │
          │ IVEN     │  │ Orchestrator │ Context    │
          └────┬─────┘  └─────┬──────┘  └────────────┘
               │              │
               └───────┬──────┘
                       ▼
                ┌──────────────┐
                │ Recovery     │
                │ Market       │
                └──────┬───────┘
                       ▼
                ┌──────────────┐
                │ Authority    │
                │ Gate         │
                └──────┬───────┘
                       ▼
                ┌──────────────┐
                │ Executor     │
                └──────┬───────┘
                       │
              ┌────────┴─────────┐
              ▼                  ▼
       ┌────────────┐     ┌────────────┐
       │ Razorpay   │     │ WhatsApp   │
       │ Payment    │     │ Provider   │
       │ Link       │     └────────────┘
       └─────┬──────┘
             │
             ▼
        Customer pays
             │
             ▼
       ┌─────────────┐
       │ Razorpay    │
       │ Provider    │
       │ Truth       │
       └──────┬──────┘
              ▼
       ┌─────────────┐
       │Reconciliation│
       └──────┬──────┘
              ▼
       ┌─────────────┐
       │ Ledger      │
       └──────┬──────┘
              ▼
       ┌─────────────┐
       │ Learning /  │
       │ Memory      │
       └─────────────┘
```

---

# 25. Technology Stack

## Backend
* **Node.js 22**
* **TypeScript**
* **Express**
* REST APIs
* Background workers
* Autonomous recovery daemon

## Frontend
* **Next.js 16.3.3**
* **React 19.2.8**
* **Tailwind CSS 4**
* App Router

## Database
* **SQLite** (`node:sqlite` in WAL mode) for zero-setup local execution
* **PostgreSQL / Supabase** dual-mode synchronization

## Payment Infrastructure
* **Razorpay Official Node SDK**
* Payment Links API
* Webhooks with HMAC verification
* Test Mode & capability discovery

## AI
* 15-state deterministic Agent orchestrator
* LLM reasoning layer (Nemotron / OpenAI / Anthropic compliant)
* Structured proposal generation
* Read-only inspection tools
* Episodic & working memory with causal counterfactual evaluation

## Security & Safety
* Strict Zero-Trust financial boundaries
* Deterministic Action Authority (Hard decline, retry caps, kill switch, fatigue limits)
* Cryptographic hash-chained double-entry ledger
* Multi-tenant data and client isolation

---

# 26. Current Background Architecture

CTRL features autonomous infrastructure designed to handle recovery out-of-band:

* **Autonomous Recovery Daemon**: Periodically sweeps recovery opportunities, scores them, performs market allocation, evaluates authority checks, and executes actions.
* **Webhook Queue Worker**: Ingests and processes incoming provider events asynchronously with idempotency, exponential backoff retries, and dead-letter queue (DLQ) tracking.

---

# 27. Summary of Core Capabilities

1. **Failed Payment Ingress**: Native HMAC verification of `payment.failed` webhooks.
2. **Opportunity Lifecycle**: State machine (`pending` → `scored` → `allocated` → `executing` → `recovered` / `blocked` / `abstained`).
3. **IVEN Economic Scoring**: Evaluates incremental revenue net of operational and customer fatigue costs.
4. **Capacity-Constrained Recovery Market**: Shadow pricing and greedy knapsack allocation.
5. **Deterministic Action Authority**: Five independent non-negotiable safety gates.
6. **Zero-Trust Financial Execution**: AI cannot execute writes directly; only authorized commands trigger Razorpay Payment Links.
7. **Provider Truth Verification**: Enforces `LINK_CREATED != RECOVERED` through direct provider webhook & capture confirmation.
8. **Double-Entry Financial Ledger**: Tamper-evident hash-chained entries (`bank_settlement` / `recovered_revenue`).
9. **Omnichannel Customer Bridge**: Razorpay Payment Links delivered via WhatsApp/SMS enabling UPI (GPay/PhonePe/Paytm) checkout.
10. **Explainable AI**: Natural language explanations generated strictly from stored audit fields, never on the direct execution path.
