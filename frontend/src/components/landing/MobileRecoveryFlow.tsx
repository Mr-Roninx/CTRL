"use client";

import React, { useState, useEffect } from "react";
import {
  XCircle,
  Clock,
  Sparkles,
  CheckCircle2,
  PackageCheck,
  ArrowRight,
  ShieldCheck,
  Zap,
  ShoppingBag,
  ExternalLink,
  Play,
  RotateCcw,
} from "lucide-react";

export function MobileRecoveryFlow() {
  const [activeStep, setActiveStep] = useState<number>(1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Auto-play story simulation
  useEffect(() => {
    let timer: any;
    if (isPlaying) {
      timer = setInterval(() => {
        setActiveStep((prev) => {
          if (prev >= 4) {
            setIsPlaying(false);
            return 4;
          }
          return prev + 1;
        });
      }, 2000);
    }
    return () => clearInterval(timer);
  }, [isPlaying]);

  const handlePlayStory = () => {
    setActiveStep(1);
    setIsPlaying(true);
  };

  const handleResetStory = () => {
    setIsPlaying(false);
    setActiveStep(1);
  };

  return (
    <div className="w-full">
      {/* Interactive Controls Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-8 pb-4 border-b border-zinc-200">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
            Interactive Customer Journey:
          </span>
          <div className="flex items-center gap-1.5">
            {[1, 2, 3, 4].map((step) => (
              <button
                key={step}
                onClick={() => {
                  setIsPlaying(false);
                  setActiveStep(step);
                }}
                className={`w-7 h-7 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center justify-center ${
                  activeStep === step
                    ? "bg-orange-600 text-white shadow-sm scale-110"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
              >
                {step}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isPlaying ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-100 text-orange-700 text-xs font-semibold animate-pulse">
              <span className="w-2 h-2 rounded-full bg-orange-600" />
              <span>Playing Story (Step {activeStep}/4)...</span>
            </span>
          ) : (
            <button
              onClick={handlePlayStory}
              className="btn-suno-black py-1.5 px-3.5 text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <Play size={12} className="fill-white" />
              <span>Watch Auto-Play Flow</span>
            </button>
          )}

          {activeStep > 1 && !isPlaying && (
            <button
              onClick={handleResetStory}
              className="p-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-600 transition-colors cursor-pointer"
              title="Reset to Step 1"
            >
              <RotateCcw size={14} />
            </button>
          )}
        </div>
      </div>

      {/* The 4 Mobile Screens Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 items-start">
        {/* ========================================================================= */}
        {/* SCREEN 1: PAYMENT FAILED                                                  */}
        {/* ========================================================================= */}
        <div
          onClick={() => setActiveStep(1)}
          className={`transition-all duration-300 cursor-pointer ${
            activeStep === 1
              ? "scale-[1.02] ring-2 ring-orange-500 rounded-[38px]"
              : "opacity-85 hover:opacity-100"
          }`}
        >
          {/* Step Tag */}
          <div className="flex items-center justify-between mb-2.5 px-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              Screen 01
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-700">
              Payment Failed
            </span>
          </div>

          {/* Smartphone Chassis */}
          <div className="w-full rounded-[36px] bg-zinc-950 p-2 shadow-xl border border-zinc-800">
            {/* Phone Bezel Surface */}
            <div className="bg-zinc-50 rounded-[28px] overflow-hidden flex flex-col h-[460px] border border-zinc-200/50 text-zinc-900 font-sans relative select-none">
              {/* Top Dynamic Island & Status Bar */}
              <div className="pt-2 px-4 flex items-center justify-between text-[10px] text-zinc-400 font-mono">
                <span>9:41</span>
                <div className="w-14 h-3 bg-zinc-900 rounded-full mx-auto" />
                <span>5G 100%</span>
              </div>

              {/* Screen App Bar */}
              <div className="px-4 py-2 border-b border-zinc-200/70 bg-white flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-bold text-xs text-zinc-900">
                  <div className="w-4 h-4 rounded bg-orange-600 text-white text-[9px] flex items-center justify-center font-black">
                    A
                  </div>
                  <span>Apex CyberStore</span>
                </div>
                <span className="text-[10px] text-zinc-400">Checkout</span>
              </div>

              {/* Screen Body */}
              <div className="p-4 flex-1 flex flex-col justify-between">
                <div>
                  {/* Order Item */}
                  <div className="p-2.5 rounded-xl bg-white border border-zinc-200/80 mb-3 flex items-center gap-2.5 shadow-2xs">
                    <div className="w-9 h-9 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-700">
                      <ShoppingBag size={16} />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-zinc-900">Apex Pro Headphones</div>
                      <div className="text-[10px] text-zinc-500 font-mono">Qty: 1 • ₹1,499.00</div>
                    </div>
                  </div>

                  {/* Failure Alert Box */}
                  <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-center space-y-1.5">
                    <div className="w-8 h-8 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
                      <XCircle size={18} />
                    </div>
                    <div className="text-xs font-bold text-rose-900">Payment Failed</div>
                    <div className="text-[10px] text-rose-700 leading-tight">
                      Bank Network Timeout (3DS OTP Dropped)
                    </div>
                  </div>

                  {/* Cart Hold Notice */}
                  <div className="mt-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200 flex items-center gap-2 text-[10px] text-amber-900">
                    <Clock size={14} className="text-amber-600 shrink-0" />
                    <span>Cart Reserved: Item held for 15 mins</span>
                  </div>
                </div>

                {/* Bottom Action Area */}
                <div className="space-y-1.5 pt-2">
                  <button className="w-full py-2 rounded-lg bg-zinc-200 text-zinc-500 text-xs font-semibold cursor-not-allowed">
                    Card Authorization Failed
                  </button>
                  <div className="text-center text-[9px] font-mono text-zinc-400">
                    ⚡ CTRL Intercepting in &lt;150ms...
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SCREEN 2: CTRL CAPTURE & ANALYSIS                                         */}
        {/* ========================================================================= */}
        <div
          onClick={() => setActiveStep(2)}
          className={`transition-all duration-300 cursor-pointer ${
            activeStep === 2
              ? "scale-[1.02] ring-2 ring-orange-500 rounded-[38px]"
              : "opacity-85 hover:opacity-100"
          }`}
        >
          {/* Step Tag */}
          <div className="flex items-center justify-between mb-2.5 px-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              Screen 02
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-orange-100 text-orange-700">
              CTRL Capture &amp; Link
            </span>
          </div>

          {/* Smartphone Chassis */}
          <div className="w-full rounded-[36px] bg-zinc-950 p-2 shadow-xl border border-zinc-800">
            {/* Phone Bezel Surface */}
            <div className="bg-[#eef2f5] rounded-[28px] overflow-hidden flex flex-col h-[460px] border border-zinc-200/50 text-zinc-900 font-sans relative select-none">
              {/* Top Dynamic Island & Status Bar */}
              <div className="pt-2 px-4 flex items-center justify-between text-[10px] text-zinc-400 font-mono bg-[#075e54] text-white/90">
                <span>9:41</span>
                <div className="w-14 h-3 bg-zinc-900 rounded-full mx-auto" />
                <span>5G 100%</span>
              </div>

              {/* Screen WhatsApp Header */}
              <div className="px-3 py-2 bg-[#075e54] text-white flex items-center justify-between shadow-xs">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-bold">
                    A
                  </div>
                  <div>
                    <div className="text-[11px] font-bold flex items-center gap-1">
                      <span>Apex Store</span>
                      <ShieldCheck size={11} className="text-emerald-300" />
                    </div>
                    <div className="text-[9px] text-emerald-100">Verified Business via CTRL</div>
                  </div>
                </div>
                <span className="text-[9px] text-white/80">9:41 AM</span>
              </div>

              {/* Chat Canvas */}
              <div className="p-3 flex-1 flex flex-col justify-between bg-[#efeae2]">
                <div className="space-y-2">
                  {/* Message Bubble */}
                  <div className="p-3 rounded-xl rounded-tl-xs bg-white text-zinc-900 shadow-2xs border border-zinc-200/60 space-y-2">
                    <div className="text-[11px] leading-relaxed">
                      Hi <strong>Aarav</strong> 👋
                      <br />
                      Your payment of <strong>₹1,499</strong> dropped due to a bank timeout.
                    </div>
                    <div className="text-[10px] text-zinc-600 bg-orange-50 p-1.5 rounded border border-orange-200/70">
                      🔒 <strong>Cart Saved:</strong> Your headphones are reserved on hold.
                    </div>

                    {/* 1-Click Pay Link CTA */}
                    <div className="pt-1">
                      <div className="w-full py-2 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold text-center flex items-center justify-center gap-1.5 shadow-xs">
                        <Zap size={12} className="fill-amber-300 text-amber-300" />
                        <span>Pay ₹1,499 (1-Click Link)</span>
                        <ExternalLink size={10} />
                      </div>
                    </div>
                    <div className="text-[9px] text-zinc-400 text-center">
                      Official Razorpay Secure Link
                    </div>
                  </div>

                  {/* AI Analysis Tag */}
                  <div className="p-2 rounded-lg bg-white/80 border border-zinc-200/70 text-[9px] text-zinc-600 space-y-0.5">
                    <div className="font-bold text-orange-600 flex items-center gap-1">
                      <Sparkles size={10} />
                      <span>CTRL Autonomous Diagnostic</span>
                    </div>
                    <div>Root cause: Temporary 3DS timeout. High recovery intent.</div>
                  </div>
                </div>

                <div className="text-center text-[9px] font-mono text-zinc-400 pt-1">
                  Customer taps the secure link ⚡
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SCREEN 3: PAYMENT SUCCESS (RAZORPAY REPLAY)                               */}
        {/* ========================================================================= */}
        <div
          onClick={() => setActiveStep(3)}
          className={`transition-all duration-300 cursor-pointer ${
            activeStep === 3
              ? "scale-[1.02] ring-2 ring-orange-500 rounded-[38px]"
              : "opacity-85 hover:opacity-100"
          }`}
        >
          {/* Step Tag */}
          <div className="flex items-center justify-between mb-2.5 px-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              Screen 03
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
              Payment Succeeded
            </span>
          </div>

          {/* Smartphone Chassis */}
          <div className="w-full rounded-[36px] bg-zinc-950 p-2 shadow-xl border border-zinc-800">
            {/* Phone Bezel Surface */}
            <div className="bg-white rounded-[28px] overflow-hidden flex flex-col h-[460px] border border-zinc-200/50 text-zinc-900 font-sans relative select-none">
              {/* Top Dynamic Island & Status Bar */}
              <div className="pt-2 px-4 flex items-center justify-between text-[10px] text-zinc-400 font-mono">
                <span>9:42</span>
                <div className="w-14 h-3 bg-zinc-900 rounded-full mx-auto" />
                <span>5G 100%</span>
              </div>

              {/* Razorpay Brand Bar */}
              <div className="px-4 py-2 border-b border-zinc-100 flex items-center justify-between bg-zinc-50">
                <span className="text-[10px] font-bold text-blue-600 tracking-wide">
                  RAZORPAY SECURE
                </span>
                <span className="text-[9px] font-mono text-zinc-400">rzp.io/i/plink_7821</span>
              </div>

              {/* Payment Success Screen Body */}
              <div className="p-4 flex-1 flex flex-col justify-between text-center">
                <div className="pt-3 space-y-3">
                  {/* Green Success Check */}
                  <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-inner">
                    <CheckCircle2 size={32} />
                  </div>

                  <div>
                    <div className="text-sm font-extrabold text-emerald-950">Payment Successful!</div>
                    <div className="text-xl font-black text-zinc-900 mt-0.5">₹1,499.00</div>
                  </div>

                  {/* Payment Method Details */}
                  <div className="p-2.5 rounded-xl bg-zinc-50 border border-zinc-200 text-[10px] text-left space-y-1">
                    <div className="flex justify-between text-zinc-500">
                      <span>Method:</span>
                      <span className="font-bold text-zinc-900">UPI (Google Pay)</span>
                    </div>
                    <div className="flex justify-between text-zinc-500">
                      <span>Paid to:</span>
                      <span className="font-bold text-zinc-900">Apex CyberStore</span>
                    </div>
                    <div className="flex justify-between text-zinc-500">
                      <span>Txn ID:</span>
                      <span className="font-mono text-zinc-700">pay_Q83n92kds1</span>
                    </div>
                  </div>
                </div>

                {/* Bottom Verification Seal */}
                <div className="space-y-1 pt-2 border-t border-zinc-100">
                  <div className="text-[9px] font-bold text-emerald-700 flex items-center justify-center gap-1">
                    <ShieldCheck size={11} />
                    <span>Reconciled via CTRL Truth Engine</span>
                  </div>
                  <div className="text-[8px] text-zinc-400">
                    Redirecting back to order confirmation...
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SCREEN 4: ORDER CONFIRMED (WITHOUT RE-ORDERING)                           */}
        {/* ========================================================================= */}
        <div
          onClick={() => setActiveStep(4)}
          className={`transition-all duration-300 cursor-pointer ${
            activeStep === 4
              ? "scale-[1.02] ring-2 ring-orange-500 rounded-[38px]"
              : "opacity-85 hover:opacity-100"
          }`}
        >
          {/* Step Tag */}
          <div className="flex items-center justify-between mb-2.5 px-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              Screen 04
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-orange-600 text-white shadow-2xs">
              Order Confirmed ✓
            </span>
          </div>

          {/* Smartphone Chassis */}
          <div className="w-full rounded-[36px] bg-zinc-950 p-2 shadow-xl border border-zinc-800">
            {/* Phone Bezel Surface */}
            <div className="bg-white rounded-[28px] overflow-hidden flex flex-col h-[460px] border border-zinc-200/50 text-zinc-900 font-sans relative select-none">
              {/* Top Dynamic Island & Status Bar */}
              <div className="pt-2 px-4 flex items-center justify-between text-[10px] text-zinc-400 font-mono">
                <span>9:42</span>
                <div className="w-14 h-3 bg-zinc-900 rounded-full mx-auto" />
                <span>5G 100%</span>
              </div>

              {/* Screen App Bar */}
              <div className="px-4 py-2 border-b border-zinc-200/70 bg-white flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-bold text-xs text-zinc-900">
                  <div className="w-4 h-4 rounded bg-orange-600 text-white text-[9px] flex items-center justify-center font-black">
                    A
                  </div>
                  <span>Apex CyberStore</span>
                </div>
                <span className="text-[10px] text-emerald-600 font-bold">PAID</span>
              </div>

              {/* Screen Body */}
              <div className="p-4 flex-1 flex flex-col justify-between">
                <div>
                  {/* Confirmed Order Hero */}
                  <div className="text-center pt-2 pb-3 space-y-1">
                    <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                      <PackageCheck size={22} />
                    </div>
                    <div className="text-xs font-bold text-zinc-900">Order #APX-7821 Confirmed!</div>
                    <div className="text-[10px] text-zinc-500">
                      Confirmation receipt sent to your email &amp; WhatsApp.
                    </div>
                  </div>

                  {/* ZERO RE-ORDER HERO CALLOUT */}
                  <div className="p-3 rounded-xl bg-orange-50 border border-orange-200 space-y-1">
                    <div className="text-[11px] font-extrabold text-orange-900 flex items-center gap-1">
                      <Sparkles size={12} className="text-orange-600" />
                      <span>Zero Re-order Friction</span>
                    </div>
                    <p className="text-[10px] text-orange-800 leading-tight">
                      Order resumed automatically without adding items again or re-entering shipping info!
                    </p>
                  </div>

                  {/* Fulfillment Status Card */}
                  <div className="mt-3 p-2.5 rounded-lg bg-zinc-50 border border-zinc-200 space-y-1.5 text-[10px]">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Item:</span>
                      <span className="font-bold text-zinc-900">Apex Pro Wireless</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Status:</span>
                      <span className="font-bold text-emerald-600">Packing &amp; Dispatch</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Estimated Delivery:</span>
                      <span className="font-bold text-zinc-900">Tuesday, 2 Business Days</span>
                    </div>
                  </div>
                </div>

                {/* Bottom Order Button */}
                <div className="pt-2">
                  <div className="w-full py-2 rounded-lg bg-zinc-950 text-white text-[10px] font-bold text-center flex items-center justify-center gap-1 shadow-xs">
                    <span>Track Shipment</span>
                    <ArrowRight size={10} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
