"use client";

import React, { useState, useEffect } from "react";
import { Key, CheckCircle2, XCircle, RefreshCw, Plus, Eye, EyeOff, Zap, Copy, Check, ExternalLink, ShieldCheck, Code } from "lucide-react";
import { api, useAuth } from "../../../../lib/auth";

interface Connection {
  connectionId: string;
  status: "VERIFIED" | "ERROR";
  capabilities: Array<{ capability: string; supported: boolean }>;
  environment: "test" | "live";
}

interface WebAppConnectionItem {
  id: string;
  app_origin: string;
  app_url?: string;
  app_name?: string;
  sdk_version?: string;
  status: "ONLINE" | "IDLE" | "OFFLINE";
  last_ping_at: string;
  first_connected_at: string;
}

export default function IntegrationsPage() {
  const { tenant, user } = useAuth();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [webApps, setWebApps] = useState<WebAppConnectionItem[]>([]);
  const [webAppsLoading, setWebAppsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ 
    keyId: "", 
    keySecret: "", 
    webhookSecret: "",
    environment: "live" as "test" | "live"
  });
  const [showSecret, setShowSecret] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);

  const tenantId = tenant?.id || user?.tenantId || "your_tenant_id";
  const apiBase = typeof window !== "undefined" ? (process.env.NEXT_PUBLIC_API_URL || `${window.location.protocol}//${window.location.hostname}:3001`) : "http://localhost:3001";
  const webhookUrl = `${apiBase}/webhooks/razorpay/${tenantId}`;
  const scriptTag = `<script src="${apiBase}/sdk/ctrl.js" data-api-key="YOUR_CTRL_API_KEY" defer></script>`;

  const fetchConnections = async () => {
    setLoading(true);
    try {
      const data = await api<{ connections: Connection[] }>("/v1/integrations/connections");
      setConnections(data.connections || []);
    } catch {
      setConnections([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchWebApps = async () => {
    setWebAppsLoading(true);
    try {
      const data = await api<{ connected: boolean; total_apps: number; apps: WebAppConnectionItem[] }>("/v1/integrations/web-apps");
      setWebApps(data.apps || []);
    } catch {
      setWebApps([]);
    } finally {
      setWebAppsLoading(false);
    }
  };

  useEffect(() => {
    fetchConnections();
    fetchWebApps();
    const interval = setInterval(fetchWebApps, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleCopyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleCopyScript = () => {
    navigator.clipboard.writeText(scriptTag);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2500);
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      await api("/v1/integrations/razorpay/connect", {
        method: "POST",
        body: JSON.stringify({
          key_id: form.keyId.trim(),
          key_secret: form.keySecret.trim(),
          webhook_secret: form.webhookSecret.trim() || undefined,
          environment: form.environment,
        }),
      });
      setSuccess(`Razorpay Production connection verified and saved successfully.`);
      setForm({ keyId: "", keySecret: "", webhookSecret: "", environment: "live" });
      setShowForm(false);
      fetchConnections();
    } catch (err: any) {
      setError(err.message || "Connection failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 780 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Integrations & Payment Gateways</h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          Connect your Razorpay Production merchant account and track client web applications streaming telemetry.
        </p>
      </div>

      {success && (
        <div style={{
          padding: "12px 16px", borderRadius: 8,
          background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)",
          color: "var(--emerald)", fontSize: 13, display: "flex", alignItems: "center", gap: 8,
        }}>
          <CheckCircle2 size={15} /> {success}
        </div>
      )}

      {/* Live Web App Connections Card */}
      <div className="card" style={{ padding: 20, background: "rgba(16,185,129,0.03)", border: "1px solid rgba(16,185,129,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Zap size={16} color="var(--emerald)" />
              <h2 style={{ fontSize: 15, fontWeight: 600 }}>Live Web Application Connections (SDK Status)</h2>
              <span style={{
                fontSize: 10, padding: "2px 8px", borderRadius: 10, fontWeight: 700,
                background: webApps.some(a => a.status === 'ONLINE') ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.08)",
                color: webApps.some(a => a.status === 'ONLINE') ? "var(--emerald)" : "var(--text-muted)",
              }}>
                {webApps.some(a => a.status === 'ONLINE') ? "● LIVE ACTIVE" : "○ DISCONNECTED"}
              </span>
            </div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              Websites and checkout pages currently integrated with <code>ctrl.js</code> sending live heartbeats and failure telemetry.
            </p>
          </div>
          <button className="btn btn-ghost" onClick={fetchWebApps} style={{ padding: "6px 12px", fontSize: 12, gap: 6 }}>
            <RefreshCw size={13} className={webAppsLoading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        {webAppsLoading && webApps.length === 0 ? (
          <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
            Checking connected web applications…
          </div>
        ) : webApps.length === 0 ? (
          <div style={{
            padding: "20px 16px", textAlign: "center",
            background: "var(--bg-surface)", border: "1px dashed var(--border)", borderRadius: 8,
          }}>
            <Code size={22} color="var(--text-muted)" style={{ marginBottom: 6 }} />
            <div style={{ fontSize: 13, fontWeight: 500 }}>No Web Applications Connected Yet</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              Add the script tag below to your checkout webpage. Once the page loads, it will automatically appear here.
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {webApps.map((app) => (
              <div key={app.id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 14px", borderRadius: 8,
                background: "var(--bg-card)", border: "1px solid var(--border)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: app.status === 'ONLINE' ? 'var(--emerald)' : (app.status === 'IDLE' ? 'var(--amber)' : 'var(--text-muted)'),
                    boxShadow: app.status === 'ONLINE' ? '0 0 6px var(--emerald)' : 'none',
                  }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, fontFamily: "monospace" }}>
                      {app.app_origin}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      App: {app.app_name || 'Client Web Checkout'} · SDK v{app.sdk_version || '6.1.0'} · Last ping: {new Date(app.last_ping_at).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
                <span className={`badge ${app.status === 'ONLINE' ? 'badge-green' : (app.status === 'IDLE' ? 'badge-amber' : 'badge-gray')}`}>
                  {app.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tenant Webhook Ingress URL Card */}
      <div className="card" style={{ padding: 20, background: "rgba(163,230,53,)", border: "1px solid rgba(163,230,53,)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
              <Zap size={16} color="var(--accent-lime)" />
              Your Dedicated Ingestion Webhook URL
            </h2>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              Paste this URL in your <strong>Razorpay Dashboard → Settings → Webhooks</strong> to stream payment failure events into CTRL.
            </p>
          </div>
        </div>

        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 14px", borderRadius: 8,
          background: "var(--bg-card)", border: "1px solid var(--border)",
          fontFamily: "monospace", fontSize: 13, color: "var(--text-primary)",
          overflowX: "auto"
        }}>
          <span style={{ flex: 1, wordBreak: "break-all" }}>{webhookUrl}</span>
          <button 
            type="button"
            className="btn btn-ghost" 
            onClick={handleCopyWebhook}
            style={{ padding: "6px 12px", fontSize: 12, gap: 6, flexShrink: 0 }}
          >
            {copied ? <Check size={14} color="var(--emerald)" /> : <Copy size={14} />}
            {copied ? "Copied!" : "Copy URL"}
          </button>
        </div>

        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Recommended Razorpay Webhook Events:
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {["payment.failed", "payment.captured", "payment_link.paid", "payment_link.expired", "payment_link.cancelled"].map((evt) => (
              <span key={evt} style={{
                fontSize: 11, padding: "2px 8px", borderRadius: 4,
                background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)",
                color: "var(--text-secondary)", fontFamily: "monospace"
              }}>
                {evt}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Zero-Code Frontend Script Tag Card */}
      <div className="card" style={{ padding: 20, background: "rgba(163,230,53,)", border: "1px solid rgba(163,230,53,)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
              <Code size={16} color="var(--accent-lime)" />
              Zero-Code Drop-In Client Script (Any Webpage)
            </h2>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              Paste this 1-line script tag into the HTML <code>&lt;head&gt;</code> or footer of <strong>any website</strong> (Shopify, WordPress, Webflow, Custom HTML/React).
              It automatically hooks into <code>window.Razorpay</code> and streams failed payments to CTRL without touching backend code or env variables.
            </p>
          </div>
        </div>

        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 14px", borderRadius: 8,
          background: "var(--bg-card)", border: "1px solid var(--border)",
          fontFamily: "monospace", fontSize: 12, color: "var(--text-primary)",
          overflowX: "auto"
        }}>
          <span style={{ flex: 1, wordBreak: "break-all" }}>{scriptTag}</span>
          <button 
            type="button"
            className="btn btn-ghost" 
            onClick={handleCopyScript}
            style={{ padding: "6px 12px", fontSize: 12, gap: 6, flexShrink: 0 }}
          >
            {copiedScript ? <Check size={14} color="var(--emerald)" /> : <Copy size={14} />}
            {copiedScript ? "Copied!" : "Copy Tag"}
          </button>
        </div>

        <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
          💡 <em>Tip: Replace <code>YOUR_CTRL_API_KEY</code> with an API Key generated in <strong>Settings → API Keys</strong>.</em>
        </div>
      </div>

      {/* Existing Connections */}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Connected Gateways</h2>
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)} style={{ gap: 6, padding: "7px 14px", fontSize: 13 }}>
            <Plus size={14} />
            {showForm ? "Cancel" : "Connect Razorpay Account"}
          </button>
        </div>


        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
            <RefreshCw size={16} style={{ marginBottom: 8, animation: "spin 1s linear infinite" }} />
            <br />Loading connections…
          </div>
        ) : connections.length === 0 ? (
          <div style={{
            padding: "32px 20px", textAlign: "center",
            border: "1px dashed var(--border)", borderRadius: 10,
          }}>
            <Key size={28} color="var(--text-muted)" style={{ marginBottom: 12 }} />
            <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>No Razorpay gateway connected yet</p>
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Connect your Razorpay Production API keys to enable autonomous recovery link creation.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {connections.map((conn) => (
              <div key={conn.connectionId} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "14px 16px", borderRadius: 10,
                background: "var(--bg-surface)", border: "1px solid var(--border)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: conn.environment === "live" ? "rgba(16,185,129,0.15)" : "rgba(163,230,53,0.15)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Zap size={18} color={conn.environment === "live" ? "var(--emerald)" : "var(--accent-lime)"} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                      Razorpay Gateway
                      <span style={{
                        fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 700,
                        background: conn.environment === "live" ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.1)",
                        color: conn.environment === "live" ? "var(--emerald)" : "var(--text-muted)",
                        textTransform: "uppercase"
                      }}>
                        {conn.environment === "live" ? "Production (Live)" : "Sandbox"}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                      Capabilities: {conn.capabilities?.filter((c) => c.supported).map((c) => c.capability).join(", ") || "payment_links, reconciliation"}
                    </div>
                  </div>
                </div>
                <span className={`badge ${conn.status === "VERIFIED" ? "badge-green" : "badge-red"}`}>
                  {conn.status === "VERIFIED" ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                  {conn.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Connect Form */}
      {showForm && (
        <div className="card animate-fade-in" style={{ padding: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Connect Razorpay Account</h3>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
            Find your API keys in your <a href="https://dashboard.razorpay.com" target="_blank" rel="noreferrer" style={{ color: "var(--accent-lime)", textDecoration: "underline" }}>Razorpay Dashboard → Settings → API Keys <ExternalLink size={11} style={{ display: "inline" }} /></a>.
          </p>

          {error && (
            <div style={{
              padding: "10px 14px", marginBottom: 16, borderRadius: 8,
              background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.3)",
              color: "var(--rose)", fontSize: 13,
            }}>
              {error}
            </div>
          )}

          <form onSubmit={handleConnect} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6, color: "var(--text-secondary)" }}>
                Environment
              </label>
              <div style={{
                padding: "10px 14px", borderRadius: 8, border: "1px solid var(--emerald)",
                background: "rgba(16,185,129,0.08)", display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "var(--emerald)"
              }}>
                <Zap size={14} color="var(--emerald)" /> Live Production Mode
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6, color: "var(--text-secondary)" }}>
                Key ID <span style={{ color: "var(--rose)" }}>*</span>
              </label>
              <input
                id="integration-key-id"
                className="input"
                placeholder="rzp_live_..."
                value={form.keyId}
                onChange={(e) => setForm((f) => ({ ...f, keyId: e.target.value }))}
                required
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6, color: "var(--text-secondary)" }}>
                Key Secret <span style={{ color: "var(--rose)" }}>*</span>
              </label>
              <div style={{ position: "relative" }}>
                <input
                  id="integration-key-secret"
                  className="input"
                  type={showSecret ? "text" : "password"}
                  placeholder="Your Razorpay secret key"
                  value={form.keySecret}
                  onChange={(e) => setForm((f) => ({ ...f, keySecret: e.target.value }))}
                  required
                  style={{ paddingRight: 44 }}
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}
                >
                  {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6, color: "var(--text-secondary)" }}>
                Webhook Secret (optional)
              </label>
              <input
                id="integration-webhook-secret"
                className="input"
                type="password"
                placeholder="For HMAC webhook signature verification"
                value={form.webhookSecret}
                onChange={(e) => setForm((f) => ({ ...f, webhookSecret: e.target.value }))}
              />
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                Secret entered in Razorpay Dashboard → Settings → Webhooks.
              </p>
            </div>

            <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
              <button
                id="integration-connect-submit"
                type="submit"
                className="btn btn-primary"
                disabled={submitting}
                style={{ flex: 1 }}
              >
                {submitting ? "Verifying connection…" : "Verify & Connect Razorpay Account"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Security note */}
      <div className="card" style={{ padding: 16, background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.2)" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <ShieldCheck size={20} color="var(--emerald)" style={{ flexShrink: 0, marginTop: 2 }} />
          <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            <strong style={{ color: "var(--text-primary)" }}>Enterprise Security Guarantee:</strong>{" "}
            Your Razorpay API secrets and webhook keys are encrypted immediately with <strong>AES-256-GCM</strong> using an isolated master key. 
            They are decrypted only ephemerally in memory to dispatch payment link generation and verify HMAC signatures.
          </p>
        </div>
      </div>
    </div>
  );
}
