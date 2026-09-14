"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Sparkles,
  CheckCircle2,
  ExternalLink,
  Send,
  Mail,
  RefreshCw,
  Check,
  Copy,
  ArrowRight,
  Play,
  HelpCircle,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { api, useAuth } from "../../lib/auth";

interface Product {
  id: string;
  name: string;
  category: string;
  pricePaise: number;
  priceDisplay: string;
  image: string;
}

const PRODUCTS: Product[] = [
  {
    id: "prod_headphones",
    name: "Apex Studio Pro Wireless ANC",
    category: "Premium Audio",
    pricePaise: 349900,
    priceDisplay: "₹3,499.00",
    image: "🎧",
  },
  {
    id: "prod_keyboard",
    name: "CyberFlow 75% Mechanical RGB",
    category: "Pro Peripherals",
    pricePaise: 499900,
    priceDisplay: "₹4,999.00",
    image: "⌨️",
  },
  {
    id: "prod_charger",
    name: "GaN UltraFast 100W Hub",
    category: "Fast Charging",
    pricePaise: 189900,
    priceDisplay: "₹1,899.00",
    image: "⚡",
  },
];

export default function TestGroundPage() {
  const { token, loginAsDemo } = useAuth();

  // Store Checkout State
  const [selectedProduct, setSelectedProduct] = useState<Product>(PRODUCTS[0]);
  const [customerName, setCustomerName] = useState("Aarav Patel");
  const [customerEmail, setCustomerEmail] = useState("aarav.patel@example.com");
  const [customerPhone, setCustomerPhone] = useState("+919876543210");
  const [selectedScenario, setSelectedScenario] = useState<
    "soft_funds" | "soft_timeout" | "hard_stolen" | "capacity_bind"
  >("soft_funds");
  const [sendRealEmail, setSendRealEmail] = useState(true);

  // Execution & Simulation State
  const [simulating, setSimulating] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [simulationResult, setSimulationResult] = useState<any>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [rightView, setRightView] = useState<"monitor" | "trace">("monitor");
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);

  // Auto-acquire demo session token on mount if visitor is not logged in
  useEffect(() => {
    if (!token && typeof window !== "undefined") {
      const stored = localStorage.getItem("ctrl_session_token");
      if (!stored) {
        loginAsDemo().catch(() => {});
      }
    }
  }, [token, loginAsDemo]);

  // Run Simulation
  const handleSimulateCheckout = async (overrideScenario?: string) => {
    if (!token && typeof window !== "undefined" && !localStorage.getItem("ctrl_session_token")) {
      await loginAsDemo().catch(() => {});
    }
    const sc = overrideScenario || selectedScenario;
    setSimulating(true);
    setFeedbackNotice(null);

    try {
      const payload = {
        scenario: sc,
        amount_paise: selectedProduct.pricePaise,
        customer_name: customerName.trim(),
        customer_email: customerEmail.trim(),
        customer_contact: customerPhone.trim(),
        send_real_email: sendRealEmail,
      };

      const res = await api<any>("/v1/playground/simulate-scenario", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (res?.success) {
        setSimulationResult(res);
        if (res.email_delivered) {
          setFeedbackNotice(`Real email sent to ${res.email_recipient} with the payment link!`);
        } else if (res.email_sandbox_note) {
          setFeedbackNotice(`Test Mode: ${res.email_sandbox_note}`);
        }
      } else {
        alert(res?.error || "Simulation failed.");
      }
    } catch (err: any) {
      alert("Error running simulation: " + err.message);
    } finally {
      setSimulating(false);
    }
  };

  // Settle Payment Link (Complete recovery test)
  const handleSettlePayment = async () => {
    if (!token && typeof window !== "undefined" && !localStorage.getItem("ctrl_session_token")) {
      await loginAsDemo().catch(() => {});
    }
    if (!simulationResult?.opportunity_id) return;
    setReconciling(true);
    try {
      const res = await api<any>("/v1/playground/reconcile-link", {
        method: "POST",
        body: JSON.stringify({ opportunity_id: simulationResult.opportunity_id }),
      });

      if (res?.success) {
        setSimulationResult((prev: any) => ({
          ...prev,
          payment_recovered: true,
          execution_status: "RECOVERED",
        }));
        setFeedbackNotice("Success! Customer paid the link. Sale is recovered.");
      }
    } catch (err: any) {
      alert("Payment test error: " + err.message);
    } finally {
      setReconciling(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-200">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900">
              Test Ground
            </h1>
            <span className="text-xs font-mono font-semibold px-2.5 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-200">
              Simulator
            </span>
          </div>
          <p className="text-xs sm:text-sm text-zinc-500">
            Simulate failed checkouts and see how CTRL saves the sale.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="px-4 py-2 rounded-xl bg-white hover:bg-zinc-50 border border-zinc-300 text-xs font-semibold text-zinc-900 transition-all shadow-xs flex items-center gap-2"
          >
            <span>Open Dashboard</span>
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      {/* Dual Layout: Store Simulator (Left) vs Live Monitor (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* ===================================================================== */}
        {/* LEFT COLUMN: SAMPLE STORE CHECKOUT                                    */}
        {/* ===================================================================== */}
        <div className="lg:col-span-5 space-y-6">
          <div className="rounded-2xl bg-white border border-zinc-200 p-6 shadow-sm">
            {/* Store Brand Header */}
            <div className="flex items-center justify-between pb-4 border-b border-zinc-100 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center font-bold text-white shadow-xs">
                  A
                </div>
                <div>
                  <h2 className="text-sm font-bold text-zinc-900 tracking-wide">Apex CyberStore</h2>
                  <span className="text-[10px] font-mono font-semibold text-orange-600">Sample Store Checkout</span>
                </div>
              </div>
              <span className="text-[11px] font-mono px-2.5 py-1 rounded-md bg-zinc-100 border border-zinc-200 text-zinc-600">
                Razorpay Test Mode
              </span>
            </div>

            {/* Product Selector */}
            <div className="space-y-3 mb-6">
              <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold">
                1. Select Item to Purchase
              </label>
              <div className="space-y-2">
                {PRODUCTS.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => setSelectedProduct(p)}
                    className={`p-3.5 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                      selectedProduct.id === p.id
                        ? "bg-orange-50/60 border-2 border-orange-500 shadow-xs"
                        : "bg-zinc-50 border-zinc-200 hover:border-zinc-300 hover:bg-zinc-100/70"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{p.image}</span>
                      <div>
                        <div className="text-xs font-bold text-zinc-900">{p.name}</div>
                        <div className="text-[10px] text-zinc-500">{p.category}</div>
                      </div>
                    </div>
                    <div className="text-xs font-mono font-bold text-orange-600">{p.priceDisplay}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Customer Details Form */}
            <div className="space-y-4 mb-6">
              <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold">
                2. Customer &amp; Email Delivery Info
              </label>

              <div>
                <span className="text-[11px] text-zinc-500 block mb-1 font-medium">Your Name</span>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-zinc-50 border border-zinc-200 focus:border-orange-500 focus:bg-white rounded-xl text-xs text-zinc-900 outline-none transition-all shadow-2xs"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[11px] text-zinc-500 font-medium">Your Real Email</span>
                  <span className="text-[10px] text-orange-600 font-mono font-semibold">Receives payment link email</span>
                </div>
                <div className="relative">
                  <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="email"
                    required
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="your-email@gmail.com"
                    className="w-full pl-9 pr-3.5 py-2.5 bg-zinc-50 border border-zinc-200 focus:border-orange-500 focus:bg-white rounded-xl text-xs text-zinc-900 outline-none transition-all shadow-2xs"
                  />
                </div>
              </div>

              <div>
                <span className="text-[11px] text-zinc-500 block mb-1 font-medium">Phone Number</span>
                <input
                  type="text"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-zinc-50 border border-zinc-200 focus:border-orange-500 focus:bg-white rounded-xl text-xs text-zinc-900 outline-none transition-all font-mono shadow-2xs"
                />
              </div>

              {/* Real Email Toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-50 border border-zinc-200">
                <div className="flex items-center gap-2.5">
                  <Send size={15} className="text-orange-600" />
                  <div>
                    <div className="text-xs font-semibold text-zinc-900">Send Real Email to Inbox</div>
                    <div className="text-[10px] text-zinc-500">Delivers fresh payment link via SMTP</div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={sendRealEmail}
                  onChange={(e) => setSendRealEmail(e.target.checked)}
                  className="w-4 h-4 accent-orange-600 cursor-pointer"
                />
              </div>
            </div>

            {/* Failure Scenario Selector */}
            <div className="space-y-2 mb-6">
              <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold">
                3. Pick a Failure Scenario
              </label>

              <div className="grid grid-cols-2 gap-2">
                {[
                  {
                    id: "soft_funds",
                    title: "Not Enough Balance",
                    desc: "Temporary • System sends recovery email link",
                    color: "border-orange-500 text-orange-700 bg-orange-50/70",
                  },
                  {
                    id: "soft_timeout",
                    title: "Bank Network Timeout",
                    desc: "Temporary • Fresh link created & sent",
                    color: "border-amber-500 text-amber-700 bg-amber-50/70",
                  },
                  {
                    id: "hard_stolen",
                    title: "Card Stolen / Blocked",
                    desc: "Permanent • Safety Guard stops retry",
                    color: "border-rose-500 text-rose-700 bg-rose-50/70",
                  },
                  {
                    id: "capacity_bind",
                    title: "Low Value (Queued)",
                    desc: "Low profit • Queued to protect quota",
                    color: "border-zinc-400 text-zinc-700 bg-zinc-100",
                  },
                ].map((sc) => (
                  <button
                    key={sc.id}
                    type="button"
                    onClick={() => setSelectedScenario(sc.id as any)}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      selectedScenario === sc.id
                        ? `border-2 ${sc.color} shadow-xs font-semibold`
                        : "bg-zinc-50 border-zinc-200 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100/70"
                    }`}
                  >
                    <div className="text-xs font-bold font-mono">{sc.title}</div>
                    <div className="text-[10px] text-zinc-500 mt-0.5 leading-tight">{sc.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Primary Simulation Button */}
            <button
              onClick={() => handleSimulateCheckout()}
              disabled={simulating}
              className="w-full py-3.5 rounded-xl bg-black hover:bg-zinc-800 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {simulating ? (
                <RefreshCw size={16} className="animate-spin" />
              ) : (
                <>
                  <Play size={16} fill="white" />
                  <span>Simulate Failed Checkout &amp; Run Recovery</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* ===================================================================== */}
        {/* RIGHT COLUMN: LIVE MONITOR TAB & CLEAR EXPLANATION                    */}
        {/* ===================================================================== */}
        <div className="lg:col-span-7 space-y-6">
          <div className="p-6 rounded-2xl bg-white border border-zinc-200 shadow-sm">
            {/* View Switcher */}
            <div className="flex items-center justify-between pb-4 border-b border-zinc-100 mb-5">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-orange-500 animate-pulse" />
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-900">
                  Live Recovery Results
                </h3>
              </div>

              <div className="flex items-center gap-1 bg-zinc-100 p-1 rounded-lg border border-zinc-200">
                <button
                  onClick={() => setRightView("monitor")}
                  className={`px-3 py-1 rounded-md text-xs font-mono transition-all cursor-pointer ${
                    rightView === "monitor"
                      ? "bg-white text-zinc-900 font-bold shadow-xs border border-zinc-200"
                      : "text-zinc-500 hover:text-zinc-900"
                  }`}
                >
                  Monitor Card
                </button>
                <button
                  onClick={() => setRightView("trace")}
                  className={`px-3 py-1 rounded-md text-xs font-mono transition-all cursor-pointer ${
                    rightView === "trace"
                      ? "bg-white text-zinc-900 font-bold shadow-xs border border-zinc-200"
                      : "text-zinc-500 hover:text-zinc-900"
                  }`}
                >
                  Decision Trace
                </button>
              </div>
            </div>

            {/* Email Feedback Banner */}
            {feedbackNotice && (
              <div className="mb-4 p-3.5 rounded-xl bg-orange-50 border border-orange-200 text-xs text-orange-900 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-orange-600 shrink-0" />
                  <span>{feedbackNotice}</span>
                </div>
                <button
                  onClick={() => setFeedbackNotice(null)}
                  className="text-[10px] text-zinc-400 hover:text-zinc-700 cursor-pointer font-semibold"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* VIEW 1: PAYMENT MONITOR CARD (The 6 Columns) */}
            {rightView === "monitor" && (
              <div className="space-y-4">
                <div className="text-xs text-zinc-500">
                  This card shows exactly how the failed transaction appears in your live recovery stream.
                </div>

                {simulationResult ? (
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-5 space-y-4">
                    {/* The 6 Columns in Simple English */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
                      {/* Column 1: Failed Payment */}
                      <div className="p-3.5 rounded-lg bg-white border border-zinc-200 shadow-2xs">
                        <span className="text-[10px] text-zinc-400 block mb-1 font-semibold">1. FAILED PAYMENT</span>
                        <div className="text-lg font-bold text-zinc-900 font-mono">
                          {selectedProduct.priceDisplay}
                        </div>
                        <div className="text-[10px] text-orange-600 truncate mt-0.5 font-medium">
                          {simulationResult.opportunity_id}
                        </div>
                      </div>

                      {/* Column 2: Reason */}
                      <div className="p-3.5 rounded-lg bg-white border border-zinc-200 shadow-2xs">
                        <span className="text-[10px] text-zinc-400 block mb-1 font-semibold">2. REASON</span>
                        <div className="text-xs font-bold text-zinc-900 capitalize">
                          {(simulationResult.stages?.[1]?.data?.reason_code || selectedScenario).replace(/_/g, " ")}
                        </div>
                        <div className="mt-1">
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                              simulationResult.stages?.[1]?.data?.decline_type === "hard"
                                ? "bg-rose-50 text-rose-700 border border-rose-200"
                                : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            }`}
                          >
                            {simulationResult.stages?.[1]?.data?.decline_type === "hard"
                              ? "PERMANENT BLOCK"
                              : "TEMPORARY ISSUE"}
                          </span>
                        </div>
                      </div>

                      {/* Column 3: Trusted */}
                      <div className="p-3.5 rounded-lg bg-white border border-zinc-200 shadow-2xs">
                        <span className="text-[10px] text-zinc-400 block mb-1 font-semibold">3. TRUSTED</span>
                        <div className="flex items-center gap-2">
                          <span className="text-base font-bold text-zinc-900">88%</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
                            High Trust
                          </span>
                        </div>
                        <div className="text-[10px] text-zinc-500 truncate mt-0.5">
                          {customerName}
                        </div>
                      </div>

                      {/* Column 4: Repay Link */}
                      <div className="p-3.5 rounded-lg bg-white border border-zinc-200 shadow-2xs">
                        <span className="text-[10px] text-zinc-400 block mb-1 font-semibold">4. REPAY LINK</span>
                        {simulationResult.link_url ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <a
                                href={simulationResult.link_url}
                                target="_blank"
                                rel="noreferrer"
                                className="px-2.5 py-1 rounded bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 text-xs font-mono font-semibold flex items-center gap-1 transition-colors"
                              >
                                <span>Open Repay Link</span>
                                <ExternalLink size={12} />
                              </a>
                              <button
                                onClick={() => copyToClipboard(simulationResult.link_url)}
                                className="p-1.5 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-700 cursor-pointer border border-zinc-200 transition-colors"
                                title="Copy"
                              >
                                {copiedLink ? (
                                  <Check size={12} className="text-emerald-600" />
                                ) : (
                                  <Copy size={12} />
                                )}
                              </button>
                            </div>
                            <div className="text-[10px] text-zinc-500 truncate">
                              {simulationResult.link_url}
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs text-rose-600 font-semibold">
                            Blocked for Safety
                          </div>
                        )}
                      </div>

                      {/* Column 5: Attempted Repay */}
                      <div className="p-3.5 rounded-lg bg-white border border-zinc-200 shadow-2xs">
                        <span className="text-[10px] text-zinc-400 block mb-1 font-semibold">5. ATTEMPTED REPAY</span>
                        <div className="text-xs font-bold text-zinc-900">Attempt 1 of 3</div>
                        <div className="text-[10px] text-zinc-500 mt-0.5">Initial automated sweep</div>
                      </div>

                      {/* Column 6: Payment Status */}
                      <div className="p-3.5 rounded-lg bg-white border border-zinc-200 shadow-2xs">
                        <span className="text-[10px] text-zinc-400 block mb-1 font-semibold">6. PAYMENT STATUS</span>
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              simulationResult.payment_recovered
                                ? "bg-emerald-500"
                                : simulationResult.link_url
                                ? "bg-orange-500 animate-pulse"
                                : "bg-rose-500"
                            }`}
                          />
                          <span
                            className={
                              simulationResult.payment_recovered
                                ? "text-emerald-700"
                                : simulationResult.link_url
                                ? "text-orange-600 font-bold"
                                : "text-rose-600"
                            }
                          >
                            {simulationResult.payment_recovered
                              ? "RECOVERED ✓"
                              : simulationResult.link_url
                              ? "LINK ACTIVE"
                              : "BLOCKED"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Settle Action Button */}
                    {simulationResult.link_url && !simulationResult.payment_recovered && (
                      <div className="pt-2">
                        <button
                          onClick={handleSettlePayment}
                          disabled={reconciling}
                          className="w-full py-3 rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-xs font-mono font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
                        >
                          {reconciling ? (
                            <RefreshCw size={14} className="animate-spin" />
                          ) : (
                            <>
                              <CheckCircle2 size={16} />
                              <span>Simulate Customer Payment</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-16 text-center text-xs font-mono text-zinc-400 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/50">
                    <div>No test checkout run yet.</div>
                    <div className="mt-1">
                      Pick an item on the left and click &ldquo;Simulate Failed Checkout&rdquo;.
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* VIEW 2: HOW IT HAPPENED (Clear 7 steps) */}
            {rightView === "trace" && (
              <div className="space-y-3">
                {simulationResult?.stages ? (
                  simulationResult.stages.map((st: any) => {
                    const stepTitles: Record<number, string> = {
                      1: "Caught Failed Payment",
                      2: "Checked Failure Type",
                      3: "Calculated Expected Profit",
                      4: "Checked Priority Queue",
                      5: "Safety & Fraud Shield",
                      6: "Created Link & Sent Email",
                      7: "Ready for Money Settlement",
                    };

                    return (
                      <div
                        key={st.stage_number}
                        className="p-3.5 rounded-xl bg-white border border-zinc-200 text-xs font-mono space-y-1 shadow-2xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-zinc-900 flex items-center gap-2">
                            <span className="text-orange-600">Step 0{st.stage_number}:</span>
                            <span>{stepTitles[st.stage_number] || st.stage_name}</span>
                          </span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                              st.status === "PASSED" || st.status === "AUTHORIZED" || st.status === "READY_FOR_SETTLEMENT"
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : st.status === "DEFERRED"
                                ? "bg-amber-50 text-amber-700 border border-amber-200"
                                : "bg-rose-50 text-rose-700 border border-rose-200"
                            }`}
                          >
                            {st.status === "PASSED" || st.status === "AUTHORIZED"
                              ? "APPROVED ✓"
                              : st.status === "READY_FOR_SETTLEMENT"
                              ? "WAITING FOR BUYER"
                              : st.status}
                          </span>
                        </div>

                        {st.stage_number === 3 && (
                          <div className="text-[11px] text-zinc-600 pt-1">
                            Calculated expected recovery profit: <strong className="text-emerald-700">{st.data.iven_display}</strong> (Estimated)
                          </div>
                        )}

                        {st.stage_number === 5 && (
                          <div className="text-[11px] text-zinc-600 pt-1">
                            Fraud Check: <strong className="text-zinc-900">{st.data.verdict}</strong> — {st.data.summary_reason}
                          </div>
                        )}

                        {st.stage_number === 6 && st.data?.link_url && (
                          <div className="text-[11px] text-orange-600 pt-1 truncate">
                            Razorpay Link: {st.data.link_url}
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="py-16 text-center text-xs font-mono text-zinc-400 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/50">
                    Run a test checkout on the left to see the step-by-step breakdown.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
