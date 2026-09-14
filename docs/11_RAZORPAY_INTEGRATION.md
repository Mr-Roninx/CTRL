# CTRL-AGENT Razorpay Integration Architecture

## 1. Razorpay Test Mode Operational Model
- **Environment**: Razorpay Test Mode only (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`).
- **Isolation Invariant**: `src/execution/executor.ts` is the **sole** file in the entire repository that imports the Razorpay SDK or calls `razorpay.paymentLink.create()`.
- **Zero Agent Direct Access**: No agent class or tool has direct access to the Razorpay SDK instance.
- **Batch Link Creation Cap**: Max 5 payment links per batch run (well under test mode limit of 30).
- **Monetary Unit**: All internal calculations and database records are stored in integer **paise** and formatted as ₹ (Rupees) in all displays.

## 2. Webhook & Poller Synchronization
1. **Real Ingestion (`/webhooks/razorpay`)**: Validates HMAC-SHA256 signature using `RAZORPAY_WEBHOOK_SECRET`. Sets `source = 'real'`.
2. **Reconciliation Poller**: Queries `paymentLink.fetch()` on timer and writes durable `ledger_entries` with event type `recovered` or `not_recovered`.
3. **Truth Grounding**: Ground-truth reconciliation triggers agent learning, Brier score calculation, and episodic memory persistence.
