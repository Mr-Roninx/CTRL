# CTRL — Live Demo & Hackathon Proof of Work

This document provides **concrete, reproducible proof** that CTRL is fully operational end-to-end across every layer of the architecture.

---

## 1. Quick Proof Commands (Run Directly)

You can run any of these commands in your terminal right now to verify the system live:

```bash
# 1. 19-Step End-to-End Black Box Merchant Acceptance (Complete Lifecycle)
npm run test:black-box

# 2. 10/10 Full-Stack Integration Verification (Auth, RBAC, Razorpay, API Keys)
npm run test:e2e

# 3. Master 24-Suite Automated Test Battery (62 Test Cases)
npm test

# 4. Causal Inference & Counterfactual Benchmark (8 Empirical Experiments)
npm run experiments:causal

# 5. Master Truth Engine & Cryptographic Integrity Audit
npm run verify:v6-truth
```

---

## 2. What Each Layer Proves

### Step 1: Merchant Ingress & Tenancy Isolation
* **Test**: Step 1–4 of `npm run test:black-box`
* **What it proves**: 
  - Dynamic tenant provisioning (`tnt_...`).
  - Cryptographic API key hashing (`ctrl_live_...` / `ctrl_test_...`).
  - Strict zero-trust database isolation (cross-tenant access fails closed).

### Step 2: Live Razorpay Test Mode Gateway Connection
* **Test**: Step 5 of `npm run test:black-box`
* **What it proves**:
  - Live SDK handshake with Razorpay Test Mode API using Key ID & Secret.
  - Active capability discovery (Payment Links, Webhooks, Customers).

### Step 3: Payment Failure Ingress & Perception
* **Test**: Step 7 & 8 of `npm run test:black-box`
* **What it proves**:
  - Ingests raw `payment.failed` event (`BAD_REQUEST_PAYMENT_CARD_EXPIRED`, ₹3,500).
  - Creates a canonical `RecoveryOpportunity` (`pay_accept_...`).
  - Idempotent deduplication blocks duplicate event processing.

### Step 4: Autonomous Specialist Investigation & Zero-Trust Safety
* **Test**: Step 9 of `npm run test:black-box`
* **What it proves**:
  - `PerceptionAgent` analyzes customer liquidity and transient failure flags.
  - `OutreachAgent` generates personalized customer communication drafts in `PENDING_REVIEW`.
  - **Zero Financial Authority Invariant**: None of the agents can execute payment links or financial mutations directly.

### Step 5: IVEN Economic Reasoning Engine
* **Test**: Step 10 of `npm run test:black-box`
* **What it proves**:
  - Calculates `natural_recovery_prob` (0.05) vs `intervention_recovery_prob` (0.60).
  - Evaluates `incremental_prob = max(0, 0.60 - 0.05) = 0.55`.
  - Factors operational costs (₹4.00) and customer fatigue penalty (₹0.00 at attempt 1).
  - Yields positive IVEN = **₹1,921.00**, producing economic decision **`ACT`**.

### Step 6: Portfolio Recovery Market Allocation
* **Test**: Step 11 of `npm run test:black-box`
* **What it proves**:
  - Runs greedy knapsack ranking under portfolio capacity limits (e.g. max 5 links).
  - Computes the dynamic **Shadow Price** of the marginal accepted opportunity.

### Step 7: Deterministic Action Authority Gate (5 Checks)
* **Test**: Step 12 of `npm run test:black-box`
* **What it proves**:
  - Evaluates 5 non-negotiable compliance rules:
    1. `hard_decline_check`: PASSED (Card expired is a recoverable soft decline).
    2. `retry_cap_check`: PASSED (Attempt 1 < limit 3).
    3. `kill_switch_check`: PASSED (System operating normally).
    4. `confidence_recheck`: PASSED (Sufficient scoring confidence).
    5. `capacity_recheck`: PASSED (Allocated in active market batch).
  - Emits official **`AUTHORIZED`** verdict.

### Step 8: Execution Engine, Razorpay Link & WhatsApp Dispatch
* **Test**: Step 13 of `npm run test:black-box`
* **What it proves**:
  - Calls official Razorpay Node SDK `paymentLink.create(...)`.
  - Generates live hosted checkout short URL (e.g. `https://rzp.io/rzp/...`).
  - Dispatches interactive WhatsApp Recovery Notification with 1-click payment CTA.
  - Queries Razorpay API independently to confirm link is registered on gateway.

### Step 9: Authoritative Reconciliation & Double-Entry Ledger
* **Test**: Step 14 of `npm run test:black-box`
* **What it proves**:
  - Preserves **`LINK_CREATED != RECOVERED`** truth invariant.
  - Balances double-entry cryptographic ledger (Debits = Credits).
  - Chains entries with SHA-256 hashes (`prev_hash` -> `entry_hash`).

### Step 10: Bayesian Self-Calibration & Learning Loop
* **Test**: Step 15 of `npm run test:black-box` & `npm run experiments:causal`
* **What it proves**:
  - Updates Bayesian Beta priors $(\alpha, \beta)$ with verified outcomes.
  - Computes Brier prediction error for continuous accuracy improvement.

---

## 3. Live Dashboard Demo Walkthrough

To showcase the live UI to judges:

1. **Start the backend server**:
   ```bash
   npm run dev
   ```
2. **Start the frontend Next.js dashboard**:
   ```bash
   npm --prefix frontend run dev
   ```
3. **Open browser at**:
   - `http://localhost:3000/dashboard` — Live Command Center (Revenue at risk, Recovered ROI, Shadow Price).
   - `http://localhost:3000/dashboard/opportunities` — Real-time opportunity pipeline with IVEN breakdown.
   - `http://localhost:3000/dashboard/market` — Knapsack Portfolio Allocation & Shadow Price Curve.
   - `http://localhost:3000/dashboard/execution` — Razorpay Payment Links & WhatsApp delivery logs.
   - `http://localhost:3000/dashboard/audit` — Cryptographic Double-Entry Ledger & Explanation Drawer.
   - `http://localhost:3000/dashboard/playground` — Interactive simulation bench & Chaos stress test.

---

## 4. Key Takeaways for Judges

| Evaluation Pillar | CTRL Live Proof |
| :--- | :--- |
| **Why not standard retries?** | Conventional retries blindly spam payment gateways. CTRL models incremental revenue (IVEN) net of customer fatigue and scarce recovery capacity. |
| **Is the AI safe with money?** | The LLM has **zero financial authority**. It only inspects and proposes; deterministic Action Authority must authorize any execution. |
| **How does it reach users?** | Omnichannel customer recovery via WhatsApp/SMS delivering verified Razorpay Links compatible with UPI (Google Pay, PhonePe, Paytm). |
| **How is truth verified?** | `LINK_CREATED != RECOVERED`. Recovery is only recognized when Razorpay confirms captured funds, backed by a cryptographic double-entry ledger. |
