# CTRL V11: Enterprise Production Runbook & Operations Manual

> **System Version:** `11.0.0`  
> **Classification:** Enterprise Autonomous Economic Control Plane  
> **Target Environment:** Production / High-Availability Multi-Tenant Cloud  
> **Last Updated:** September 2026

---

## 1. System Architecture & Topology

CTRL V11 operates as an autonomous economic control plane for failed-payment recovery. It prioritizes recovery capacity using net incremental economic value (**IVEN**), enforces a deterministic compliance gate (**Action Authority**), and runs continuous Bayesian learning loops over payment outcomes.

```
                  ┌────────────────────────────────────────────────────────┐
                  │                 NGINX Reverse Proxy / CDN               │
                  └───────────────────────────┬────────────────────────────┘
                                              │
                    ┌─────────────────────────┴─────────────────────────┐
                    │                                                   │
     ┌──────────────▼──────────────┐                     ┌──────────────▼──────────────┐
     │  API Gateway & Control Pod  │                     │  Next.js 16 Web Dashboard   │
     │  (Express + OTEL Tracing)   │                     │  (V11 Command Center & SSE) │
     └──────────────┬──────────────┘                     └─────────────────────────────┘
                    │
         ┌──────────┼───────────────────────┐
         │          │                       │
┌────────▼───┐ ┌────▼────────┐       ┌──────▼──────────────────────────┐
│ PostgreSQL │ │   Redis 7   │◄──────┤ Decoupled Horizontal Workers    │
│  Supabase  │ │ Queue/Cache │       │ (LPUSH/BRPOP Queue + OTEL Spans)│
└────────────┘ └─────────────┘       └─────────────────────────────────┘
```

---

## 2. Emergency Operations & Incident Response

### 2.1 Engaging the Emergency Kill Switch
If unexpected behavior occurs, engage the global or tenant-specific Kill Switch immediately. When engaged, **Action Authority halts all automated payment link creation**.

- **Option A: HTTP REST API**
  ```bash
  curl -X POST http://localhost:3001/v1/tenants/kill-switch \
    -H "Authorization: Bearer <ADMIN_JWT>" \
    -H "Content-Type: application/json" \
    -d '{"active": true, "reason": "Emergency operational pause"}'
  ```

- **Option B: Redis Distributed Broadcast (< 50ms propagation)**
  ```bash
  redis-cli PUBLISH ctrl:kill_switch "true"
  ```

- **Option C: Command Center Dashboard**
  Navigate to `/dashboard/command-center` and click **"ENGAGE EMERGENCY KILL SWITCH"**.

---

### 2.2 Circuit Breaker Tripped (Razorpay / Downstream API)
When 5 consecutive network or 5xx failures occur, the Circuit Breaker trips to `OPEN` for 60 seconds, preventing cascade failure.

- **Status Check:**
  ```bash
  curl http://localhost:3001/health/deep | jq .checks.safety_controls
  ```
- **Manual Reset:**
  ```bash
  redis-cli DEL "ctrl:cb:razorpay_payment_links"
  ```

---

### 2.3 Dead Letter Queue (DLQ) & Human-in-the-Loop (HITL)
Failed payment link executions follow exponential backoff: `[0.5, 2, 5, 15, 60]` minutes. After 5 exhausted attempts, jobs escalate to `DEAD_LETTER` status and require human review.

- **Inspect Pending & Dead-Letter Retries:**
  ```sql
  SELECT id, opportunity_id, failure_count, last_error, status, next_retry_at 
  FROM dlq_jobs 
  WHERE status IN ('PENDING_RETRY', 'DEAD_LETTER') 
  ORDER BY id DESC;
  ```

- **Trigger Batch Replay:**
  ```bash
  curl -X POST http://localhost:3001/v1/execution/replay-dlq \
    -H "Authorization: Bearer <ADMIN_JWT>" \
    -H "Content-Type: application/json" \
    -d '{"limit": 25}'
  ```

---

## 3. Routine Operations & Maintenance

### 3.1 Health Check Endpoints & Kubernetes Probes

| Probe Endpoint | Purpose | SLA / Timeout |
| :--- | :--- | :--- |
| `GET /health/live` | Node.js event-loop liveness | 200 OK (< 50ms) |
| `GET /health/ready` | DB, Redis, and encryption readiness | 200 OK (< 200ms) |
| `GET /health/readiness`| Kubernetes readiness probe alias | 200 OK (< 200ms) |
| `GET /health/deep` | Subsystem diagnostics, queue depths, SLO burn rate | 200 OK (< 500ms) |

---

### 3.2 Running Decoupled Background Workers

To scale background workers horizontally under Docker Compose:

```bash
docker compose up -d --scale worker=3
```

Workers automatically dequeue tasks via Redis `BRPOP` across:
- `AGENT_REASONING_CYCLE`
- `MARKET_ALLOCATION_RUN`
- `EXECUTION_DISPATCH`
- `RECONCILIATION_SWEEP`
- `DLQ_RETRY_SWEEP`

---

### 3.3 Database Backup & Migration Verification

- **Create Immutable SQLite Snapshot:**
  ```bash
  npx tsx scripts/backup_sqlite.ts
  ```
- **Run PostgreSQL Migration Stream (500-row batches):**
  ```bash
  npx tsx scripts/migrate_sqlite_to_postgres.ts
  ```
- **Verify Cryptographic Ledger Continuity:**
  ```bash
  curl -H "Authorization: Bearer <JWT>" http://localhost:3001/v1/audit/verify-ledger
  ```

---

## 4. Service Level Objectives (SLO) & Error Budget Alerts

CTRL V11 enforces Google SRE multi-window burn rate tracking against a 99.9% availability objective:

| Metric | Target | Error Budget | Warning Alert | Critical P1 Alert |
| :--- | :--- | :--- | :--- | :--- |
| **API Availability** | 99.9% | 0.1% | Burn Rate > 2.0x (1h) | Burn Rate > 14.4x (Burns 2% budget in 1h) |
| **Request Latency** | 99.0% < 500ms | 1.0% | P95 > 400ms | P95 > 750ms |
| **Payment Link Creation** | 99.5% < 2000ms | 0.5% | P95 > 1500ms | P95 > 3000ms |

---

## 5. Security & Key Rotation Procedures

### 5.1 JWT Signing Secret Rotation
1. Update `JWT_SECRET` in environment or secret manager.
2. Existing refresh tokens remain valid until expiration (7 days) unless explicitly revoked.
3. To revoke a compromised token:
   ```bash
   redis-cli SADD "ctrl:token:blacklist" "<JTI_IDENTIFIER>"
   ```

### 5.2 Razorpay API Key & Webhook Secret Rotation
1. Generate new Key ID & Secret in Razorpay Merchant Dashboard.
2. Update tenant credential via API:
   ```bash
   curl -X POST http://localhost:3001/v1/integrations/credentials \
     -H "Authorization: Bearer <ADMIN_JWT>" \
     -d '{"provider": "razorpay", "key_id": "rzp_live_xxx", "key_secret": "yyy"}'
   ```
3. Update Webhook Secret: CTRL validates signatures using constant-time comparison (`crypto.timingSafeEqual`).

---

## 6. Verification Checklist Before Production Sign-Off

- [x] TypeScript Strict Mode: `npx tsc --noEmit` passes with 0 errors.
- [x] All 11 V11 automated test suites pass (100% pass rate).
- [x] Regression suite `tests/v6/test_autonomous_agent.ts` passes 9/9.
- [x] Truth engine audit `npm run verify:v6-truth` passes with 0 discrepancies.
- [x] Next.js Turbopack frontend build passes with 0 errors.
- [x] OpenTelemetry spans active across Jaeger receiver.
- [x] Multi-tenant row isolation tested with zero cross-tenant row contamination.
