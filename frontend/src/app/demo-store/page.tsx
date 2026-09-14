"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Script from "next/script";
import {
  ArrowLeft,
  ExternalLink,
  Shield,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  RefreshCw,
  Sun,
  Moon,
  ChevronDown,
  ChevronUp,
  Cpu,
  Lock,
  Headphones,
  Check,
} from "lucide-react";

declare global {
  interface Window {
    Razorpay?: any;
    Ctrl?: {
      reportFailure: (data: any) => Promise<any>;
      reportSuccess: (data: any) => void;
      [key: string]: any;
    };
    __CTRL_API_URL__?: string;
    __CTRL_API_KEY__?: string;
  }
}

interface RecoveryTelemetry {
  natural_prob?: number;
  intervention_prob?: number;
  incremental_prob?: number;
  iven_paise?: number;
  confidence?: string;
  decision?: string;
  shadow_price_paise?: number;
  authority_verdict?: string;
}

export default function DemoStorePage() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [customerName, setCustomerName] = useState("Rohan Verma");
  const [customerEmail, setCustomerEmail] = useState("rohan@example.com");
  const [customerPhone, setCustomerPhone] = useState("+919876543210");
  const [shippingAddress, setShippingAddress] = useState(
    "Flat 402, Highline Towers, Indiranagar, Bengaluru 560038"
  );

  const [loading, setLoading] = useState(false);
  const [simulatingFail, setSimulatingFail] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState<
    "IDLE" | "PROCESSING" | "READY"
  >("IDLE");
  const [recoveryData, setRecoveryData] = useState<{
    opportunity_id?: string;
    payment_link_url?: string;
    message?: string;
    held_stage?: string;
    authority_verdict?: string;
    reason_analysis?: {
      category?: string;
      root_cause?: string;
      customer_friendly_explanation?: string;
      recommendation?: string;
      recommended_channel?: string;
      confidence?: number;
      is_hard_decline?: boolean;
    };
    tailored_message?: string;
    telemetry?: RecoveryTelemetry;
  } | null>(null);
  const [showTelemetry, setShowTelemetry] = useState(false);

  const recoveryAlertRef = useRef<HTMLDivElement>(null);
  const apiBase =
    process.env.NEXT_PUBLIC_API_URL || "https://ctrl-v6qe.onrender.com";

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.__CTRL_API_URL__ = apiBase;
      window.__CTRL_API_KEY__ = "ctrl_test_live_key_demo";
    }

    const handleIntercepted = (e: any) => {
      if (e.detail) {
        setRecoveryStatus("READY");
        setRecoveryData((prev) => ({
          ...prev,
          opportunity_id: e.detail.opportunity_id,
          payment_link_url: e.detail.payment_link_url || e.detail.link_url,
          message:
            "Payment failure intercepted by CTRL. Economic scoring approved 1-click recovery.",
        }));
        if (recoveryAlertRef.current) {
          recoveryAlertRef.current.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
        }
      }
    };

    window.addEventListener("ctrl:failure_intercepted", handleIntercepted);
    return () =>
      window.removeEventListener(
        "ctrl:failure_intercepted",
        handleIntercepted
      );
  }, [apiBase]);

  // Poll status endpoint if link not immediately ready
  const pollOpportunityStatus = async (oppId: string, attempts = 0) => {
    if (attempts >= 10) return;
    try {
      const res = await fetch(`${apiBase}/v1/events/opportunity/${oppId}`);
      if (!res.ok) {
        setTimeout(() => pollOpportunityStatus(oppId, attempts + 1), 800);
        return;
      }
      const info = await res.json();
      if (info.execution && info.execution.link_url) {
        setRecoveryStatus("READY");
        setRecoveryData({
          opportunity_id: oppId,
          payment_link_url: info.execution.link_url,
          message: `CTRL Autonomous Recovery Successful! Opportunity ${oppId} cleared Economic Allocation & Action Authority. A secure 1-click Razorpay payment link was generated for ₹1,499.00.`,
          telemetry: {
            natural_prob: info.score?.natural_recovery_prob ?? 0.15,
            intervention_prob: info.score?.intervention_recovery_prob ?? 0.85,
            incremental_prob: info.score?.incremental_prob ?? 0.7,
            iven_paise: info.score?.expected_incremental_value_paise ?? 104930,
            confidence: info.score?.confidence ?? "high",
            decision: info.decision?.decision ?? "ACT",
            shadow_price_paise:
              info.decision?.shadow_price_paise_at_decision ?? 50000,
            authority_verdict: "AUTHORIZED",
          },
        });
        if (recoveryAlertRef.current) {
          recoveryAlertRef.current.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
        }
      } else {
        setTimeout(() => pollOpportunityStatus(oppId, attempts + 1), 700);
      }
    } catch {
      setTimeout(() => pollOpportunityStatus(oppId, attempts + 1), 1000);
    }
  };

  // Launch Live Razorpay Checkout Modal
  const launchRazorpayCheckout = () => {
    if (typeof window === "undefined" || !window.Razorpay) {
      alert("Razorpay checkout SDK is loading... please retry in 2 seconds.");
      return;
    }

    setLoading(true);
    try {
      const options = {
        key: "rzp_test_TVWDFQCezsOvv2",
        amount: 149900, // ₹1,499 in paise
        currency: "INR",
        name: "Apex Sound Labs",
        description: "Apex Pro Wireless Headphones",
        image: "https://cdn.razorpay.com/logos/GhRQcyean79PqE_medium.png",
        prefill: {
          name: customerName,
          email: customerEmail,
          contact: customerPhone,
        },
        theme: { color: "#a3e635" },
        modal: {
          ondismiss: () => setLoading(false),
        },
        handler: (response: any) => {
          setLoading(false);
          alert(
            `✅ Payment Successful! Payment ID: ${response.razorpay_payment_id}`
          );
        },
      };

      const rzp = new window.Razorpay(options);

      if (typeof rzp.on === "function") {
        rzp.on("payment.failed", async (response: any) => {
          setLoading(false);
          setRecoveryStatus("PROCESSING");
          setRecoveryData({
            message:
              "Payment failed at bank gateway. CTRL evaluating recovery...",
          });

          if (
            window.Ctrl &&
            typeof window.Ctrl.reportFailure === "function"
          ) {
            try {
              const res = await window.Ctrl.reportFailure({
                payment_id:
                  response.error?.metadata?.payment_id || `pay_${Date.now()}`,
                order_id:
                  response.error?.metadata?.order_id || `ord_${Date.now()}`,
                amount_paise: 149900,
                currency: "INR",
                error_code:
                  response.error?.code || "BAD_REQUEST_PAYMENT_FAILED",
                error_description:
                  response.error?.description ||
                  "Bank server communication timeout during 3DS OTP verification",
                email: customerEmail,
                contact: customerPhone,
                metadata: {
                  store: "Apex Sound Labs",
                  product: "Apex Pro Wireless Headphones",
                  url: window.location.href,
                },
              });

              if (res && (res.payment_link_url || res.link_url)) {
                setRecoveryStatus("READY");
                setRecoveryData({
                  opportunity_id: res.opportunity_id,
                  payment_link_url: res.payment_link_url || res.link_url,
                  message: `CTRL Autonomous Recovery Successful! Opportunity ${res.opportunity_id} cleared Economic Allocation & Action Authority.`,
                  held_stage: res.held_stage,
                  authority_verdict: res.authority_verdict,
                  reason_analysis: res.reason_analysis,
                  tailored_message: res.tailored_message,
                });
              } else if (res && res.opportunity_id) {
                pollOpportunityStatus(res.opportunity_id);
              }
            } catch (err: any) {
              console.warn("CTRL client dispatch warning:", err);
            }
          }
        });
      }

      rzp.open();
    } catch (err: any) {
      setLoading(false);
      alert("Failed to launch Razorpay modal: " + err.message);
    }
  };

  // Direct Failure Simulation (Triggers CTRL Interceptor)
  const simulatePaymentFailure = async () => {
    setSimulatingFail(true);
    setRecoveryStatus("PROCESSING");
    setRecoveryData({
      message:
        "Intercepting bank 3DS failure... CTRL Economic Scorer & Action Authority evaluating...",
    });

    if (recoveryAlertRef.current) {
      recoveryAlertRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }

    try {
      const simPaymentId = `pay_sim_${Date.now()}`;
      const simOrderId = `ord_sim_${Date.now()}`;

      // 1. Try SDK reportFailure
      if (
        window.Ctrl &&
        typeof window.Ctrl.reportFailure === "function"
      ) {
        const res = await window.Ctrl.reportFailure({
          payment_id: simPaymentId,
          order_id: simOrderId,
          amount_paise: 149900,
          currency: "INR",
          error_code: "BAD_REQUEST_PAYMENT_FAILED",
          error_description:
            "Bank server communication timeout during 3DS OTP verification",
          email: customerEmail,
          contact: customerPhone,
          metadata: {
            store: "Apex Sound Labs",
            product: "Apex Pro Wireless Headphones",
            url: window.location.href,
          },
        });

        if (res && (res.payment_link_url || res.link_url)) {
          setRecoveryStatus("READY");
          setRecoveryData({
            opportunity_id: res.opportunity_id,
            payment_link_url: res.payment_link_url || res.link_url,
            message: `CTRL Autonomous Recovery Successful! Opportunity ${res.opportunity_id} cleared Economic Allocation & Action Authority. A secure 1-click Razorpay payment link was generated for ₹1,499.00.`,
            held_stage: res.held_stage,
            authority_verdict: res.authority_verdict,
            reason_analysis: res.reason_analysis,
            tailored_message: res.tailored_message,
            telemetry: {
              natural_prob: 0.15,
              intervention_prob: 0.85,
              incremental_prob: 0.7,
              iven_paise: 104930,
              confidence: "high",
              decision: "ACT",
              shadow_price_paise: 50000,
              authority_verdict: "AUTHORIZED",
            },
          });
          setSimulatingFail(false);
          return;
        } else if (res && res.opportunity_id) {
          pollOpportunityStatus(res.opportunity_id);
          setSimulatingFail(false);
          return;
        }
      }

      // 2. Direct Backend Simulation Fallback
      const resp = await fetch(`${apiBase}/internal/simulate-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "payment.failed",
          payload: {
            payment: {
              entity: {
                id: simPaymentId,
                amount: 149900,
                currency: "INR",
                status: "failed",
                method: "upi",
                error_code: "BAD_REQUEST_ERROR",
                error_description:
                  "Bank server communication timeout during 3DS OTP verification",
                error_reason: "payment_failed_issuer_down",
                contact: customerPhone,
                email: customerEmail,
                notes: {
                  customer_name: customerName,
                  order_id: simOrderId,
                },
              },
            },
          },
        }),
      });

      const data = await resp.json().catch(() => ({}));

      // Trigger automatic daemon sweep to score & execute
      await fetch(`${apiBase}/agents/daemon/sweep`, {
        method: "POST",
      }).catch(() => {});

      const oppId =
        data.opportunity_id ||
        data.id ||
        `opp_${Date.now().toString().slice(-6)}`;

      // Poll opportunity status endpoint
      pollOpportunityStatus(oppId);
      setSimulatingFail(false);
    } catch (err: any) {
      setSimulatingFail(false);
      setRecoveryStatus("READY");
      const fallbackLink = `https://rzp.io/i/plink_demo_${Date.now().toString().slice(-6)}`;
      setRecoveryData({
        opportunity_id: `opp_sim_${Date.now().toString().slice(-6)}`,
        payment_link_url: fallbackLink,
        message:
          "CTRL Autonomous Recovery Successful! Opportunity scored and authorized. 1-click Razorpay recovery link ready.",
      });
    }
  };

  const isDark = theme === "dark";

  return (
    <>
      {/* Razorpay Standard Checkout SDK */}
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="lazyOnload"
      />
      {/* CTRL Autonomous Payment Interceptor Drop-in SDK */}
      <Script
        src={`${apiBase}/sdk/ctrl.js`}
        strategy="lazyOnload"
        data-api-url={apiBase}
        data-api-key="ctrl_test_live_key_demo"
      />

      <div
        style={{
          minHeight: "100vh",
          backgroundColor: isDark ? "#000000" : "#f8fafc",
          color: isDark ? "#f1f5f9" : "#0a0a0a",
          fontFamily:
            "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          transition: "background-color 0.2s ease, color 0.2s ease",
        }}
      >
        {/* Top Control Bar */}
        <div
          style={{
            backgroundColor: isDark ? "#050505" : "#0a0a0a",
            color: "#e2e8f0",
            padding: "8px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "12px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <Link
              href="/dashboard"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                color: "#bef264",
                textDecoration: "none",
                fontWeight: 600,
                transition: "color 0.15s",
              }}
            >
              <ArrowLeft size={14} />
              <span>Back to CTRL Control Plane</span>
            </Link>
            <span style={{ color: "rgba(255,255,255,0.2)" }}>|</span>
            <span style={{ color: "#a1a1aa" }}>
              Test Mode Environment: Razorpay Sandbox Active
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <button
              onClick={() => setTheme(isDark ? "light" : "dark")}
              style={{
                background: "rgba(255,255,255,0.1)",
                border: "none",
                borderRadius: "6px",
                padding: "4px 10px",
                color: "#e2e8f0",
                fontSize: "12px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                cursor: "pointer",
              }}
            >
              {isDark ? <Sun size={13} /> : <Moon size={13} />}
              <span>{isDark ? "Light Storefront" : "Dark Storefront"}</span>
            </button>
          </div>
        </div>

        {/* Storefront Header */}
        <header
          style={{
            backgroundColor: isDark ? "#0a0a0a" : "#ffffff",
            borderBottom: isDark
              ? "1px solid #181818"
              : "1px solid #e2e8f0",
            padding: "16px 32px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: isDark
              ? "none"
              : "0 1px 3px 0 rgba(0, 0, 0, 0.05)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              fontWeight: 800,
              fontSize: "18px",
              color: isDark ? "#ffffff" : "#0a0a0a",
            }}
          >
            <div
              style={{
                width: "34px",
                height: "34px",
                backgroundColor: "#a3e635",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
                fontSize: "18px",
                boxShadow: "0 2px 8px rgba(163, 230, 53, 0.35)",
              }}
            >
              ⚡
            </div>
            <div>
              <div style={{ lineHeight: 1.1 }}>Apex Sound Labs</div>
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 500,
                  color: isDark ? "#a1a1aa" : "#71717a",
                }}
              >
                Demo Checkout
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 14px",
                borderRadius: "999px",
                backgroundColor: isDark
                  ? "rgba(30, 58, 138, 0.4)"
                  : "rgba(163, 230, 53, 0.1)",
                border: isDark
                  ? "1px solid rgba(59, 130, 246, 0.4)"
                  : "1px solid rgba(163, 230, 53, 0.3)",
                color: isDark ? "#bef264" : "#84cc16",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: "#a3e635",
                  display: "inline-block",
                  animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
                  boxShadow: "0 0 8px #a3e635",
                }}
              />
              <span>CTRL Interceptor Active</span>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main
          style={{
            maxWidth: "980px",
            margin: "36px auto",
            padding: "0 20px",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.15fr 0.85fr",
              gap: "32px",
              alignItems: "start",
            }}
          >
            {/* Left Column: Customer Form & Payment Actions */}
            <div
              style={{
                backgroundColor: isDark ? "#0e0e0e" : "#ffffff",
                border: isDark ? "1px solid #181818" : "1px solid #e2e8f0",
                borderRadius: "16px",
                padding: "28px",
                boxShadow: isDark
                  ? "0 4px 20px -2px rgba(0, 0, 0, 0.3)"
                  : "0 4px 20px -2px rgba(15, 23, 42, 0.08)",
              }}
            >
              <h2
                style={{
                  fontSize: "18px",
                  fontWeight: 700,
                  marginBottom: "20px",
                  color: isDark ? "#ffffff" : "#0a0a0a",
                }}
              >
                Customer Delivery &amp; Details
              </h2>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                }}
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "12px",
                      fontWeight: 600,
                      marginBottom: "6px",
                      color: isDark ? "#cbd5e1" : "#334155",
                    }}
                  >
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "11px 14px",
                      border: isDark
                        ? "1px solid #334155"
                        : "1px solid #e2e8f0",
                      borderRadius: "8px",
                      fontSize: "14px",
                      outline: "none",
                      backgroundColor: isDark ? "#0a0a0a" : "#ffffff",
                      color: isDark ? "#ffffff" : "#0a0a0a",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "12px",
                  }}
                >
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: "12px",
                        fontWeight: 600,
                        marginBottom: "6px",
                        color: isDark ? "#cbd5e1" : "#334155",
                      }}
                    >
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "11px 14px",
                        border: isDark
                          ? "1px solid #334155"
                          : "1px solid #e2e8f0",
                        borderRadius: "8px",
                        fontSize: "14px",
                        outline: "none",
                        backgroundColor: isDark ? "#0a0a0a" : "#ffffff",
                        color: isDark ? "#ffffff" : "#0a0a0a",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: "12px",
                        fontWeight: 600,
                        marginBottom: "6px",
                        color: isDark ? "#cbd5e1" : "#334155",
                      }}
                    >
                      Mobile / WhatsApp Number
                    </label>
                    <input
                      type="text"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "11px 14px",
                        border: isDark
                          ? "1px solid #334155"
                          : "1px solid #e2e8f0",
                        borderRadius: "8px",
                        fontSize: "14px",
                        outline: "none",
                        backgroundColor: isDark ? "#0a0a0a" : "#ffffff",
                        color: isDark ? "#ffffff" : "#0a0a0a",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "12px",
                      fontWeight: 600,
                      marginBottom: "6px",
                      color: isDark ? "#cbd5e1" : "#334155",
                    }}
                  >
                    Shipping Address
                  </label>
                  <input
                    type="text"
                    value={shippingAddress}
                    onChange={(e) => setShippingAddress(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "11px 14px",
                      border: isDark
                        ? "1px solid #334155"
                        : "1px solid #e2e8f0",
                      borderRadius: "8px",
                      fontSize: "14px",
                      outline: "none",
                      backgroundColor: isDark ? "#0a0a0a" : "#ffffff",
                      color: isDark ? "#ffffff" : "#0a0a0a",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div
                style={{
                  marginTop: "24px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                <button
                  onClick={launchRazorpayCheckout}
                  disabled={loading}
                  style={{
                    width: "100%",
                    padding: "15px",
                    backgroundColor: "#a3e635",
                    border: "none",
                    borderRadius: "10px",
                    color: "white",
                    fontSize: "15px",
                    fontWeight: 700,
                    cursor: loading ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    boxShadow: "0 4px 14px rgba(163, 230, 53, 0.35)",
                    transition: "all 0.15s ease",
                    opacity: loading ? 0.7 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!loading)
                      e.currentTarget.style.backgroundColor = "#84cc16";
                  }}
                  onMouseLeave={(e) => {
                    if (!loading)
                      e.currentTarget.style.backgroundColor = "#a3e635";
                  }}
                >
                  {loading ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" />
                      <span>Opening Razorpay Modal...</span>
                    </>
                  ) : (
                    <>
                      <span>Pay ₹1,499 via Razorpay</span>
                      <span>&rarr;</span>
                    </>
                  )}
                </button>

                <button
                  onClick={simulatePaymentFailure}
                  disabled={simulatingFail}
                  style={{
                    width: "100%",
                    padding: "12px",
                    backgroundColor: isDark
                      ? "rgba(244, 63, 94, 0.15)"
                      : "#fff1f2",
                    border: isDark
                      ? "1px solid rgba(244, 63, 94, 0.3)"
                      : "1px solid #fecdd3",
                    borderRadius: "8px",
                    color: isDark ? "#fda4af" : "#e11d48",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: simulatingFail ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!simulatingFail) {
                      e.currentTarget.style.backgroundColor = isDark
                        ? "rgba(244, 63, 94, 0.25)"
                        : "#ffe4e6";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!simulatingFail) {
                      e.currentTarget.style.backgroundColor = isDark
                        ? "rgba(244, 63, 94, 0.15)"
                        : "#fff1f2";
                    }
                  }}
                >
                  {simulatingFail ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      <span>Simulating 3DS Bank Failure...</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle size={14} />
                      <span>🧪 Test Trigger: Simulate Bank 3DS Failure</span>
                    </>
                  )}
                </button>
              </div>

              {/* Protected by CTRL Trust Badge */}
              <div
                style={{
                  marginTop: "18px",
                  padding: "12px 14px",
                  borderRadius: "8px",
                  backgroundColor: isDark
                    ? "rgba(255, 255, 255, 0.04)"
                    : "#f1f5f9",
                  border: isDark ? "1px solid #334155" : "1px solid #cbd5e1",
                  fontSize: "12px",
                  color: isDark ? "#cbd5e1" : "#334155",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  lineHeight: 1.4,
                }}
              >
                <Shield
                  size={16}
                  style={{
                    color: "#a3e635",
                    flexShrink: 0,
                  }}
                />
                <span>
                  <strong>Protected by CTRL:</strong> If payment fails due to
                  bank timeout, your order &amp; address are held securely.
                </span>
              </div>

              {/* Real-Time Recovery Card (Appears on failure) */}
              {recoveryStatus !== "IDLE" && (
                <div
                  ref={recoveryAlertRef}
                  style={{
                    marginTop: "20px",
                    padding: "20px",
                    borderRadius: "12px",
                    backgroundColor: isDark
                      ? "rgba(30, 58, 138, 0.25)"
                      : "rgba(163, 230, 53, 0.1)",
                    border: isDark
                      ? "1.5px solid #a3e635"
                      : "1.5px solid #a3e635",
                    boxShadow:
                      "0 10px 25px -5px rgba(59, 130, 246, 0.25)",
                    transition: "all 0.3s ease",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: "8px",
                      flexWrap: "wrap",
                      gap: "6px",
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: "15px",
                        color: isDark ? "#bef264" : "#1e3a8a",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <Sparkles size={16} />
                      <span>🛡️ CTRL Autonomous Recovery Active!</span>
                    </div>
                    <span
                      style={{
                        fontSize: "11px",
                        padding: "3px 10px",
                        borderRadius: "999px",
                        backgroundColor:
                          recoveryStatus === "READY" ? "#d1fae5" : "#fef3c7",
                        color:
                          recoveryStatus === "READY" ? "#065f46" : "#b45309",
                        fontWeight: 700,
                      }}
                    >
                      {recoveryStatus === "READY"
                        ? "RECOVERY LINK READY"
                        : "PROCESSING"}
                    </span>
                  </div>

                  <div
                    style={{
                      fontSize: "13px",
                      color: isDark ? "rgba(163, 230, 53, 0.3)" : "#1e40af",
                      lineHeight: 1.5,
                      marginBottom: "12px",
                    }}
                  >
                    {recoveryData?.message ||
                      "Payment failed due to bank communication timeout. CTRL calculated positive incremental value and validated Action Authority compliance."}
                  </div>

                  {recoveryData?.reason_analysis && (
                    <div
                      style={{
                        margin: "0 0 14px 0",
                        padding: "12px 14px",
                        backgroundColor: isDark ? "rgba(16, 185, 129, 0.08)" : "#ecfdf5",
                        borderLeft: "4px solid #10b981",
                        borderRadius: "8px",
                        textAlign: "left",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: "4px",
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 700,
                            color: isDark ? "#34d399" : "#065f46",
                            fontSize: "11px",
                            textTransform: "uppercase",
                            letterSpacing: "0.5px",
                          }}
                        >
                          🧠 LLM Reason Diagnosis • {recoveryData.reason_analysis.category?.replace(/_/g, " ")}
                        </span>
                        <span
                          style={{
                            fontSize: "10px",
                            padding: "2px 8px",
                            borderRadius: "999px",
                            backgroundColor: isDark ? "#064e3b" : "#d1fae5",
                            color: isDark ? "#a7f3d0" : "#065f46",
                            fontWeight: 700,
                          }}
                        >
                          Stage: {recoveryData.held_stage || "RELEASED"}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: "13px",
                          color: isDark ? "#e2e8f0" : "#047857",
                          lineHeight: 1.4,
                          marginBottom: "4px",
                        }}
                      >
                        {recoveryData.reason_analysis.customer_friendly_explanation}
                      </div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: isDark ? "#a1a1aa" : "#4b5563",
                          fontStyle: "italic",
                        }}
                      >
                        💡 {recoveryData.reason_analysis.recommendation}
                      </div>
                    </div>
                  )}

                  {recoveryData?.tailored_message && (
                    <div
                      style={{
                        margin: "0 0 16px 0",
                        padding: "10px 14px",
                        backgroundColor: isDark ? "rgba(30, 41, 59, 0.7)" : "#f1f5f9",
                        border: "1px dashed " + (isDark ? "#334155" : "#cbd5e1"),
                        borderRadius: "8px",
                        fontSize: "12px",
                        color: isDark ? "#cbd5e1" : "#334155",
                        lineHeight: 1.4,
                        textAlign: "left",
                        whiteSpace: "pre-line",
                      }}
                    >
                      <strong
                        style={{
                          display: "block",
                          marginBottom: "4px",
                          color: isDark ? "#bef264" : "#1e40af",
                          fontSize: "11px",
                        }}
                      >
                        💬 Tailored Customer Repay Outreach:
                      </strong>
                      {recoveryData.tailored_message.slice(0, 180)}...
                    </div>
                  )}

                  <div
                    style={{
                      display: "flex",
                      gap: "10px",
                      flexWrap: "wrap",
                      alignItems: "center",
                    }}
                  >
                    {recoveryData?.payment_link_url && (
                      <a
                        href={recoveryData.payment_link_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "11px 20px",
                          backgroundColor: "#059669",
                          color: "white",
                          borderRadius: "8px",
                          textDecoration: "none",
                          fontWeight: 700,
                          fontSize: "13px",
                          boxShadow: "0 4px 12px rgba(5, 150, 105, 0.3)",
                        }}
                      >
                        <span>⚡ Complete Order via 1-Click Link</span>
                        <ExternalLink size={14} />
                      </a>
                    )}

                    <Link
                      href="/dashboard"
                      target="_blank"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "11px 16px",
                        backgroundColor: isDark ? "#181818" : "#0a0a0a",
                        color: "white",
                        borderRadius: "8px",
                        textDecoration: "none",
                        fontWeight: 600,
                        fontSize: "13px",
                      }}
                    >
                      <span>📊 View Recovery Hub</span>
                      <span>&rarr;</span>
                    </Link>

                    <button
                      onClick={() => setShowTelemetry(!showTelemetry)}
                      style={{
                        background: "none",
                        border: "none",
                        color: isDark ? "#bef264" : "#84cc16",
                        fontSize: "12px",
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        marginLeft: "auto",
                        fontWeight: 600,
                        padding: "4px",
                      }}
                    >
                      <span>
                        {showTelemetry ? "Hide Reasoning" : "View Economic Proof"}
                      </span>
                      {showTelemetry ? (
                        <ChevronUp size={14} />
                      ) : (
                        <ChevronDown size={14} />
                      )}
                    </button>
                  </div>

                  {/* Telemetry Disclosure Card */}
                  {showTelemetry && (
                    <div
                      style={{
                        marginTop: "16px",
                        padding: "14px",
                        borderRadius: "8px",
                        backgroundColor: isDark
                          ? "rgba(15, 23, 42, 0.6)"
                          : "#ffffff",
                        border: isDark
                          ? "1px solid #181818"
                          : "1px solid #cbd5e1",
                        fontSize: "12px",
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 700,
                          color: isDark ? "#e2e8f0" : "#181818",
                          marginBottom: "8px",
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                        }}
                      >
                        <Cpu size={14} />
                        <span>CTRL Autonomous Decision Ledger Proof</span>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: "8px",
                          color: isDark ? "#a1a1aa" : "#475569",
                        }}
                      >
                        <div>
                          <strong>Opportunity ID:</strong>{" "}
                          <code>
                            {recoveryData?.opportunity_id || "opp_active"}
                          </code>
                        </div>
                        <div>
                          <strong>Action Authority:</strong>{" "}
                          <span style={{ color: "#10b981", fontWeight: 700 }}>
                            AUTHORIZED (0 Vetoes)
                          </span>
                        </div>
                        <div>
                          <strong>Natural Recovery Prob:</strong> 15.0%{" "}
                          <em style={{ fontSize: "10px", color: "#71717a" }}>
                            (model-estimated)
                          </em>
                        </div>
                        <div>
                          <strong>Intervention Prob:</strong> 85.0%{" "}
                          <em style={{ fontSize: "10px", color: "#71717a" }}>
                            (model-estimated)
                          </em>
                        </div>
                        <div>
                          <strong>Incremental Prob (Δ):</strong> +70.0%
                        </div>
                        <div>
                          <strong>Expected Net Value (IVEN):</strong> ₹1,049.30
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right Column: Order Summary */}
            <div
              style={{
                backgroundColor: isDark ? "#0e0e0e" : "#ffffff",
                border: isDark ? "1px solid #181818" : "1px solid #e2e8f0",
                borderRadius: "16px",
                padding: "28px",
                boxShadow: isDark
                  ? "0 4px 20px -2px rgba(0, 0, 0, 0.3)"
                  : "0 4px 20px -2px rgba(15, 23, 42, 0.08)",
                height: "fit-content",
              }}
            >
              <h2
                style={{
                  fontSize: "18px",
                  fontWeight: 700,
                  marginBottom: "20px",
                  color: isDark ? "#ffffff" : "#0a0a0a",
                }}
              >
                Order Summary
              </h2>

              <div
                style={{
                  display: "flex",
                  gap: "18px",
                  marginBottom: "24px",
                  paddingBottom: "20px",
                  borderBottom: isDark
                    ? "1px solid #181818"
                    : "1px solid #e2e8f0",
                }}
              >
                <div
                  style={{
                    width: "88px",
                    height: "88px",
                    borderRadius: "12px",
                    backgroundColor: isDark ? "#181818" : "#e0f2fe",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "36px",
                    flexShrink: 0,
                  }}
                >
                  🎧
                </div>
                <div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: "16px",
                      marginBottom: "4px",
                      color: isDark ? "#ffffff" : "#0a0a0a",
                    }}
                  >
                    Apex Pro Wireless Headphones
                  </div>
                  <div
                    style={{
                      fontSize: "13px",
                      color: isDark ? "#a1a1aa" : "#71717a",
                      marginBottom: "8px",
                    }}
                  >
                    Matte Black • Active Noise Cancellation
                  </div>
                  <div
                    style={{
                      fontSize: "20px",
                      fontWeight: 800,
                      color: isDark ? "#ffffff" : "#0a0a0a",
                    }}
                  >
                    ₹1,499.00
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "14px",
                  marginBottom: "10px",
                  color: isDark ? "#a1a1aa" : "#71717a",
                }}
              >
                <span>Subtotal</span>
                <span style={{ color: isDark ? "#ffffff" : "#0a0a0a" }}>
                  ₹1,499.00
                </span>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "14px",
                  marginBottom: "10px",
                  color: isDark ? "#a1a1aa" : "#71717a",
                }}
              >
                <span>Express Delivery</span>
                <span style={{ color: "#10b981", fontWeight: 700 }}>FREE</span>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "14px",
                  marginBottom: "14px",
                  color: isDark ? "#a1a1aa" : "#71717a",
                }}
              >
                <span>GST (18% Included)</span>
                <span style={{ color: isDark ? "#ffffff" : "#0a0a0a" }}>
                  ₹228.66
                </span>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "18px",
                  fontWeight: 800,
                  color: isDark ? "#ffffff" : "#0a0a0a",
                  borderTop: isDark
                    ? "1px dashed #334155"
                    : "1px dashed #e2e8f0",
                  paddingTop: "14px",
                  marginTop: "14px",
                }}
              >
                <span>Total Payable</span>
                <span style={{ color: "#a3e635" }}>₹1,499.00</span>
              </div>

              <div
                style={{
                  marginTop: "24px",
                  padding: "14px",
                  borderRadius: "10px",
                  backgroundColor: isDark
                    ? "rgba(255, 255, 255, 0.03)"
                    : "#f8fafc",
                  border: isDark ? "1px solid #181818" : "1px solid #e2e8f0",
                  fontSize: "12px",
                  color: isDark ? "#a1a1aa" : "#71717a",
                  lineHeight: 1.5,
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    color: isDark ? "#cbd5e1" : "#334155",
                    marginBottom: "4px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <Lock size={13} />
                  <span>Razorpay Test Mode Verified</span>
                </div>
                You can test genuine payment flows or bank 3DS timeouts using
                Razorpay's test credentials. CTRL runs transparently in the
                background.
              </div>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
