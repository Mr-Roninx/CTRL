"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Sparkles,
  CheckCircle2,
  TrendingUp,
  Copy,
  Check,
  Code2,
  Webhook,
  Terminal,
  Radio,
  Send,
  ShoppingBag,
  PackageCheck,
  CreditCard,
  Smartphone,
  ShieldCheck,
  Zap,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { MobileRecoveryFlow } from "../components/landing/MobileRecoveryFlow";

export default function LandingPage() {
  const { token } = useAuth();
  const isSignedIn = Boolean(token);

  const [activeTab, setActiveTab] = useState<"script" | "webhook">("script");
  const [copiedCode, setCopiedCode] = useState(false);
  const [pingSuccess, setPingSuccess] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [subscribed, setSubscribed] = useState(false);

  const scriptCode = `<script src="https://cdn.ctrl.network/sdk/ctrl.js" data-key="ctrl_live_pk_9942a" async></script>`;
  const webhookUrl = `https://api.ctrl.network/v1/webhooks/razorpay/wh_live_839`;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handlePingTest = () => {
    setPinging(true);
    setTimeout(() => {
      setPinging(false);
      setPingSuccess(true);
      setTimeout(() => setPingSuccess(false), 3000);
    }, 600);
  };

  const handleNewsletterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput) return;
    setSubscribed(true);
    setTimeout(() => {
      setEmailInput("");
      setSubscribed(false);
    }, 3000);
  };

  return (
    <div className="min-h-screen w-full bg-white text-zinc-900 selection:bg-orange-200 selection:text-orange-950 font-sans">
      {/* ========================================================================= */}
      {/* SECTION 1: HERO WITH RADIANT SUNSET GRADIENT                              */}
      {/* ========================================================================= */}
      <div className="relative w-full bg-gradient-to-b from-[#fff7ed] via-[#ffedd5] via-[#fed7aa] to-[#ea580c] pt-4 pb-24 sm:pb-32 px-6 overflow-hidden">
        {/* Subtle Ambient Radial Glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[500px] bg-orange-400/25 blur-[140px] pointer-events-none" />

        {/* Top Navigation Bar */}
        <header className="max-w-7xl mx-auto flex items-center justify-between py-3 mb-16 sm:mb-20 relative z-20">
          {/* Brand Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-orange-600 to-amber-400 p-[1.5px] shadow-sm">
              <div className="w-full h-full bg-white rounded-[9px] flex items-center justify-center font-extrabold text-base text-orange-600 group-hover:scale-105 transition-transform">
                C
              </div>
            </div>
            <span className="font-extrabold text-xl tracking-tight text-zinc-950">CTRL</span>
          </Link>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-zinc-800">
            <a href="#features" className="hover:text-black transition-colors">
              Capabilities
            </a>
            <a href="#order-recovery" className="hover:text-black transition-colors flex items-center gap-1.5 font-semibold text-orange-600">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-600 animate-pulse" />
              <span>Order Recovery</span>
            </a>
            <a href="#working" className="hover:text-black transition-colors">
              How It Works
            </a>
            <a href="#integration" className="hover:text-black transition-colors">
              Integration
            </a>
            <Link href="/test-ground" className="hover:text-black transition-colors">
              Simulator
            </Link>
            <Link href="/demo-store" className="hover:text-black transition-colors">
              Demo Store
            </Link>
          </nav>

          {/* Navigation Action Buttons */}
          <div className="flex items-center gap-3">
            <Link
              href="/test-ground"
              className="btn-suno-outline text-xs sm:text-sm font-medium flex items-center gap-1.5"
            >
              <Sparkles size={14} className="text-orange-500" />
              <span>Test Page</span>
            </Link>

            {isSignedIn ? (
              <Link
                href="/dashboard"
                className="btn-suno-black text-xs sm:text-sm font-medium"
              >
                Launch Dashboard
              </Link>
            ) : (
              <Link
                href="/login"
                className="btn-suno-black text-xs sm:text-sm font-medium"
              >
                Sign In
              </Link>
            )}
          </div>
        </header>

        {/* Hero Body Content */}
        <div className="max-w-4xl mx-auto text-center relative z-10 pt-4 pb-6">
          {/* Announcement Tag */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/90 text-white text-xs font-medium mb-8 shadow-md hover:bg-black transition-all cursor-pointer">
            <span className="px-2 py-0.5 rounded bg-orange-600 text-[10px] font-bold text-white uppercase tracking-wider">
              Autonomous
            </span>
            <span className="text-zinc-200">Turn Failed Razorpay Checkouts Into Revenue</span>
            <span className="text-orange-400">→</span>
          </div>

          {/* Giant Bold White Headline */}
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold text-white tracking-tight leading-[1.08] mb-6 drop-shadow-sm">
            Stop Losing Customers
            <br />
            At Checkout.
          </h1>

          {/* Catchy, High-Converting Subtitle */}
          <p className="text-base sm:text-lg text-white/95 max-w-2xl mx-auto font-normal leading-relaxed mb-10">
            When a payment drops, CTRL steps in within milliseconds with a personalized, 1-click recovery link via WhatsApp and SMS. Zero spam. 100% on autopilot.
          </p>

          {/* Action Button Pair */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            {isSignedIn ? (
              <Link
                href="/dashboard"
                className="btn-suno-black w-full sm:w-auto px-8 py-3.5 text-sm font-semibold rounded-xl shadow-lg"
              >
                <span>Launch Dashboard</span>
                <ArrowRight size={16} />
              </Link>
            ) : (
              <Link
                href="/login"
                className="btn-suno-black w-full sm:w-auto px-8 py-3.5 text-sm font-semibold rounded-xl shadow-lg"
              >
                <span>Start Recovering Payments</span>
                <ArrowRight size={16} />
              </Link>
            )}

            <Link
              href="/test-ground"
              className="btn-suno-outline w-full sm:w-auto px-8 py-3.5 text-sm font-semibold rounded-xl shadow-sm bg-white flex items-center justify-center gap-2"
            >
              <Sparkles size={15} className="text-orange-600" />
              <span>Try Live Simulator</span>
            </Link>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SECTION 2: THREE VALUE-PACKED FEATURE CARDS                               */}
      {/* ========================================================================= */}
      <section id="features" className="py-24 px-6 max-w-7xl mx-auto w-full">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-zinc-950">
            Built To Maximize Every Captured Rupee
          </h2>
          <p className="text-base text-zinc-600 mt-3">
            Intelligent recovery that protects customer goodwill while turning drop-offs into loyal buyers.
          </p>
        </div>

        {/* 3 Prominent Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
          {/* Card 1 */}
          <div className="card-suno flex flex-col justify-between">
            <div>
              <h3 className="text-2xl sm:text-3xl font-bold text-zinc-950 tracking-tight mb-4">
                Instant 1-Click Recovery
              </h3>
              <p className="text-sm text-zinc-600 leading-relaxed font-normal mb-8">
                Recover dropped checkouts in under 150 milliseconds. Mobile-optimized Razorpay checkout links delivered straight to buyers on WhatsApp and SMS right at the peak moment of intent.
              </p>
            </div>

            {/* Bottom Latency Illustration */}
            <div className="pt-6 border-t border-zinc-100">
              <div className="flex items-center justify-between gap-1.5 h-12 px-2 bg-orange-50/50 rounded-xl border border-orange-100/80">
                {[30, 50, 80, 45, 90, 65, 35, 75, 100, 60, 40, 85, 95, 50, 70, 40, 90, 60, 30].map(
                  (height, i) => (
                    <div
                      key={i}
                      className="flex-1 bg-gradient-to-t from-orange-400 to-amber-300 rounded-full"
                      style={{ height: `${height}%` }}
                    />
                  )
                )}
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] font-medium text-zinc-400">
                <span>SPEED: &lt;150MS</span>
                <span className="text-orange-600 font-semibold">100% AUTOMATED</span>
              </div>
            </div>
          </div>

          {/* Card 2: Featured with Orange Border */}
          <div className="card-suno-featured flex flex-col justify-between relative">
            <div className="absolute -top-3 left-8 px-3 py-0.5 rounded-full bg-orange-600 text-white text-[10px] font-bold tracking-wider uppercase shadow-sm">
              Smart Decision Engine
            </div>
            <div>
              <h3 className="text-2xl sm:text-3xl font-bold text-zinc-950 tracking-tight mb-4">
                Acts Only When It Counts
              </h3>
              <p className="text-sm text-zinc-600 leading-relaxed font-normal mb-8">
                Why waste money retrying dead cards or annoying shoppers who are already completing payment? CTRL calculates the true value of reaching out and acts only when success is likely.
              </p>
            </div>

            {/* Orange Pill Button & Carousel Dots */}
            <div className="pt-6 border-t border-orange-100">
              <Link
                href="/test-ground"
                className="btn-suno-pill w-full justify-center text-sm font-semibold"
              >
                <span>Test Live Decision Flow</span>
                <ArrowRight size={15} />
              </Link>

              {/* Carousel Dots */}
              <div className="flex items-center justify-center gap-2 mt-4">
                <span className="w-2 h-2 rounded-full bg-orange-500" />
                <span className="w-2 h-2 rounded-full bg-zinc-200" />
                <span className="w-2 h-2 rounded-full bg-zinc-200" />
              </div>
              <div className="text-center text-[11px] text-zinc-400 mt-2">
                Active real-time profitability check
              </div>
            </div>
          </div>

          {/* Card 3 */}
          <div className="card-suno flex flex-col justify-between">
            <div>
              <h3 className="text-2xl sm:text-3xl font-bold text-zinc-950 tracking-tight mb-4">
                Zero Spam. Pure Safety.
              </h3>
              <p className="text-sm text-zinc-600 leading-relaxed font-normal mb-8">
                Strict compliance rules ensure duplicate payment links are blocked, retry limits are respected, and fraud declines are never nudged. Your customer experience stays pristine.
              </p>
            </div>

            {/* Bottom Channels / Icons */}
            <div className="pt-6 border-t border-zinc-100">
              <div className="flex items-center justify-around py-3 px-2 bg-zinc-50 rounded-xl border border-zinc-200 text-zinc-600">
                <span className="font-semibold text-xs text-zinc-800">Razorpay</span>
                <span className="text-zinc-300">|</span>
                <span className="font-semibold text-xs text-zinc-800">WhatsApp</span>
                <span className="text-zinc-300">|</span>
                <span className="font-semibold text-xs text-zinc-800">Email</span>
                <span className="text-zinc-300">|</span>
                <span className="font-semibold text-xs text-zinc-800">SMS</span>
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] font-medium text-zinc-400">
                <span>DETERMINISTIC COMPLIANCE</span>
                <span className="text-emerald-600 font-semibold">100% BRAND SAFE</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* SECTION 2.5: REPLAY LINK ORDER RECOVERY (4 Mobile Screens Flow)           */}
      {/* ========================================================================= */}
      <section id="order-recovery" className="py-20 px-6 max-w-7xl mx-auto w-full border-t border-zinc-200">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-100 border border-orange-200 text-orange-700 text-xs font-bold uppercase tracking-wider mb-3">
            <Sparkles size={13} />
            <span>Instant Recovery Story</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-zinc-950">
            What Happens to the Purchase?
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-600 to-amber-600">
              Order Confirmed Instantly Without Re-ordering.
            </span>
          </h2>
          <p className="text-base sm:text-lg text-zinc-600 mt-4 leading-relaxed max-w-2xl mx-auto">
            See how CTRL intercepts bank failure and turns dropped checkouts into paid, confirmed orders in 4 visual steps.
          </p>
        </div>

        {/* 4 Interactive Mobile Screens Component */}
        <MobileRecoveryFlow />

        {/* 3 Core Highlights */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
          <div className="p-5 rounded-2xl border border-zinc-200 bg-white shadow-2xs">
            <div className="font-bold text-sm text-zinc-900 mb-1 flex items-center gap-2">
              <Sparkles size={16} className="text-orange-600" />
              <span>Zero Re-order From Scratch</span>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Customers never have to re-add items to the cart or re-enter their shipping addresses.
            </p>
          </div>

          <div className="p-5 rounded-2xl border border-zinc-200 bg-white shadow-2xs">
            <div className="font-bold text-sm text-zinc-900 mb-1 flex items-center gap-2">
              <ShieldCheck size={16} className="text-emerald-600" />
              <span>Safe Single-Use Protection</span>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Razorpay replay links automatically lock after successful payment. No double billing risk.
            </p>
          </div>

          <div className="p-5 rounded-2xl border border-zinc-200 bg-white shadow-2xs">
            <div className="font-bold text-sm text-zinc-900 mb-1 flex items-center gap-2">
              <PackageCheck size={16} className="text-blue-600" />
              <span>Instant Warehouse Fulfillment</span>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              As soon as UPI or card payment settles, the order is marked paid and dispatch is initiated.
            </p>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* SECTION 3: WORKING PIPELINE (How It Works)                                */}
      {/* ========================================================================= */}
      <section id="working" className="py-20 px-6 max-w-7xl mx-auto w-full border-t border-zinc-200">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <div className="text-xs font-bold text-orange-600 uppercase tracking-widest mb-2">
            Execution Flow
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-zinc-950">
            How It Works
          </h2>
          <p className="text-base text-zinc-600 mt-2">
            Three simple, automated steps from failed checkout to captured sale.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="card-suno flex flex-col justify-between">
            <div>
              <span className="text-xs font-bold text-orange-600 bg-orange-50 px-2.5 py-1 rounded-md border border-orange-200 inline-block mb-3">
                STEP 01
              </span>
              <h3 className="text-xl font-bold text-zinc-950 mb-2">Detect Drop-off</h3>
              <p className="text-sm text-zinc-600 leading-relaxed">
                The instant a payment drops on Razorpay, CTRL captures the failure event, reason code, and buyer profile before they exit your checkout.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-zinc-100 text-xs font-mono text-zinc-500 flex items-center gap-2">
              <Radio size={14} className="text-orange-500" />
              <span>Real-time webhook capture</span>
            </div>
          </div>

          <div className="card-suno flex flex-col justify-between">
            <div>
              <span className="text-xs font-bold text-orange-600 bg-orange-50 px-2.5 py-1 rounded-md border border-orange-200 inline-block mb-3">
                STEP 02
              </span>
              <h3 className="text-xl font-bold text-zinc-950 mb-2">Evaluate &amp; Protect</h3>
              <p className="text-sm text-zinc-600 leading-relaxed">
                CTRL determines if recovery makes economic sense. We automatically bypass permanent card cancellations and shoppers already retrying.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-zinc-100 text-xs font-mono text-zinc-500 flex items-center gap-2">
              <TrendingUp size={14} className="text-orange-500" />
              <span>Smart recovery decision</span>
            </div>
          </div>

          <div className="card-suno flex flex-col justify-between">
            <div>
              <span className="text-xs font-bold text-orange-600 bg-orange-50 px-2.5 py-1 rounded-md border border-orange-200 inline-block mb-3">
                STEP 03
              </span>
              <h3 className="text-xl font-bold text-zinc-950 mb-2">Recover &amp; Win</h3>
              <p className="text-sm text-zinc-600 leading-relaxed">
                A branded, secure Razorpay link is sent to the shopper's phone. As soon as the customer completes payment via UPI or Cards, the purchase immediately turns into a confirmed, successful order. The store automatically fulfills the sale with zero manual intervention.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-zinc-100 text-xs font-mono text-zinc-500 flex items-center gap-2">
              <Send size={14} className="text-orange-500" />
              <span>Instant captured sale &amp; order fulfillment</span>
            </div>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* SECTION 4: INTEGRATION (60-Second Setup)                                  */}
      {/* ========================================================================= */}
      <section id="integration" className="py-20 px-6 max-w-5xl mx-auto w-full border-t border-zinc-200">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <div className="text-xs font-bold text-orange-600 uppercase tracking-widest mb-2">
            Instant Setup
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-zinc-950">
            Live In 60 Seconds
          </h2>
          <p className="text-base text-zinc-600 mt-2">
            Paste a single lightweight script tag onto your checkout or connect your Razorpay webhook. Zero backend rewrites.
          </p>
        </div>

        <div className="card-suno p-6 sm:p-10">
          <div className="flex items-center justify-between pb-6 border-b border-zinc-200 flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab("script")}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${
                  activeTab === "script"
                    ? "btn-suno-black"
                    : "bg-zinc-100 text-zinc-600 hover:text-black"
                }`}
              >
                <Code2 size={14} />
                <span>DROP-IN SDK (ctrl.js)</span>
              </button>

              <button
                onClick={() => setActiveTab("webhook")}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${
                  activeTab === "webhook"
                    ? "btn-suno-black"
                    : "bg-zinc-100 text-zinc-600 hover:text-black"
                }`}
              >
                <Webhook size={14} />
                <span>RAZORPAY WEBHOOK</span>
              </button>
            </div>

            <button
              onClick={handlePingTest}
              disabled={pinging}
              className="px-3.5 py-1.5 rounded-lg bg-zinc-50 hover:bg-zinc-100 border border-zinc-300 text-xs font-mono font-medium text-zinc-700 flex items-center gap-1.5 transition-all cursor-pointer"
            >
              {pinging ? (
                <span className="w-2 h-2 rounded-full bg-orange-500 animate-ping" />
              ) : pingSuccess ? (
                <Check size={13} className="text-emerald-600" />
              ) : (
                <Terminal size={13} />
              )}
              <span>{pingSuccess ? "PING OK (200)" : "TEST CONNECTION"}</span>
            </button>
          </div>

          <div className="pt-6">
            {activeTab === "script" ? (
              <div className="space-y-4">
                <div className="flex justify-between items-center text-xs font-mono text-zinc-500">
                  <span>Paste before the closing &lt;/body&gt; tag:</span>
                  <button
                    onClick={() => handleCopy(scriptCode)}
                    className="flex items-center gap-1 text-orange-600 hover:underline cursor-pointer font-semibold"
                  >
                    {copiedCode ? <Check size={14} /> : <Copy size={14} />}
                    <span>{copiedCode ? "COPIED" : "COPY SCRIPT"}</span>
                  </button>
                </div>

                <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 font-mono text-xs text-orange-300 overflow-x-auto shadow-inner">
                  <code>{scriptCode}</code>
                </div>

                <div className="text-[11px] font-mono text-zinc-500 flex items-center gap-2">
                  <CheckCircle2 size={13} className="text-emerald-600" />
                  <span>Compatible with standard Razorpay SDK, Shopify, WooCommerce, and React checkouts.</span>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-between items-center text-xs font-mono text-zinc-500">
                  <span>Paste into Razorpay Dashboard &gt; Webhooks:</span>
                  <button
                    onClick={() => handleCopy(webhookUrl)}
                    className="flex items-center gap-1 text-orange-600 hover:underline cursor-pointer font-semibold"
                  >
                    {copiedCode ? <Check size={14} /> : <Copy size={14} />}
                    <span>{copiedCode ? "COPIED" : "COPY URL"}</span>
                  </button>
                </div>

                <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 font-mono text-xs text-orange-300 overflow-x-auto shadow-inner">
                  <code>{webhookUrl}</code>
                </div>

                <div className="text-[11px] font-mono text-zinc-500 flex items-center gap-2">
                  <CheckCircle2 size={13} className="text-emerald-600" />
                  <span>Subscribes to <strong>payment.failed</strong> and <strong>payment_link.paid</strong> events.</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* SECTION 5: APP BANNER                                                    */}
      {/* ========================================================================= */}
      <section className="py-16 px-6 max-w-6xl mx-auto w-full">
        <div className="p-12 sm:p-16 rounded-3xl bg-gradient-to-r from-amber-500 via-orange-500 to-orange-600 text-white text-center shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 rounded-full blur-3xl pointer-events-none" />
          
          <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight mb-4">
            Turn Dropped Checkouts Into Pure Revenue
          </h2>

          <p className="text-base sm:text-lg text-white/90 max-w-xl mx-auto mb-8 font-normal">
            Join high-growth brands saving up to 34% of dropped transactions automatically every day.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            {isSignedIn ? (
              <Link
                href="/dashboard"
                className="btn-suno-black bg-black text-white hover:bg-zinc-800 px-8 py-3.5 text-sm font-semibold rounded-xl shadow-lg"
              >
                <span>Launch Dashboard</span>
                <ArrowRight size={15} />
              </Link>
            ) : (
              <Link
                href="/login"
                className="btn-suno-black bg-black text-white hover:bg-zinc-800 px-8 py-3.5 text-sm font-semibold rounded-xl shadow-lg"
              >
                <span>Get Started Now</span>
                <ArrowRight size={15} />
              </Link>
            )}

            <Link
              href="/test-ground"
              className="btn-suno-outline bg-white text-black hover:bg-zinc-100 border-none px-8 py-3.5 text-sm font-semibold rounded-xl shadow-md"
            >
              <span>Explore Interactive Simulator</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* SECTION 6: CLEAN WHITE FOOTER                                             */}
      {/* ========================================================================= */}
      <footer className="w-full bg-white border-t border-zinc-200 py-16 px-6">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-12 pb-12 border-b border-zinc-200">
          {/* Newsletter Column */}
          <div className="md:col-span-6 space-y-4">
            <h3 className="text-xl font-bold text-zinc-950">Stay Ahead On Payments</h3>
            <form onSubmit={handleNewsletterSubmit} className="flex max-w-md gap-2">
              <input
                type="email"
                placeholder="Enter your email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-zinc-300 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent text-zinc-900 bg-white"
                required
              />
              <button
                type="submit"
                className="btn-suno-black px-6 py-2.5 text-sm font-semibold rounded-lg"
              >
                {subscribed ? "Subscribed!" : "Subscribe"}
              </button>
            </form>
            <p className="text-xs text-zinc-500">
              Get monthly updates on Razorpay payment recovery intelligence and failure benchmarks.
            </p>
          </div>

          {/* Brand Directory Column */}
          <div className="md:col-span-3 space-y-3">
            <h4 className="text-sm font-bold text-zinc-950">Product</h4>
            <ul className="space-y-2 text-sm text-zinc-600 font-normal">
              <li>
                <Link href="/test-ground" className="hover:text-black transition-colors">
                  Recovery Simulator
                </Link>
              </li>
              <li>
                <Link href="/demo-store" className="hover:text-black transition-colors">
                  Demo Storefront
                </Link>
              </li>
              <li>
                <Link href="/dashboard" className="hover:text-black transition-colors">
                  Merchant Dashboard
                </Link>
              </li>
            </ul>
          </div>

          {/* Support / Platform Directory Column */}
          <div className="md:col-span-3 space-y-3">
            <h4 className="text-sm font-bold text-zinc-950">Platform</h4>
            <ul className="space-y-2 text-sm text-zinc-600 font-normal">
              <li>
                <Link href="/dashboard" className="hover:text-black transition-colors">
                  Control Dashboard
                </Link>
              </li>
              <li>
                <Link href="/dashboard/settings/integrations" className="hover:text-black transition-colors">
                  Razorpay Integration
                </Link>
              </li>
              <li>
                <Link href="/dashboard/audit" className="hover:text-black transition-colors">
                  Audit Ledger
                </Link>
              </li>
              <li>
                <Link href="/dashboard/setup" className="hover:text-black transition-colors">
                  Developer Setup
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Legal Copyright */}
        <div className="max-w-7xl mx-auto pt-8 flex flex-col sm:flex-row items-center justify-between text-xs text-zinc-500 gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-zinc-900">CTRL</span>
            <span>/</span>
            <span>Autonomous Payment Recovery Control Plane</span>
          </div>
          <div>
            * Razorpay Test Mode Compliant. Model-estimated probabilities.
          </div>
        </div>
      </footer>
    </div>
  );
}
