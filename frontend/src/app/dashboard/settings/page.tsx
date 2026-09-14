"use client";

import React, { useState, useEffect } from "react";
import { useAuth, api } from "../../../lib/auth";
import {
  Building2, Shield, Zap, CheckCircle2,
  Copy, Save, RefreshCw
} from "lucide-react";

export default function GeneralSettingsPage() {
  const { user, tenant, refresh } = useAuth();
  const [businessName, setBusinessName] = useState("");
  const [capacityLimit, setCapacityLimit] = useState(5);
  const [environment, setEnvironment] = useState<"test" | "live">("live");
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  useEffect(() => {
    if (tenant) {
      setBusinessName(tenant.name || "");
      setCapacityLimit(tenant.capacity_limit || 5);
      setEnvironment((tenant.environment as "test" | "live") || "live");
    }
  }, [tenant]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedSuccess(false);

    try {
      await api("/v1/auth/tenant", {
        method: "PATCH",
        body: JSON.stringify({
          name: businessName,
          capacity_limit: capacityLimit,
          environment,
        }),
      });
      await refresh();
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 4000);
    } catch (err: any) {
      alert(`Failed to save settings: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const copyTenantId = () => {
    if (tenant?.id) {
      navigator.clipboard.writeText(tenant.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">General Settings</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Manage your organization details, autonomous recovery limits, and environment modes.
        </p>
      </div>

      {savedSuccess && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-2.5 text-emerald-800 text-sm font-medium shadow-2xs">
          <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
          <span>Organization and recovery settings updated successfully.</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Organization Card */}
        <div className="rounded-2xl bg-white border border-zinc-200 p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-zinc-100">
            <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600 shadow-2xs">
              <Building2 size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-900">Organization Profile</h2>
              <p className="text-xs text-zinc-500">Your merchant tenant identity across the CTRL control plane.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                Business / Merchant Name
              </label>
              <input
                type="text"
                className="w-full px-3.5 py-2.5 bg-zinc-50 border border-zinc-200 focus:border-orange-500 focus:bg-white rounded-xl text-sm text-zinc-900 outline-none transition-all shadow-2xs"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g. Acme Payments Corp"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                Tenant Identifier (Isolated ID)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="w-full px-3.5 py-2.5 bg-zinc-100 border border-zinc-200 text-zinc-500 rounded-xl font-mono text-xs cursor-not-allowed outline-none shadow-2xs"
                  value={tenant?.id || "Loading…"}
                  readOnly
                />
                <button
                  type="button"
                  onClick={copyTenantId}
                  className="px-3.5 py-2.5 rounded-xl bg-white hover:bg-zinc-50 border border-zinc-200 text-zinc-700 hover:text-zinc-900 transition-colors shrink-0 shadow-2xs cursor-pointer"
                  title="Copy ID"
                >
                  {copiedId ? <CheckCircle2 size={16} className="text-emerald-600" /> : <Copy size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                Base Currency
              </label>
              <input
                type="text"
                className="w-full px-3.5 py-2.5 bg-zinc-100 border border-zinc-200 text-zinc-500 rounded-xl text-sm cursor-not-allowed outline-none shadow-2xs"
                value="INR (₹) - Indian Rupee"
                readOnly
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                Environment Mode
              </label>
              <div className="w-full px-3.5 py-2.5 bg-zinc-100 border border-zinc-200 text-zinc-800 rounded-xl text-sm font-medium shadow-2xs flex items-center justify-between">
                <span>Live Production Mode</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
                  ACTIVE
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Autonomous Recovery Capacity Policy */}
        <div className="rounded-2xl bg-white border border-zinc-200 p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-zinc-100">
            <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600 shadow-2xs">
              <Zap size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-900">Recovery &amp; Capacity Limits</h2>
              <p className="text-xs text-zinc-500">Control scarce recovery link budget and contact fatigue thresholds.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                Max Recovery Links per Batch (Capacity Limit)
              </label>
              <input
                type="number"
                min={1}
                max={50}
                className="w-full px-3.5 py-2.5 bg-zinc-50 border border-zinc-200 focus:border-orange-500 focus:bg-white rounded-xl text-sm text-zinc-900 outline-none transition-all shadow-2xs"
                value={capacityLimit}
                onChange={(e) => setCapacityLimit(parseInt(e.target.value, 10) || 5)}
              />
              <div className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">
                Enforces scarce allocation. Opportunities above this limit are ranked by shadow price and deferred.
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                Decision Explainer
              </label>
              <input
                type="text"
                className="w-full px-3.5 py-2.5 bg-zinc-100 border border-zinc-200 text-zinc-500 rounded-xl text-sm cursor-not-allowed outline-none shadow-2xs"
                value="Nemotron 30B (Zero Fund Authority)"
                readOnly
              />
              <div className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">
                Strict invariant: AI explains decisions only; deterministic code executes.
              </div>
            </div>
          </div>
        </div>

        {/* Security & Authentication Overview */}
        <div className="rounded-2xl bg-white border border-zinc-200 p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-zinc-100">
            <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center text-orange-600 shadow-2xs">
              <Shield size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-900">Security &amp; Authentication</h2>
              <p className="text-xs text-zinc-500">Current authenticated session details and cryptographic key storage.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-200 shadow-2xs">
              <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">Signed In As</div>
              <div className="text-sm font-bold text-zinc-900">{user?.email}</div>
              <div className="mt-3 flex gap-2">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-orange-100 text-orange-800 border border-orange-200">
                  {user?.role || "Owner"}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                  Supabase Auth Sync
                </span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-zinc-50 border border-zinc-200 shadow-2xs">
              <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">Credential Encryption</div>
              <div className="text-sm font-bold text-zinc-900">AES-256-GCM Envelope</div>
              <div className="text-xs text-zinc-500 mt-1 leading-relaxed">
                Tenant API secrets and webhook keys are encrypted in-flight and at-rest with zero plaintext leakage.
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 rounded-xl bg-black hover:bg-zinc-800 text-white font-bold text-sm shadow-md transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            <span>{saving ? "Saving Changes…" : "Save Organization Settings"}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
