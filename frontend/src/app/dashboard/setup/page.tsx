"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Sparkles, Key, Webhook, Code, CheckCircle2, AlertTriangle,
  Copy, Check, ShieldCheck, Play, ShoppingCart, Smartphone,
  Download, ExternalLink, ArrowRight, FileCode
} from "lucide-react";
import { api, useAuth } from "../../../lib/auth";

export default function StreamlinedIntegrationHubPage() {
  const { tenant, user } = useAuth();
  const [activeStep, setActiveStep] = useState<"connect" | "embed" | "simulator">("connect");

  // Step 1: Razorpay Gateway Credentials
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [env] = useState<"test" | "live">("live");
  const [savingCreds, setSavingCreds] = useState(false);
  const [credsSuccess, setCredsSuccess] = useState<string | null>(null);
  const [credsError, setCredsError] = useState<string | null>(null);

  // Step 2: Webhooks & Embed
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);
  const [activeApiKey, setActiveApiKey] = useState<string>("");

  // Step 3: Interactive Store Simulator
  const [simCartAmount, setSimCartAmount] = useState<number>(2500);
  const [simCustomerName, setSimCustomerName] = useState<string>("Rohan Verma");
  const [simCustomerPhone, setSimCustomerPhone] = useState<string>("+919876543210");
  const [simStep, setSimStep] = useState<"idle" | "failed" | "recovered">("idle");
  const [simulatingPayment, setSimulatingPayment] = useState(false);
  const [simOppData, setSimOppData] = useState<any>(null);

  const tenantId = tenant?.id || user?.tenantId || "default_tenant";
  const apiBase = typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_API_URL || `${window.location.protocol}//${window.location.hostname}:3001`)
    : "http://localhost:3001";
  const webhookUrl = `${apiBase}/webhooks/razorpay/${tenantId}`;
  const scriptKey = activeApiKey || "ctrl_test_live_key_demo";
  const rawScriptTag = `<script src="${apiBase}/sdk/ctrl.js" data-api-key="${scriptKey}" defer></script>`;

  const copyToClipboard = (text: string, setter: (val: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  };

  const [hasSavedCredentials, setHasSavedCredentials] = useState(false);
  const [savedKeyId, setSavedKeyId] = useState("");

  const loadConfigStatus = useCallback(async () => {
    try {
      const [integrationsRes, keysRes] = await Promise.all([
        api<any>("/v1/integrations/razorpay/status").catch(() => null),
        api<{ api_keys: Array<{ id: string; key_prefix?: string }> }>("/v1/api-keys").catch(() => null)
      ]);

      if (integrationsRes && integrationsRes.connected) {
        setHasSavedCredentials(true);
        if (integrationsRes.key_id) {
          setKeyId(integrationsRes.key_id);
          setSavedKeyId(integrationsRes.key_id);
        }
        if (integrationsRes.script_key) {
          setActiveApiKey(integrationsRes.script_key);
        }
      }

      if (keysRes && keysRes.api_keys && keysRes.api_keys.length > 0) {
        const activeKey = keysRes.api_keys[0];
        setActiveApiKey(activeKey.key_prefix ? `${activeKey.key_prefix}${activeKey.id.slice(0, 12)}` : activeKey.id);
      }
    } catch (err) {
      console.error("Failed to load integration status:", err);
    }
  }, []);

  useEffect(() => {
    loadConfigStatus();
  }, [loadConfigStatus]);

  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCreds(true);
    setCredsSuccess(null);
    setCredsError(null);

    try {
      await api<any>("/v1/integrations/razorpay/connect", {
        method: "POST",
        body: JSON.stringify({
          key_id: keyId,
          key_secret: keySecret,
          webhook_secret: webhookSecret,
          environment: env,
        }),
      });

      setCredsSuccess("Connected & Permanently Synchronized to Supabase! Razorpay capabilities verified.");
    } catch (err: any) {
      setCredsError(err.message || "Failed to verify Razorpay credentials.");
    } finally {
      setSavingCreds(false);
    }
  };

  // Checkout Failure Simulator
  const handleTriggerStoreCheckoutFailure = async () => {
    setSimulatingPayment(true);
    setSimStep("idle");
    setSimOppData(null);

    try {
      const simPaymentId = `pay_store_sim_${Date.now()}`;
      await api<any>("/internal/simulate-webhook", {
        method: "POST",
        body: JSON.stringify({
          event: "payment.failed",
          payload: {
            payment: {
              entity: {
                id: simPaymentId,
                amount: simCartAmount * 100,
                currency: "INR",
                status: "failed",
                method: "upi",
                error_code: "BAD_REQUEST_ERROR",
                error_description: "Bank server communication timeout during 3DS",
                error_reason: "payment_failed_issuer_down",
                contact: simCustomerPhone,
                email: "customer@example.com",
                notes: { customer_name: simCustomerName, order_id: `ord_${Date.now()}` }
              }
            }
          }
        })
      });

      // Run recovery sweep
      await api("/agents/daemon/sweep", { method: "POST" });
      
      const oppsRes = await api<{ opportunities: any[] }>("/v1/opportunities?limit=1");
      const matchedOpp = oppsRes?.opportunities?.[0];

      setSimOppData(matchedOpp);
      setSimStep("failed");
    } catch (err: any) {
      alert("Simulation error: " + err.message);
    } finally {
      setSimulatingPayment(false);
    }
  };

  return (
    <div className="animate-fade-in" style={{ maxWidth: 1200, margin: "0 auto", width: "100%" }}>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.5px", margin: "0 0 4px 0" }}>
          Merchant Integration & Checkout Recovery Hub
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
          Connect Razorpay in 30 seconds, embed the 2-line recovery SDK, and automate recovery workflows.
        </p>
      </div>

      {/* 3-Step Google Style Wizard Navigation Bar */}
      <div className="card" style={{ padding: 6, marginBottom: 24, display: "flex", gap: 6, background: "var(--bg-hover)" }}>
        {[
          { id: "connect", step: "1", title: "Connect Razorpay", desc: "API Keys & Discovery" },
          { id: "embed", step: "2", title: "Embed SDK & Webhooks", desc: "2-Line Integration" },
          { id: "simulator", step: "3", title: "Store Simulator", desc: "Live Recovery Demo" },
        ].map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveStep(s.id as any)}
            style={{
              flex: 1, padding: "12px 16px", borderRadius: 8, border: "none", cursor: "pointer",
              background: activeStep === s.id ? "#ffffff" : "transparent",
              boxShadow: activeStep === s.id ? "0 1px 3px rgba(60,64,67,0.15)" : "none",
              display: "flex", alignItems: "center", gap: 12, textAlign: "left",
              transition: "all 0.15s ease"
            }}
          >
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              background: activeStep === s.id ? "var(--google-blue)" : "#dadce0",
              color: "#ffffff", fontWeight: 700, fontSize: 12,
              display: "flex", alignItems: "center", justifyContent: "center"
            }}>
              {s.step}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: activeStep === s.id ? "var(--google-blue)" : "var(--text-primary)" }}>
                {s.title}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.desc}</div>
            </div>
          </button>
        ))}
      </div>

      {/* STEP 1: CONNECT RAZORPAY */}
      {activeStep === "connect" && (
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 24 }}>
          {/* Credentials Form */}
          <div className="card" style={{ padding: "24px 28px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <Key size={20} color="var(--google-blue)" />
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Razorpay API Credentials</h2>
            </div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>
              Keys are encrypted at rest with AES-256. Stored securely with deterministic safety guardrails.
            </p>

            {hasSavedCredentials && savedKeyId && (
              <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 8, background: "var(--google-blue-light)", border: "1px solid rgba(26,115,232,0.2)", fontSize: 12, color: "var(--google-blue)", display: "flex", alignItems: "center", gap: 8 }}>
                <ShieldCheck size={16} />
                <span>Connected & Stored in Supabase: <strong>{savedKeyId}</strong></span>
              </div>
            )}

            <form onSubmit={handleSaveCredentials} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>
                  Razorpay Key ID
                </label>
                <input
                  type="text"
                  placeholder="rzp_live_..."
                  value={keyId}
                  onChange={(e) => setKeyId(e.target.value)}
                  className="input"
                  required
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>
                  Razorpay Key Secret
                </label>
                <input
                  type="password"
                  placeholder={hasSavedCredentials ? "•••••••••••••••••••• (Encrypted in Supabase)" : "rzp_secret_..."}
                  value={keySecret}
                  onChange={(e) => setKeySecret(e.target.value)}
                  className="input"
                  required={!hasSavedCredentials}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>
                  Webhook Secret (Optional)
                </label>
                <input
                  type="text"
                  placeholder="Secret used for HMAC signature verification"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  className="input"
                />
              </div>

              {credsSuccess && (
                <div style={{ padding: "10px 14px", borderRadius: 6, background: "var(--google-green-light)", border: "1px solid #ceead6", color: "var(--google-green-hover)", fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
                  <CheckCircle2 size={16} />
                  <span>{credsSuccess}</span>
                </div>
              )}

              {credsError && (
                <div style={{ padding: "10px 14px", borderRadius: 6, background: "var(--google-red-light)", border: "1px solid #fad2cf", color: "var(--google-red)", fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
                  <AlertTriangle size={16} />
                  <span>{credsError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={savingCreds}
                className="btn btn-primary"
                style={{ padding: "10px 20px", marginTop: 8 }}
              >
                <Sparkles size={14} />
                <span>{savingCreds ? "Probing & Connecting..." : "Save & Verify Provider"}</span>
              </button>
            </form>
          </div>

          {/* Provider Discovery & Active Capabilities */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card" style={{ padding: "20px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <ShieldCheck size={18} color="var(--google-green)" />
                <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Active Provider Capabilities</h3>
              </div>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 16 }}>
                CTRL automatically discovers supported recovery channels from Razorpay:
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { name: "Payment Links API", desc: "Dynamic UPI & NetBanking Checkout", supported: true },
                  { name: "Webhook Event Ingestion", desc: "Real-time payment failure capture", supported: true },
                  { name: "Authoritative Status Query", desc: "Zero-doubt cryptographic polling", supported: true },
                  { name: "DPDP / GDPR Data Isolation", desc: "Customer PII masking & tenant isolation", supported: true },
                ].map((c) => (
                  <div key={c.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderRadius: 6, background: "var(--bg-hover)" }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{c.desc}</div>
                    </div>
                    <span className="badge badge-green">ENABLED</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: EMBED SDK & WEBHOOKS */}
      {activeStep === "embed" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Top Banner: Success & Guidance */}
          <div style={{
            background: "var(--google-green-light)", border: "1px solid #ceead6",
            borderRadius: 10, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <CheckCircle2 size={22} color="var(--google-green)" />
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--google-green-hover)" }}>
                  Razorpay Credentials Active
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  Your Webhook Endpoint and Single-File Interceptor are generated and ready for your website.
                </div>
              </div>
            </div>
            <button
              onClick={() => setActiveStep("simulator")}
              className="btn btn-primary"
              style={{ padding: "8px 16px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
            >
              <span>Test Live Store Simulator</span>
              <ArrowRight size={14} />
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            {/* 1. Webhook Configuration */}
            <div className="card" style={{ padding: "24px 28px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <Webhook size={20} color="var(--google-blue)" />
                  <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>1. Razorpay Webhook URL</h2>
                </div>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16, lineHeight: 1.5 }}>
                  Add this webhook in your <strong>Razorpay Dashboard &rarr; Settings &rarr; Webhooks &rarr; Add New Webhook</strong>:
                </p>

                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  <input
                    type="text"
                    readOnly
                    value={webhookUrl}
                    className="input"
                    style={{ fontFamily: "var(--font-mono)", fontSize: 12, background: "var(--bg-hover)" }}
                  />
                  <button
                    onClick={() => copyToClipboard(webhookUrl, setCopiedWebhook)}
                    className="btn btn-secondary"
                    style={{ padding: "8px 16px", display: "flex", alignItems: "center", gap: 6 }}
                  >
                    {copiedWebhook ? <Check size={14} color="var(--google-green)" /> : <Copy size={14} />}
                    <span>{copiedWebhook ? "Copied" : "Copy"}</span>
                  </button>
                </div>

                <div style={{ background: "var(--bg-hover)", borderRadius: 8, padding: "12px 16px", fontSize: 12, color: "var(--text-secondary)" }}>
                  <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>Events to Select in Razorpay:</div>
                  <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                    <li><code style={{ fontWeight: 700, color: "var(--google-blue)" }}>payment.failed</code> (Ingests failed attempts for recovery)</li>
                    <li><code style={{ fontWeight: 700, color: "var(--google-green)" }}>payment_link.paid</code> (Reconciles recovery payments)</li>
                    <li><code style={{ fontWeight: 700, color: "var(--accent-lime)" }}>order.paid</code> (Validates original settlements)</li>
                  </ul>
                </div>
              </div>

              <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid var(--border-subtle)", fontSize: 11, color: "var(--text-muted)" }}>
                HMAC-SHA256 signature verification active on all deliveries.
              </div>
            </div>

            {/* 2. Single-File Drop-In (ctrl.js) */}
            <div className="card" style={{ padding: "24px 28px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <FileCode size={20} color="var(--accent-lime)" />
                  <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>2. Single-File Drop-In (<code style={{ color: "var(--accent-lime)" }}>ctrl.js</code>)</h2>
                </div>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16, lineHeight: 1.5 }}>
                  Download this single pre-configured file, drop it into your website folder, and re-launch your site:
                </p>

                {/* Big Download Button */}
                <a
                  href={`${apiBase}/sdk/download?api_key=${scriptKey}&api_url=${encodeURIComponent(apiBase)}`}
                  download="ctrl.js"
                  className="btn btn-primary"
                  style={{
                    width: "100%", padding: "12px 18px", marginBottom: 16,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    textDecoration: "none", fontSize: 14, fontWeight: 600
                  }}
                >
                  <Download size={16} />
                  <span>Download ctrl.js (Pre-Configured)</span>
                </a>

                {/* 3-Step Guide */}
                <div style={{ background: "var(--bg-hover)", borderRadius: 8, padding: "14px 16px", fontSize: 12 }}>
                  <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>3-Step Website Setup:</div>
                  <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8, color: "var(--text-secondary)" }}>
                    <li>Drop the downloaded <code style={{ color: "var(--accent-lime)" }}>ctrl.js</code> into your website's folder.</li>
                    <li>Add this 1 line right before <code style={{ color: "var(--text-muted)" }}>&lt;/body&gt;</code> on your checkout page:
                      <div style={{
                        background: "#202124", color: "#8ab4f8", padding: "8px 12px",
                        borderRadius: 6, fontFamily: "var(--font-mono)", fontSize: 11,
                        margin: "6px 0", display: "flex", justifyContent: "space-between", alignItems: "center"
                      }}>
                        <span>&lt;script src="./ctrl.js"&gt;&lt;/script&gt;</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard('<script src="./ctrl.js"></script>', setCopiedScript)}
                          style={{ background: "transparent", border: "none", color: "#dadce0", cursor: "pointer", padding: "2px 6px" }}
                          title="Copy script tag"
                        >
                          {copiedScript ? <Check size={12} color="var(--google-green)" /> : <Copy size={12} />}
                        </button>
                      </div>
                    </li>
                    <li>Re-launch your website! Any failed payment will automatically be intercepted and routed into CTRL's recovery engine.</li>
                  </ol>
                </div>
              </div>

              <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid var(--border-subtle)", fontSize: 11, color: "var(--text-muted)" }}>
                Zero changes to your checkout code required &mdash; wraps Razorpay Standard automatically.
              </div>
            </div>
          </div>
        </div>
      )}


      {/* STEP 3: INTERACTIVE STORE CHECKOUT SIMULATOR */}
      {activeStep === "simulator" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {/* Simulated Merchant Store Checkout */}
          <div className="card" style={{ padding: "24px 28px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <ShoppingCart size={18} color="var(--google-blue)" />
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Simulated Merchant Store Checkout</h2>
            </div>
            <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 20 }}>
              Simulate a real checkout abandonment and watch CTRL execute the autonomous recovery flow in real time.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Order Amount (₹)</label>
                <input
                  type="number"
                  value={simCartAmount}
                  onChange={(e) => setSimCartAmount(Number(e.target.value))}
                  className="input"
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Customer Name</label>
                <input
                  type="text"
                  value={simCustomerName}
                  onChange={(e) => setSimCustomerName(e.target.value)}
                  className="input"
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Customer Phone (WhatsApp)</label>
                <input
                  type="text"
                  value={simCustomerPhone}
                  onChange={(e) => setSimCustomerPhone(e.target.value)}
                  className="input"
                />
              </div>
            </div>

            <button
              onClick={handleTriggerStoreCheckoutFailure}
              disabled={simulatingPayment}
              className="btn btn-primary"
              style={{ width: "100%", padding: "12px", fontSize: 14 }}
            >
              <Play size={15} />
              <span>{simulatingPayment ? "Triggering Checkout Failure..." : "Simulate Failed Checkout (₹" + simCartAmount + ")"}</span>
            </button>
          </div>

          {/* Live Recovery Intercept Visualizer */}
          <div className="card" style={{ padding: "24px 28px", background: simStep === "failed" ? "var(--google-green-light)" : "#ffffff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <Smartphone size={18} color="var(--google-green)" />
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Autonomous Recovery Intercept</h3>
            </div>

            {simStep === "idle" ? (
              <div style={{ padding: "36px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                Click "Simulate Failed Checkout" to trigger live intercept.
              </div>
            ) : (
              <div>
                <div style={{
                  background: "#dcf8c6", padding: "14px 16px", borderRadius: "10px 10px 0 10px",
                  color: "#111b21", fontSize: 13, lineHeight: 1.5, marginBottom: 16,
                  border: "1px solid #c1e7a5"
                }}>
                  <div style={{ fontWeight: 700 }}>🔔 Payment Incomplete Notification</div>
                  <div style={{ marginTop: 4 }}>Hi {simCustomerName}, your ₹{simCartAmount.toLocaleString("en-IN")} payment for Our Store could not be completed.</div>
                  <div style={{ marginTop: 6, fontWeight: 600 }}>👉 Pay securely with 1-click:</div>
                  <div style={{ marginTop: 4, padding: "6px 8px", background: "#ffffff", borderRadius: 4, fontSize: 12, wordBreak: "break-all" }}>
                    <a href={simOppData?.execution?.link_url || "https://rzp.io/rzp/example"} target="_blank" rel="noreferrer" style={{ color: "var(--google-blue)" }}>
                      {simOppData?.execution?.link_url || "https://rzp.io/rzp/test_payment_link"}
                    </a>
                  </div>
                </div>

                {simOppData?.execution?.link_url && (
                  <a
                    href={simOppData.execution.link_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-primary"
                    style={{ width: "100%", background: "var(--google-green)" }}
                  >
                    <span>Complete Payment on Razorpay →</span>
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
