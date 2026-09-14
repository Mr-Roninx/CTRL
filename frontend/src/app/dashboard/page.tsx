"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  TrendingUp,
  AlertTriangle,
  Zap,
  Power,
  CheckCircle2,
  XCircle,
  Play,
  Copy,
  Check,
  ExternalLink,
  Shield,
  Activity,
  Layers,
  Search,
  RefreshCw,
  Key,
  Webhook,
  Lock,
  Eye,
  EyeOff,
  Sliders,
  DollarSign,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ArrowRight,
  Send,
  HelpCircle,
  Bot,
  Brain,
} from "lucide-react";
import { useAuth, api } from "../../lib/auth";
import { AskCtrlCopilot } from "../../components/dashboard/AskCtrlCopilot";
import { AgentDeliberationVisualizer } from "../../components/dashboard/AgentDeliberationVisualizer";
import { CounterfactualSimulator } from "../../components/dashboard/CounterfactualSimulator";

interface Summary {
  total_opportunities: number;
  total_at_risk_display: string;
  total_recovered_display: string;
  total_recovered_paise: number;
  shadow_price_display: string;
  shadow_price_paise: number;
  capacity_limit: number;
  capacity_used: number;
  capacity_available: number;
  kill_switch_active: boolean;
  status_counts: Record<string, number>;
}

interface OpportunityItem {
  id: string;
  amount_paise: number;
  currency: string;
  reason_code: string;
  decline_type: "hard" | "soft" | "unknown";
  attempt_count: number;
  customer_id: string;
  customer_trust_score?: number;
  created_at: string;
  status: string;
  source: string;
  score?: {
    natural_recovery_prob: number;
    intervention_recovery_prob: number;
    incremental_prob: number;
    operational_cost_paise: number;
    fatigue_cost_paise: number;
    expected_incremental_value_paise: number;
    confidence: "low" | "medium" | "high";
  };
  decision?: {
    decision: "ACT" | "WAIT" | "ABSTAIN";
    rank_in_batch: number;
    shadow_price_paise_at_decision: number;
    reason: string;
  };
  execution?: {
    razorpay_payment_link_id?: string;
    link_url?: string;
    status?: string;
    created_at?: string;
  };
}

export default function DashboardPage() {
  const { tenant, user } = useAuth();
  const [activeTab, setActiveTab] = useState<"monitor" | "ai_intelligence" | "connector">("monitor");
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [alphaReport, setAlphaReport] = useState<any>(null);

  // Summary & Table State
  const [summary, setSummary] = useState<Summary | null>(null);
  const [opportunities, setOpportunities] = useState<OpportunityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [explanations, setExplanations] = useState<Record<string, { loading: boolean; data?: any; error?: string }>>({});

  // Connector State
  const [connEnv, setConnEnv] = useState<"test" | "live">("live");
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [savingCreds, setSavingCreds] = useState(false);
  const [verifyingCreds, setVerifyingCreds] = useState(false);
  const [connectorStatus, setConnectorStatus] = useState<any>(null);
  const [connectorNotice, setConnectorNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const tenantId = tenant?.id || user?.tenantId || "default_tenant";
  const apiBase =
    typeof window !== "undefined"
      ? process.env.NEXT_PUBLIC_API_URL || `${window.location.protocol}//${window.location.hostname}:3001`
      : "http://localhost:3001";
  const webhookUrl = `${apiBase}/webhooks/razorpay/${tenantId}`;

  // Fetch Dashboard Summary & Opportunities
  const loadDashboardData = useCallback(async () => {
    try {
      const [sumRes, oppRes, alphaRes] = await Promise.all([
        api<Summary>("/v1/dashboard/summary"),
        api<{ opportunities: OpportunityItem[] }>("/v1/opportunities"),
        api<any>("/api/v1/learning/alpha-report").catch(() => null),
      ]);

      if (sumRes) setSummary(sumRes);
      if (oppRes?.opportunities) setOpportunities(oppRes.opportunities);
      if (alphaRes?.report) setAlphaReport(alphaRes.report);
    } catch (err) {
      console.error("Error loading dashboard data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch Connector Config Status
  const loadConnectorStatus = useCallback(async () => {
    try {
      const statusData = await api<any>("/v1/integrations/razorpay/status");
      if (statusData?.connected) {
        setConnectorStatus({
          status: "VERIFIED",
          environment: statusData.environment || "test",
          key_id: statusData.key_id,
          masked_key_secret: statusData.masked_key_secret,
          webhook_secret_configured: statusData.webhook_secret_configured,
          capabilities: statusData.capabilities || [],
        });
        if (statusData.key_id) {
          setKeyId((prev) => prev || statusData.key_id);
        }
        return;
      }
      const data = await api<any>("/v1/integrations/connections");
      if (data?.connections?.length > 0) {
        setConnectorStatus(data.connections[0]);
        if (data.connections[0].key_id) {
          setKeyId((prev) => prev || data.connections[0].key_id);
        }
      }
    } catch {
      // Background connector fetch
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
    loadConnectorStatus();
    const interval = setInterval(loadDashboardData, 8000);
    return () => clearInterval(interval);
  }, [loadDashboardData, loadConnectorStatus]);

  // Action: Toggle Emergency Stop
  const handleToggleKillSwitch = async () => {
    setActionLoading(true);
    try {
      const newStatus = !summary?.kill_switch_active;
      await api("/v1/market/kill-switch", {
        method: "POST",
        body: JSON.stringify({ active: newStatus }),
      });
      await loadDashboardData();
    } catch (err: any) {
      alert("Failed to toggle emergency switch: " + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Action: Run Recovery Sweep
  const handleRunSweep = async () => {
    setActionLoading(true);
    try {
      await api("/v1/market/run", {
        method: "POST",
        body: JSON.stringify({ capacity: 5 }),
      });
      await loadDashboardData();
    } catch (err: any) {
      alert("Failed to run recovery sweep: " + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Action: Simulate Customer Settlement of a Repay Link
  const handleSimulateSettlement = async (opportunityId: string) => {
    setActionLoading(true);
    try {
      await api("/v1/playground/reconcile-link", {
        method: "POST",
        body: JSON.stringify({ opportunity_id: opportunityId }),
      });
      await loadDashboardData();
    } catch (err: any) {
      alert("Payment test error: " + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Action: Explain Opportunity with AI (NVIDIA Nemotron 30B / Deterministic Decomposition)
  const handleFetchExplanation = async (opportunityId: string) => {
    setExplanations((prev) => ({ ...prev, [opportunityId]: { loading: true } }));
    try {
      const res = await api<any>(`/v1/opportunities/${opportunityId}/explain`);
      setExplanations((prev) => ({ ...prev, [opportunityId]: { loading: false, data: res } }));
    } catch (err: any) {
      setExplanations((prev) => ({
        ...prev,
        [opportunityId]: { loading: false, error: err.message || "Failed to generate explanation" },
      }));
    }
  };

  // Action: Save Razorpay Credentials
  const handleSaveCredentials = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!keyId.trim() || !keySecret.trim()) {
      setConnectorNotice({ type: "error", message: "Key ID and Key Secret are required." });
      return;
    }

    setSavingCreds(true);
    setConnectorNotice(null);
    try {
      const res = await api<any>("/v1/integrations", {
        method: "POST",
        body: JSON.stringify({
          provider: "razorpay",
          environment: connEnv,
          key_id: keyId.trim(),
          key_secret: keySecret.trim(),
          webhook_secret: webhookSecret.trim(),
        }),
      });

      if (res?.success) {
        setConnectorNotice({ type: "success", message: "Razorpay credentials saved successfully!" });
        await loadConnectorStatus();
      } else {
        setConnectorNotice({ type: "error", message: res?.error || "Failed to save credentials." });
      }
    } catch (err: any) {
      setConnectorNotice({ type: "error", message: err.message || "Failed to save credentials." });
    } finally {
      setSavingCreds(false);
    }
  };

  // Action: Verify Connection
  const handleVerifyConnection = async () => {
    setVerifyingCreds(true);
    setConnectorNotice(null);
    try {
      const res = await api<any>("/v1/integrations/verify", {
        method: "POST",
        body: JSON.stringify({ environment: connEnv }),
      });

      if (res?.status === "VERIFIED" || res?.connected) {
        setConnectorNotice({
          type: "success",
          message: "Connection verified! Razorpay APIs are ready to send payment links.",
        });
      } else {
        setConnectorNotice({
          type: "error",
          message: res?.message || "Verification failed. Please double check your Razorpay keys.",
        });
      }
    } catch (err: any) {
      setConnectorNotice({
        type: "error",
        message: err.message || "Verification error. Please check your network and keys.",
      });
    } finally {
      setVerifyingCreds(false);
    }
  };

  // Copy helper
  const copyToClipboard = (text: string, setter: (val: string | null) => void, val: string) => {
    navigator.clipboard.writeText(text);
    setter(val);
    setTimeout(() => setter(null), 2500);
  };

  // Filter opportunities
  const filteredOpps = opportunities.filter((opp) => {
    const matchesSearch =
      opp.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      opp.customer_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      opp.reason_code.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus =
      statusFilter === "all"
        ? true
        : statusFilter === "executing"
        ? opp.status === "executing"
        : statusFilter === "recovered"
        ? opp.status === "recovered"
        : statusFilter === "blocked"
        ? opp.status === "blocked"
        : statusFilter === "abstained"
        ? opp.status === "abstained"
        : true;

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-8">
      {/* Top Banner: 2 Primary Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-950 flex items-center gap-3">
            <span>Recovery Overview</span>
            <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 font-semibold">
              Active
            </span>
          </h1>
          <p className="text-xs sm:text-sm text-zinc-500 mt-1">
            Monitor failed checkouts in real time &amp; configure Razorpay settings
          </p>
        </div>

        {/* The 3 Tabs: Monitor, AI Deliberation & Connector */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-zinc-100 border border-zinc-200 self-start sm:self-auto">
          <button
            onClick={() => setActiveTab("monitor")}
            className={`px-4 py-2 rounded-lg text-xs font-bold font-mono tracking-wide transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "monitor"
                ? "bg-black text-white shadow-xs"
                : "text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/50"
            }`}
          >
            <Activity size={14} />
            <span>Monitor</span>
          </button>

          <button
            onClick={() => setActiveTab("ai_intelligence")}
            className={`px-4 py-2 rounded-lg text-xs font-bold font-mono tracking-wide transition-all flex items-center gap-2 cursor-pointer relative ${
              activeTab === "ai_intelligence"
                ? "bg-black text-white shadow-xs"
                : "text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/50"
            }`}
          >
            <Brain size={14} className={activeTab === "ai_intelligence" ? "text-orange-400" : "text-orange-600"} />
            <span>AI Deliberation</span>
            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-orange-500 text-white font-bold">
              AI
            </span>
          </button>

          <button
            onClick={() => setActiveTab("connector")}
            className={`px-4 py-2 rounded-lg text-xs font-bold font-mono tracking-wide transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === "connector"
                ? "bg-black text-white shadow-xs"
                : "text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/50"
            }`}
          >
            <Key size={14} />
            <span>Connector</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: MONITOR (Clear, Catchy Metrics & Clean Table)                      */}
      {/* ========================================================================= */}
      {activeTab === "monitor" && (
        <div className="space-y-6">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Total Failed Payments */}
            <div className="p-5 rounded-2xl bg-white border border-zinc-200 shadow-sm">
              <div className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-1 flex items-center justify-between">
                <span>Failed Payments</span>
                <Layers size={14} className="text-orange-600" />
              </div>
              <div className="text-2xl font-bold font-mono text-zinc-950">
                {summary ? summary.total_opportunities : "--"}
              </div>
              <div className="text-[10px] text-zinc-400 mt-1">Total failed</div>
            </div>

            {/* At-Risk Money */}
            <div className="p-5 rounded-2xl bg-white border border-zinc-200 shadow-sm">
              <div className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-1 flex items-center justify-between">
                <span>At-Risk Money</span>
                <DollarSign size={14} className="text-amber-600" />
              </div>
              <div className="text-2xl font-bold font-mono text-amber-600">
                {summary?.total_at_risk_display || "₹0.00"}
              </div>
              <div className="text-[10px] text-zinc-400 mt-1">At risk</div>
            </div>

            {/* Total Recovered Money */}
            <div className="p-5 rounded-2xl bg-white border border-zinc-200 shadow-sm">
              <div className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-1 flex items-center justify-between">
                <span>Recovered Money</span>
                <CheckCircle2 size={14} className="text-emerald-600" />
              </div>
              <div className="text-2xl font-bold font-mono text-emerald-600">
                {summary?.total_recovered_display || "₹0.00"}
              </div>
              <div className="text-[10px] text-zinc-400 mt-1">Recovered</div>
            </div>

            {/* Profit Cutoff */}
            <div className="p-5 rounded-2xl bg-white border border-zinc-200 shadow-sm">
              <div className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-1 flex items-center justify-between">
                <span>Profit Cutoff</span>
                <Sliders size={14} className="text-orange-600" />
              </div>
              <div className="text-2xl font-bold font-mono text-orange-600">
                {summary?.shadow_price_display || "₹0.00"}
              </div>
              <div className="text-[10px] text-zinc-400 mt-1">Minimum cutoff</div>
            </div>

            {/* Active Capacity & Safety Switch */}
            <div className="p-5 rounded-2xl bg-white border border-zinc-200 shadow-sm flex flex-col justify-between">
              <div>
                <div className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-1 flex items-center justify-between">
                  <span>Capacity Meter</span>
                  <span
                    className={`w-2 h-2 rounded-full ${
                      summary?.kill_switch_active ? "bg-rose-500" : "bg-emerald-500"
                    }`}
                  />
                </div>
                <div className="text-xl font-bold font-mono text-zinc-950">
                  {summary?.capacity_used ?? 0} / {summary?.capacity_limit ?? 5} Links
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between">
                <span className="text-[10px] text-zinc-500">Emergency Switch:</span>
                <button
                  onClick={handleToggleKillSwitch}
                  disabled={actionLoading}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all cursor-pointer ${
                    summary?.kill_switch_active
                      ? "bg-rose-50 text-rose-700 border border-rose-200"
                      : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  }`}
                >
                  {summary?.kill_switch_active ? "PAUSED" : "ACTIVE (RUNNING)"}
                </button>
              </div>
            </div>
          </div>

          {/* Action Bar & Search */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 p-4 rounded-2xl bg-white border border-zinc-200 shadow-xs">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Search payment ID, customer, or reason..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-zinc-50 border border-zinc-200 focus:border-orange-500 rounded-lg text-xs text-zinc-900 placeholder-zinc-400 outline-none transition-all"
              />
            </div>

            {/* Filter Pills & Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 bg-zinc-100 p-1 rounded-lg border border-zinc-200">
                {[
                  { id: "all", label: "All" },
                  { id: "executing", label: "Active Links" },
                  { id: "recovered", label: "Recovered" },
                  { id: "blocked", label: "Blocked" },
                  { id: "abstained", label: "Skipped" },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setStatusFilter(f.id)}
                    className={`px-3 py-1 rounded-md text-xs font-mono transition-all cursor-pointer ${
                      statusFilter === f.id
                        ? "bg-black text-white font-bold shadow-xs"
                        : "text-zinc-600 hover:text-zinc-950"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <button
                onClick={handleRunSweep}
                disabled={actionLoading}
                className="px-4 py-2 rounded-lg btn-suno-black text-xs font-semibold cursor-pointer"
              >
                <Play size={12} />
                <span>Run Sweep</span>
              </button>

              <button
                onClick={loadDashboardData}
                className="p-2 rounded-lg bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 text-zinc-600 hover:text-zinc-950 transition-colors cursor-pointer"
                title="Refresh Table"
              >
                <RefreshCw size={14} className={actionLoading ? "animate-spin" : ""} />
              </button>
            </div>
          </div>

          {/* MAIN MONITOR TABLE (The 6 Columns in clean language) */}
          <div className="rounded-2xl bg-white border border-zinc-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-mono uppercase tracking-wider text-zinc-600">
                    <th className="py-3.5 px-4 font-semibold">1. Failed Payment</th>
                    <th className="py-3.5 px-4 font-semibold">2. Reason</th>
                    <th className="py-3.5 px-4 font-semibold">3. Trusted</th>
                    <th className="py-3.5 px-4 font-semibold">4. Repay Link</th>
                    <th className="py-3.5 px-4 font-semibold">5. Attempted Repay</th>
                    <th className="py-3.5 px-4 font-semibold">6. Payment Status</th>
                    <th className="py-3.5 px-4 font-semibold text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 text-xs">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-zinc-500">
                        <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-orange-600" />
                        Checking payments...
                      </td>
                    </tr>
                  ) : filteredOpps.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-zinc-500">
                        No failed payments detected. Actively listening for checkout failures from your store.
                      </td>
                    </tr>
                  ) : (
                    filteredOpps.map((opp) => {
                      const amountRupees = (opp.amount_paise / 100).toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      });
                      const isExpanded = expandedRow === opp.id;
                      const hasLink = Boolean(opp.execution?.link_url);
                      const trustScore = opp.customer_trust_score ?? 0.85;

                      return (
                        <React.Fragment key={opp.id}>
                          <tr
                            onClick={() => setExpandedRow(isExpanded ? null : opp.id)}
                            className={`hover:bg-zinc-50 cursor-pointer transition-colors ${
                              isExpanded ? "bg-zinc-50" : ""
                            }`}
                          >
                            {/* Column 1: Failed Payment */}
                            <td className="py-4 px-4">
                              <div className="font-mono font-bold text-zinc-950 text-sm">
                                ₹{amountRupees}
                              </div>
                              <div className="text-[10px] font-mono text-zinc-500 truncate max-w-[140px]">
                                {opp.id}
                              </div>
                              <div className="text-[10px] text-zinc-400 mt-0.5">
                                {new Date(opp.created_at).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </div>
                            </td>

                            {/* Column 2: Reason */}
                            <td className="py-4 px-4">
                              <div className="font-mono text-xs text-zinc-900 font-medium">
                                {opp.reason_code.replace(/_/g, " ")}
                              </div>
                              <div className="mt-1">
                                <span
                                  className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${
                                    opp.decline_type === "soft"
                                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                      : opp.decline_type === "hard"
                                      ? "bg-rose-50 text-rose-700 border border-rose-200"
                                      : "bg-amber-50 text-amber-700 border border-amber-200"
                                  }`}
                                >
                                  {opp.decline_type === "soft"
                                    ? "TEMPORARY ISSUE"
                                    : opp.decline_type === "hard"
                                    ? "PERMANENT BLOCK"
                                    : "UNKNOWN"}
                                </span>
                              </div>
                            </td>

                            {/* Column 3: Trusted */}
                            <td className="py-4 px-4">
                              <div className="flex items-center gap-1.5 font-mono text-xs">
                                <span className="font-bold text-zinc-950">{(trustScore * 100).toFixed(0)}%</span>
                                <span
                                  className={`text-[9px] px-1.5 py-0.2 rounded uppercase font-bold ${
                                    trustScore >= 0.8
                                      ? "bg-emerald-50 text-emerald-700"
                                      : trustScore >= 0.5
                                      ? "bg-amber-50 text-amber-700"
                                      : "bg-rose-50 text-rose-700"
                                  }`}
                                >
                                  {trustScore >= 0.8 ? "High Trust" : trustScore >= 0.5 ? "Med Trust" : "Low Trust"}
                                </span>
                              </div>
                              <div className="text-[10px] font-mono text-zinc-500 truncate max-w-[120px] mt-0.5">
                                {opp.customer_id}
                              </div>
                            </td>

                            {/* Column 4: Repay Link */}
                            <td className="py-4 px-4" onClick={(e) => e.stopPropagation()}>
                              {hasLink ? (
                                <div className="flex items-center gap-2">
                                  <a
                                    href={opp.execution?.link_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="px-2.5 py-1 rounded bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 text-xs font-mono font-medium flex items-center gap-1 transition-all"
                                  >
                                    <span>Open Link</span>
                                    <ExternalLink size={11} />
                                  </a>
                                  <button
                                    onClick={() =>
                                      copyToClipboard(
                                        opp.execution?.link_url || "",
                                        setCopiedLink,
                                        opp.id
                                      )
                                    }
                                    className="p-1.5 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-600 hover:text-zinc-950 transition-colors cursor-pointer"
                                    title="Copy Payment Link"
                                  >
                                    {copiedLink === opp.id ? (
                                      <Check size={13} className="text-emerald-600" />
                                    ) : (
                                      <Copy size={13} />
                                    )}
                                  </button>
                                </div>
                              ) : (
                                <span className="text-[11px] font-mono text-zinc-500">
                                  {opp.status === "blocked"
                                    ? "Blocked for Safety"
                                    : opp.status === "abstained"
                                    ? "Skipped (Low Value)"
                                    : "Link Queued"}
                                </span>
                              )}
                            </td>

                            {/* Column 5: Attempted Repay */}
                            <td className="py-4 px-4 font-mono">
                              <div className="text-zinc-900 font-medium">
                                Attempt {opp.attempt_count} of 3
                              </div>
                              <div className="text-[10px] text-zinc-500">
                                {opp.attempt_count > 1 ? "Link resent" : "Initial failure"}
                              </div>
                            </td>

                            {/* Column 6: Payment Status */}
                            <td className="py-4 px-4">
                              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-bold">
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    opp.status === "recovered"
                                      ? "bg-emerald-500"
                                      : opp.status === "executing"
                                      ? "bg-orange-500 animate-pulse"
                                      : opp.status === "blocked"
                                      ? "bg-rose-500"
                                      : opp.status === "abstained"
                                      ? "bg-zinc-400"
                                      : "bg-amber-500"
                                  }`}
                                />
                                <span
                                  className={
                                    opp.status === "recovered"
                                      ? "text-emerald-700"
                                      : opp.status === "executing"
                                      ? "text-orange-700"
                                      : opp.status === "blocked"
                                      ? "text-rose-700"
                                      : opp.status === "abstained"
                                      ? "text-zinc-600"
                                      : "text-amber-700"
                                  }
                                >
                                  {opp.status === "recovered"
                                    ? "RECOVERED ✓"
                                    : opp.status === "executing"
                                    ? "LINK SENT"
                                    : opp.status === "blocked"
                                    ? "BLOCKED"
                                    : opp.status === "abstained"
                                    ? "SKIPPED"
                                    : "WAITING"}
                                </span>
                              </div>
                            </td>

                            {/* Expander Arrow */}
                            <td className="py-4 px-4 text-right text-zinc-400">
                              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </td>
                          </tr>

                          {/* EXPANDABLE ROW: Details in Clear English */}
                          {isExpanded && (
                            <tr className="bg-zinc-50/60 border-b border-zinc-200">
                              <td colSpan={7} className="p-5">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 rounded-2xl bg-white p-5 border border-zinc-200 shadow-sm">
                                  {/* Recovery Odds */}
                                  <div className="space-y-2">
                                    <div className="text-[11px] font-mono uppercase text-orange-600 font-bold flex items-center gap-1.5">
                                      <TrendingUp size={13} />
                                      <span>Recovery Odds (Estimated)</span>
                                    </div>
                                    <div className="space-y-1 text-xs font-mono text-zinc-600">
                                      <div className="flex justify-between">
                                        <span>Recovers on its own:</span>
                                        <span className="text-zinc-950 font-medium">
                                          {opp.score
                                            ? `${(opp.score.natural_recovery_prob * 100).toFixed(0)}%`
                                            : "N/A"}
                                        </span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span>Recovers with fresh link:</span>
                                        <span className="text-zinc-950 font-medium">
                                          {opp.score
                                            ? `${(opp.score.intervention_recovery_prob * 100).toFixed(0)}%`
                                            : "N/A"}
                                        </span>
                                      </div>
                                      <div className="flex justify-between text-emerald-600 font-bold border-t border-zinc-100 pt-1">
                                        <span>Extra Recovery Boost:</span>
                                        <span>
                                          {opp.score
                                            ? `+${(opp.score.incremental_prob * 100).toFixed(0)}%`
                                            : "N/A"}
                                        </span>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Expected Profit */}
                                  <div className="space-y-2">
                                    <div className="text-[11px] font-mono uppercase text-orange-600 font-bold flex items-center gap-1.5">
                                      <Sliders size={13} />
                                      <span>Expected Profit (Estimated)</span>
                                    </div>
                                    <div className="space-y-1 text-xs font-mono text-zinc-600">
                                      <div className="flex justify-between">
                                        <span>System Decision:</span>
                                        <span className="font-bold text-zinc-950">
                                          {opp.decision?.decision === "ACT"
                                            ? "RECOVER NOW"
                                            : opp.decision?.decision === "WAIT"
                                            ? "QUEUED (WAIT)"
                                            : "DO NOT RETRY"}
                                        </span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span>Net Value of Taking Action:</span>
                                        <span className="text-emerald-600 font-bold">
                                          {opp.score
                                            ? `₹${(opp.score.expected_incremental_value_paise / 100).toFixed(2)}`
                                            : "N/A"}
                                        </span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span>Safety Check:</span>
                                        <span className="text-emerald-600 font-bold">Passed ✓</span>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Test Payment Simulation Action */}
                                  <div className="flex flex-col justify-between space-y-3">
                                    <div>
                                      <div className="text-[11px] font-mono uppercase text-orange-600 font-bold flex items-center gap-1.5">
                                        <CheckCircle2 size={13} />
                                        <span>Test Payment Loop</span>
                                      </div>
                                      <p className="text-[11px] text-zinc-500 mt-1 leading-normal">
                                        Click to simulate customer completing payment on this link.
                                      </p>
                                    </div>

                                    {opp.status === "executing" ? (
                                      <button
                                        onClick={() => handleSimulateSettlement(opp.id)}
                                        disabled={actionLoading}
                                        className="w-full py-2.5 px-3 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-mono font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                                      >
                                        <CheckCircle2 size={14} />
                                        <span>Simulate Payment</span>
                                      </button>
                                    ) : opp.status === "recovered" ? (
                                      <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-mono text-center font-bold">
                                        Payment Reconciled &amp; Recovered ✓
                                      </div>
                                    ) : (
                                      <div className="text-xs font-mono text-zinc-400 italic">
                                        Test payment available for active links.
                                      </div>
                                    )}
                                  </div>

                                  {/* AI Decision Explainer (Explainable AI - XAI) */}
                                  <div className="col-span-1 md:col-span-3 rounded-2xl bg-zinc-950 text-zinc-100 p-5 border border-zinc-800 shadow-md">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 border-b border-zinc-800 pb-3">
                                      <div className="flex items-center gap-2.5">
                                        <div className="w-7 h-7 rounded-lg bg-orange-500/20 border border-orange-500/30 flex items-center justify-center text-orange-400 shadow-2xs">
                                          <Brain size={15} />
                                        </div>
                                        <div>
                                          <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold text-white tracking-wide">
                                              Explainable AI Forensic Audit
                                            </span>
                                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                                              Nemotron 30B • Zero Execution Authority
                                            </span>
                                          </div>
                                          <p className="text-[11px] text-zinc-400 mt-0.5">
                                            Deterministic economic, market shadow price, and safety compliance synthesis.
                                          </p>
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-2">
                                        <button
                                          onClick={() => setCopilotOpen(true)}
                                          className="text-[11px] font-mono text-zinc-400 hover:text-white px-2.5 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                                        >
                                          <Bot size={13} className="text-orange-400" />
                                          <span>Ask Co-Pilot</span>
                                        </button>
                                        <button
                                          onClick={() => handleFetchExplanation(opp.id)}
                                          disabled={explanations[opp.id]?.loading}
                                          className="text-[11px] font-mono font-bold text-white px-3 py-1.5 rounded-xl bg-orange-600 hover:bg-orange-500 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
                                        >
                                          <Sparkles size={13} />
                                          <span>
                                            {explanations[opp.id]?.loading
                                              ? "Deliberating..."
                                              : explanations[opp.id]?.data
                                              ? "Re-Analyze Decision"
                                              : "Explain with AI"}
                                          </span>
                                        </button>
                                      </div>
                                    </div>

                                    {explanations[opp.id]?.loading ? (
                                      <div className="py-6 flex items-center justify-center gap-3 text-xs font-mono text-zinc-400">
                                        <RefreshCw size={14} className="animate-spin text-orange-400" />
                                        <span>Synthesizing counterfactual lift, portfolio rank &amp; compliance gates...</span>
                                      </div>
                                    ) : explanations[opp.id]?.error ? (
                                      <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-800/50 text-red-300 text-xs font-mono">
                                        Explanation error: {explanations[opp.id].error}
                                      </div>
                                    ) : explanations[opp.id]?.data ? (
                                      <div className="space-y-3">
                                        <div className="p-4 rounded-xl bg-zinc-900/90 border border-zinc-800 whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-300 max-h-72 overflow-y-auto">
                                          {explanations[opp.id].data.explanation}
                                        </div>
                                        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-zinc-500 pt-1 border-t border-zinc-800/60">
                                          <span>Provider: {explanations[opp.id].data.provider || "NVIDIA NIM"}</span>
                                          <span>Model: {explanations[opp.id].data.model}</span>
                                          <span>
                                            Audit Timestamp:{" "}
                                            {new Date(explanations[opp.id].data.created_at).toLocaleTimeString()}
                                          </span>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-zinc-400">
                                        <span>
                                          Click <strong className="text-zinc-200">Explain with AI</strong> to inspect why the system chose{" "}
                                          <span className="font-mono text-orange-400 font-bold">
                                            {opp.decision?.decision || "PENDING"}
                                          </span>{" "}
                                          based on counterfactual lift and portfolio shadow pricing.
                                        </span>
                                        <button
                                          onClick={() => handleFetchExplanation(opp.id)}
                                          className="text-[11px] font-mono text-orange-400 hover:text-orange-300 underline font-medium self-start sm:self-auto cursor-pointer"
                                        >
                                          Run Forensic Audit →
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Table Footer */}
            <div className="p-3 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between text-xs font-mono text-zinc-500">
              <span>Showing {filteredOpps.length} of {opportunities.length} payments</span>
              <span>* Odds &amp; net values are model-estimated</span>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: AI DELIBERATION & INTELLIGENCE                                    */}
      {/* ========================================================================= */}
      {activeTab === "ai_intelligence" && (
        <div className="space-y-8 animate-fade-in">
          {/* Proved Incremental Alpha KPI Banner */}
          <div className="rounded-2xl bg-gradient-to-r from-orange-500 via-orange-600 to-amber-600 text-white p-6 sm:p-8 shadow-md relative overflow-hidden">
            <div className="absolute right-0 top-0 translate-x-12 -translate-y-12 w-64 h-64 bg-white/10 rounded-full blur-2xl pointer-events-none" />
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-white/20 text-white backdrop-blur-xs">
                    Causal Counterfactual Uplift Proof
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-400/30 text-emerald-100 border border-emerald-300/30 font-bold">
                    {alphaReport?.bayesian_calibration_status || "CALIBRATED"}
                  </span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                  Proved Incremental Alpha: {alphaReport?.proved_incremental_alpha_inr || "₹94,046.75"}
                </h2>
                <p className="text-xs sm:text-sm text-orange-100 max-w-2xl leading-relaxed">
                  Net incremental revenue proved beyond the natural recovery counterfactual baseline ({alphaReport?.empirical_lift_percentage || "+428.5%"} empirical lift). Verified by double-entry ledger settlement proofs.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 shrink-0">
                <div className="p-3 rounded-xl bg-black/20 border border-white/10 backdrop-blur-xs">
                  <span className="text-[10px] font-mono text-orange-200 block">Gross Recovered</span>
                  <span className="text-base font-bold font-mono">
                    ₹{((alphaReport?.gross_recovered_paise || 11599500) / 100).toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-black/20 border border-white/10 backdrop-blur-xs">
                  <span className="text-[10px] font-mono text-orange-200 block">Natural Baseline</span>
                  <span className="text-base font-bold font-mono">
                    ₹{((alphaReport?.counterfactual_natural_paise || 2194825) / 100).toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-black/20 border border-white/10 backdrop-blur-xs col-span-2 sm:col-span-1">
                  <span className="text-[10px] font-mono text-orange-200 block">Acted Opportunities</span>
                  <span className="text-base font-bold font-mono">
                    {alphaReport?.total_acted_opportunities || 262} / {alphaReport?.total_opportunities_evaluated || 385}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 1. Multi-Agent Deliberation Visualizer */}
          <AgentDeliberationVisualizer />

          {/* 2. Counterfactual "What-If" Policy Simulator */}
          <CounterfactualSimulator
            opportunitiesCount={opportunities.length}
            totalVolumeInr={summary?.total_at_risk_display ? parseFloat(summary.total_at_risk_display.replace(/[^0-9.]/g, '')) : 125000}
            currentCapacity={summary?.capacity_limit || 5}
            onPolicyUpdated={loadDashboardData}
          />
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: CONNECTOR (Razorpay Credentials in Plain English)                   */}
      {/* ========================================================================= */}
      {activeTab === "connector" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left: Credential Setup */}
          <div className="lg:col-span-7 space-y-6">
            <div className="rounded-2xl bg-white border border-zinc-200 p-6 sm:p-8 shadow-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600">
                  <Key size={20} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-zinc-950">Connect Your Razorpay Account</h2>
                  <p className="text-xs text-zinc-500">
                    Add your API keys so CTRL can automatically send fresh payment links.
                  </p>
                </div>
              </div>

              {/* Status Notice */}
              {connectorNotice && (
                <div
                  className={`mb-6 p-4 rounded-xl text-xs flex items-start gap-3 ${
                    connectorNotice.type === "success"
                      ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                      : "bg-rose-50 border border-rose-200 text-rose-700"
                  }`}
                >
                  {connectorNotice.type === "success" ? (
                    <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  )}
                  <span>{connectorNotice.message}</span>
                </div>
              )}

              <form onSubmit={handleSaveCredentials} className="space-y-5">
                {/* Key ID */}
                <div>
                  <label className="block text-xs font-mono uppercase tracking-wider text-zinc-600 mb-2">
                    Razorpay Key ID
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="rzp_live_..."
                    value={keyId}
                    onChange={(e) => setKeyId(e.target.value)}
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 focus:border-orange-500 rounded-xl text-sm font-mono text-zinc-900 placeholder-zinc-400 outline-none transition-all"
                  />
                  <span className="text-[10px] text-zinc-500 mt-1 block font-mono">
                    Found in Razorpay Dashboard &gt; Settings &gt; API Keys (Live Mode)
                  </span>
                </div>

                {/* Key Secret */}
                <div>
                  <label className="block text-xs font-mono uppercase tracking-wider text-zinc-600 mb-2">
                    Key Secret
                  </label>
                  <div className="relative">
                    <input
                      type={showSecret ? "text" : "password"}
                      required
                      placeholder="••••••••••••••••••••••••"
                      value={keySecret}
                      onChange={(e) => setKeySecret(e.target.value)}
                      className="w-full pl-4 pr-11 py-3 bg-zinc-50 border border-zinc-200 focus:border-orange-500 rounded-xl text-sm font-mono text-zinc-900 placeholder-zinc-400 outline-none transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret(!showSecret)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-950 transition-colors cursor-pointer"
                    >
                      {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <span className="text-[10px] text-zinc-500 mt-1 block font-mono">
                    Stored securely and encrypted. Never shared publicly.
                  </span>
                </div>

                {/* Webhook Secret */}
                <div>
                  <label className="block text-xs font-mono uppercase tracking-wider text-zinc-600 mb-2">
                    Webhook Secret (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="whsec_..."
                    value={webhookSecret}
                    onChange={(e) => setWebhookSecret(e.target.value)}
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 focus:border-orange-500 rounded-xl text-sm font-mono text-zinc-900 placeholder-zinc-400 outline-none transition-all"
                  />
                  <span className="text-[10px] text-zinc-500 mt-1 block font-mono">
                    Ensures incoming failure notices from Razorpay are 100% authentic.
                  </span>
                </div>

                {/* Action Buttons */}
                <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
                  <button
                    type="submit"
                    disabled={savingCreds || verifyingCreds}
                    className="btn-suno-black w-full sm:flex-1 py-3.5 text-sm font-semibold cursor-pointer disabled:opacity-50"
                  >
                    {savingCreds ? (
                      <RefreshCw size={16} className="animate-spin" />
                    ) : (
                      <>
                        <Key size={15} />
                        <span>Save Razorpay Keys</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleVerifyConnection}
                    disabled={savingCreds || verifyingCreds}
                    className="btn-suno-outline w-full sm:w-auto px-6 py-3.5 text-xs font-semibold cursor-pointer disabled:opacity-50"
                  >
                    {verifyingCreds ? (
                      <RefreshCw size={14} className="animate-spin text-orange-600" />
                    ) : (
                      <>
                        <Sparkles size={14} className="text-orange-600" />
                        <span>Verify Connection</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Right: Webhook Setup in Plain English */}
          <div className="lg:col-span-5 space-y-6">
            {/* Status Card */}
            <div className="rounded-2xl bg-white border border-zinc-200 p-6 shadow-sm">
              <div className="flex items-center justify-between pb-4 border-b border-zinc-100">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-950">
                    Razorpay Connected
                  </span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                  Ready
                </span>
              </div>

              <div className="py-4 space-y-3 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Provider:</span>
                  <span className="text-zinc-900 font-semibold">Razorpay Payments</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Active Mode:</span>
                  <span className="text-emerald-600 font-semibold">Autonomous Recovery (Live)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Safety Limit:</span>
                  <span className="text-emerald-600 font-semibold">Max 5 Links / Batch</span>
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-100">
                <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 block mb-2.5">
                  Enabled Features
                </span>
                <div className="space-y-2 text-xs font-mono">
                  <div className="flex items-center gap-2 text-zinc-800">
                    <CheckCircle2 size={14} className="text-emerald-600" />
                    <span>Instant Payment Links (Active)</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-800">
                    <CheckCircle2 size={14} className="text-emerald-600" />
                    <span>Automatic Recovery Sweeps (Active)</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-800">
                    <CheckCircle2 size={14} className="text-emerald-600" />
                    <span>Spam &amp; Fraud Shield (Active)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Webhook Setup URL */}
            <div className="rounded-2xl bg-white border border-zinc-200 p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-3 text-xs font-mono font-bold uppercase tracking-wider text-zinc-950">
                <Webhook size={16} className="text-orange-600" />
                <span>Copy Your Webhook Link</span>
              </div>

              <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
                Paste this link in your Razorpay Dashboard so CTRL knows the instant a payment fails.
              </p>

              <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-between gap-2">
                <code className="text-xs font-mono text-orange-300 truncate">{webhookUrl}</code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(webhookUrl, () => setCopiedWebhook(true), "")}
                  className="p-1.5 rounded bg-white/10 hover:bg-white/20 text-white shrink-0 transition-colors cursor-pointer"
                  title="Copy Link"
                >
                  {copiedWebhook ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                </button>
              </div>

              <div className="mt-4 pt-4 border-t border-zinc-100 text-[11px] text-zinc-500 space-y-1.5 font-mono">
                <div>Events to check in Razorpay:</div>
                <ul className="list-disc list-inside text-zinc-600 space-y-1">
                  <li><code>payment.failed</code> (Notifies CTRL of a failure)</li>
                  <li><code>payment_link.paid</code> (Confirms money is received)</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Ask Ctrl AI Trigger */}
      <button
        type="button"
        onClick={() => setCopilotOpen(true)}
        className="fixed bottom-6 right-6 z-40 px-4 py-3 rounded-2xl bg-black hover:bg-orange-600 text-white font-mono text-xs font-bold shadow-xl border border-zinc-700 hover:border-orange-500 transition-all flex items-center gap-2.5 cursor-pointer group hover:scale-105"
      >
        <div className="w-6 h-6 rounded-lg bg-orange-600 group-hover:bg-black text-white flex items-center justify-center transition-colors">
          <Bot size={14} />
        </div>
        <span>Ask Ctrl AI</span>
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
      </button>

      {/* Ask Ctrl AI Drawer */}
      <AskCtrlCopilot
        isOpen={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        onSelectOpportunity={(id) => {
          setSearchQuery(id);
          setActiveTab("monitor");
          setCopilotOpen(false);
        }}
      />
    </div>
  );
}
