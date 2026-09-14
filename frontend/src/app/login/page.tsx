"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Mail,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  RefreshCw,
  Lock,
  KeyRound,
  AlertCircle,
  Zap,
} from "lucide-react";
import { useAuth } from "../../lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const { sendOtp, verifyOtp, loginAsDemo, token, loading: authLoading } = useAuth();

  const [step, setStep] = useState<"EMAIL" | "OTP">("EMAIL");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);
  const [resendCountdown, setResendCountdown] = useState(0);

  const otpInputsRef = useRef<(HTMLInputElement | null)[]>([]);

  // Auto-redirect to dashboard if session token exists
  useEffect(() => {
    if (token && !authLoading) {
      router.replace("/dashboard");
    }
  }, [token, authLoading, router]);

  // Resend countdown timer
  useEffect(() => {
    if (resendCountdown > 0) {
      const timer = setTimeout(() => setResendCountdown(resendCountdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCountdown]);

  // Step 1: Request OTP
  const handleSendOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const res = await sendOtp(email.trim());
      setLoading(false);

      if (res.success) {
        setStep("OTP");
        setResendCountdown(45);
        setOtp(["", "", "", "", "", ""]);
        if (!res.delivered && res.dev_otp) {
          setDevOtpHint(res.dev_otp);
        } else {
          setDevOtpHint(null);
        }
        setTimeout(() => {
          otpInputsRef.current[0]?.focus();
        }, 100);
      } else {
        setError(res.error || "Failed to send login code. Please try again.");
      }
    } catch (err: any) {
      setLoading(false);
      setError(err.message || "Network error. Please try again.");
    }
  };

  // Step 2: Handle individual digit input
  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);

    // Auto-advance
    if (value && index < 5) {
      otpInputsRef.current[index + 1]?.focus();
    }

    // Auto-submit if all 6 filled
    const fullCode = newOtp.join("");
    if (fullCode.length === 6 && !newOtp.includes("")) {
      handleVerifyOtp(fullCode);
    }
  };

  // Handle backspace
  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpInputsRef.current[index - 1]?.focus();
    }
  };

  // Handle paste
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasteData = e.clipboardData.getData("text").trim();
    if (/^\d{6}$/.test(pasteData)) {
      const digits = pasteData.split("");
      setOtp(digits);
      otpInputsRef.current[5]?.focus();
      handleVerifyOtp(pasteData);
    }
  };

  // Step 3: Verify OTP code
  const handleVerifyOtp = async (codeToVerify?: string) => {
    const code = codeToVerify || otp.join("");
    if (code.length !== 6) {
      setError("Please enter the complete 6-digit code.");
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const res = await verifyOtp(email.trim(), code);
      setLoading(false);

      if (res.success) {
        router.push("/dashboard");
      } else {
        setError(res.error || "Incorrect or expired code. Please try again.");
      }
    } catch (err: any) {
      setLoading(false);
      setError(err.message || "Error verifying code.");
    }
  };

  // Quick Demo Access
  const handleDemoAccess = async () => {
    setLoading(true);
    setError(null);
    try {
      await loginAsDemo();
      router.push("/dashboard");
    } catch (err: any) {
      setLoading(false);
      setError("Failed to open demo: " + err.message);
    }
  };

  return (
    <div className="min-h-screen bg-white text-zinc-900 flex flex-col justify-between selection:bg-orange-200 selection:text-orange-950 relative overflow-hidden">
      {/* Suno Ambient Warm Sunset Glow */}
      <div className="absolute top-0 left-0 right-0 h-96 bg-gradient-to-b from-[#fff7ed] via-[#ffedd5]/60 to-transparent pointer-events-none z-0" />

      {/* Header */}
      <header className="relative z-10 px-8 py-6 flex items-center justify-between max-w-7xl mx-auto w-full">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 p-[1.5px] shadow-sm">
            <div className="w-full h-full bg-white rounded-[9px] flex items-center justify-center font-mono font-bold text-orange-600 group-hover:scale-105 transition-transform">
              C
            </div>
          </div>
          <span className="font-extrabold tracking-tight text-base text-zinc-900">CTRL</span>
        </Link>

        <div className="flex items-center gap-3">
          <Link
            href="/test-ground"
            className="px-3 py-1.5 rounded-lg bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Sparkles size={13} />
            <span>Interactive Test Page</span>
          </Link>
          <Link
            href="/"
            className="text-xs text-zinc-500 hover:text-zinc-900 flex items-center gap-1.5 transition-colors font-semibold"
          >
            <ArrowLeft size={14} /> Back to Home
          </Link>
        </div>
      </header>

      {/* Main Content Card */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="rounded-2xl bg-white border border-zinc-200 p-8 shadow-xl">
            {/* Title / Badge */}
            <div className="text-center mb-8">
              <div className="w-12 h-12 rounded-2xl bg-orange-50 border border-orange-200 mx-auto flex items-center justify-center text-orange-600 shadow-2xs mb-4">
                <KeyRound size={22} />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
                {step === "EMAIL" ? "Sign in" : "Enter Code"}
              </h1>
              <p className="text-xs text-zinc-500 mt-2">
                {step === "EMAIL"
                  ? "We will send a 6-digit verification code."
                  : `We sent a 6-digit code to ${email}`}
              </p>
            </div>

            {/* Error Notification */}
            {error && (
              <div className="mb-6 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2.5">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Test Mode Auto-fill Hint */}
            {step === "OTP" && devOtpHint && (
              <div className="mb-6 p-3.5 rounded-xl bg-orange-50 border border-orange-200 text-xs text-orange-900 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Sparkles size={14} className="text-orange-600" />
                  <span>Test Code: <strong>{devOtpHint}</strong></span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const digits = devOtpHint.split("");
                    setOtp(digits);
                    handleVerifyOtp(devOtpHint);
                  }}
                  className="px-2.5 py-1 rounded bg-orange-600 hover:bg-orange-500 text-white text-[11px] font-mono font-bold transition-colors cursor-pointer shadow-2xs"
                >
                  Auto Fill
                </button>
              </div>
            )}

            {/* STEP 1: Email Form */}
            {step === "EMAIL" ? (
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold mb-2">
                    Your Email Address
                  </label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input
                      id="email"
                      type="email"
                      required
                      placeholder="you@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-zinc-50 border border-zinc-200 focus:border-orange-500 focus:bg-white rounded-xl text-sm text-zinc-900 placeholder-zinc-400 outline-none transition-all focus:ring-2 focus:ring-orange-500/20"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 rounded-xl bg-black hover:bg-zinc-800 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  {loading ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : (
                    <>
                      <span>Continue</span>
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </form>
            ) : (
              /* STEP 2: OTP Verification Form */
              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold mb-3 text-center">
                    6-Digit Code
                  </label>

                  <div className="flex justify-between gap-2" onPaste={handlePaste}>
                    {otp.map((digit, idx) => (
                      <input
                        key={idx}
                        ref={(el) => {
                          otpInputsRef.current[idx] = el;
                        }}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleOtpChange(idx, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(idx, e)}
                        className="w-12 h-14 text-center text-xl font-mono font-bold bg-zinc-50 border border-zinc-200 focus:border-orange-500 focus:bg-white rounded-xl text-zinc-900 outline-none transition-all focus:ring-2 focus:ring-orange-500/20 shadow-2xs"
                      />
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleVerifyOtp()}
                  disabled={loading || otp.join("").length !== 6}
                  className="w-full py-3.5 rounded-xl bg-black hover:bg-zinc-800 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  {loading ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : (
                    <>
                      <span>Verify &amp; Open Dashboard</span>
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>

                <div className="flex items-center justify-between text-xs text-zinc-500 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setStep("EMAIL");
                      setError(null);
                    }}
                    className="hover:text-zinc-900 transition-colors flex items-center gap-1 cursor-pointer font-medium"
                  >
                    <ArrowLeft size={12} /> Edit Email
                  </button>

                  {resendCountdown > 0 ? (
                    <span className="text-zinc-400 font-mono">Resend code in {resendCountdown}s</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSendOtp()}
                      className="text-orange-600 font-semibold hover:underline transition-colors cursor-pointer"
                    >
                      Resend Code
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Quick Demo Access Divider */}
            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-zinc-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white px-3 text-zinc-400 font-mono uppercase tracking-wider font-semibold">
                  Instant Demo
                </span>
              </div>
            </div>

            {/* Quick Demo Workspace Access */}
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={handleDemoAccess}
                disabled={loading}
                className="w-full py-3 rounded-xl bg-white hover:bg-zinc-50 border border-zinc-300 text-zinc-800 text-xs font-semibold font-mono tracking-wide transition-all shadow-2xs flex items-center justify-center gap-2 cursor-pointer"
              >
                <Zap size={14} className="text-orange-500" />
                <span>⚡ Open Demo Dashboard</span>
              </button>

              <Link
                href="/test-ground"
                className="w-full py-2.5 rounded-xl bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 text-xs font-semibold font-mono tracking-wide transition-all shadow-2xs flex items-center justify-center gap-2 text-center"
              >
                <Sparkles size={14} className="text-orange-600" />
                <span>🧪 Open Interactive Test Page</span>
              </Link>
            </div>
          </div>

          {/* Compliance & Security Footer */}
          <div className="mt-8 text-center space-y-2 text-[11px] text-zinc-400">
            <div className="flex items-center justify-center gap-2">
              <Lock size={12} className="text-emerald-600" />
              <span>Passwordless login • Sandbox verified</span>
            </div>
          </div>
        </div>
      </main>

      {/* Simple Footer */}
      <footer className="relative z-10 py-4 px-6 text-center text-xs text-zinc-400">
        CTRL &copy; {new Date().getFullYear()} — Smart Payment Recovery
      </footer>
    </div>
  );
}
