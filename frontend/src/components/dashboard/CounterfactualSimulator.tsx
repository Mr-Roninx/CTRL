"use client";

import React, { useState, useMemo } from "react";
import {
  Sliders,
  TrendingUp,
  Coins,
  Shield,
  Zap,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { api } from "../../lib/auth";

interface SimulatorProps {
  opportunitiesCount: number;
  totalVolumeInr: number;
  currentCapacity: number;
  onPolicyUpdated?: () => void;
}

export function CounterfactualSimulator({
  opportunitiesCount,
  totalVolumeInr,
  currentCapacity = 5,
  onPolicyUpdated,
}: SimulatorProps) {
  const [capacity, setCapacity] = useState<number>(currentCapacity);
  const [hurdleRateInr, setHurdleRateInr] = useState<number>(50);
  const [fatiguePenaltyInr, setFatiguePenaltyInr] = useState<number>(5);
  const [applying, setApplying] = useState(false);
  const [appliedSuccess, setAppliedSuccess] = useState(false);

  // Dynamic counterfactual model calculation
  const simulation = useMemo(() => {
    const opps = Math.max(10, opportunitiesCount || 25);
    const avgTicket = totalVolumeInr > 0 ? totalVolumeInr / opps : 3500;

    // Projected accepted opportunities based on capacity constraint
    const eligibleCount = Math.min(opps, Math.round(opps * 0.7)); // 70% soft declines
    const accepted = Math.min(capacity, eligibleCount);
    const deferred = Math.max(0, eligibleCount - accepted);
    const abstained = Math.max(0, opps - eligibleCount);

    // Marginal shadow price (diminishing return model)
    const marginalUplift = Math.max(0.08, 0.35 - (accepted / 30) * 0.2);
    const shadowPricePaise = Math.max(
      hurdleRateInr * 100,
      Math.round(marginalUplift * avgTicket * 100 - 400 - fatiguePenaltyInr * 100)
    );

    // Total incremental yield
    const expectedIncrementalInr = Math.round(
      accepted * (avgTicket * 0.28 - 4 - fatiguePenaltyInr)
    );

    const projectedLiftPct = (18.5 + (accepted / opps) * 14).toFixed(1);

    return {
      accepted,
      deferred,
      abstained,
      shadowPriceInr: (shadowPricePaise / 100).toFixed(2),
      expectedIncrementalInr: Math.max(0, expectedIncrementalInr),
      projectedLiftPct,
    };
  }, [capacity, hurdleRateInr, fatiguePenaltyInr, opportunitiesCount, totalVolumeInr]);

  const handleApplyPolicy = async () => {
    setApplying(true);
    setAppliedSuccess(false);
    try {
      await api("/v1/auth/tenant", {
        method: "PATCH",
        body: JSON.stringify({
          capacity_limit: capacity,
        }),
      });
      setAppliedSuccess(true);
      onPolicyUpdated?.();
      setTimeout(() => setAppliedSuccess(false), 3000);
    } catch (err: any) {
      alert("Failed to update policy: " + err.message);
    } finally {
      setApplying(false);
    }
  };

  const handleReset = () => {
    setCapacity(5);
    setHurdleRateInr(50);
    setFatiguePenaltyInr(5);
  };

  return (
    <div className="rounded-2xl bg-white border border-zinc-200 p-6 sm:p-8 shadow-sm space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-zinc-100">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-orange-50 border border-orange-200 text-orange-600 flex items-center justify-center">
              <Sliders size={18} />
            </div>
            <h2 className="text-base sm:text-lg font-bold text-zinc-950">
              Counterfactual "What-If" Policy Simulator
            </h2>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Simulate portfolio allocation outcomes, marginal shadow prices, and net recovery yield under variable economic parameters.
          </p>
        </div>

        <button
          onClick={handleReset}
          className="text-xs font-mono text-zinc-500 hover:text-zinc-950 flex items-center gap-1.5 transition-colors cursor-pointer self-start sm:self-auto"
        >
          <RotateCcw size={13} />
          <span>Reset Defaults</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Sliders Column */}
        <div className="lg:col-span-6 space-y-5">
          {/* Slider 1: Capacity Limit */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-mono uppercase font-bold text-zinc-700">
                1. Recovery Link Capacity Limit
              </label>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-200">
                {capacity} links / run
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={30}
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
              className="w-full h-2 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-orange-600"
            />
            <div className="flex justify-between text-[10px] font-mono text-zinc-400 mt-1">
              <span>1 link (Strictly Scarce)</span>
              <span>15 links (Standard)</span>
              <span>30 links (High Capacity)</span>
            </div>
          </div>

          {/* Slider 2: Minimum IVEN Hurdle Rate */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-mono uppercase font-bold text-zinc-700">
                2. Minimum Economic Hurdle Rate (IVEN)
              </label>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                ₹{hurdleRateInr}.00
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={250}
              step={10}
              value={hurdleRateInr}
              onChange={(e) => setHurdleRateInr(Number(e.target.value))}
              className="w-full h-2 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-orange-600"
            />
            <div className="flex justify-between text-[10px] font-mono text-zinc-400 mt-1">
              <span>₹0 (Break-even)</span>
              <span>₹100 (Profitable)</span>
              <span>₹250 (High Conviction)</span>
            </div>
          </div>

          {/* Slider 3: Fatigue Cost Penalty */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-mono uppercase font-bold text-zinc-700">
                3. Customer Contact Fatigue Penalty
              </label>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
                ₹{fatiguePenaltyInr}.00 / attempt
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={25}
              value={fatiguePenaltyInr}
              onChange={(e) => setFatiguePenaltyInr(Number(e.target.value))}
              className="w-full h-2 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-orange-600"
            />
            <div className="flex justify-between text-[10px] font-mono text-zinc-400 mt-1">
              <span>₹0 (Aggressive)</span>
              <span>₹10 (Balanced)</span>
              <span>₹25 (Brand Protection)</span>
            </div>
          </div>

          {/* Apply Button */}
          <div className="pt-2">
            <button
              onClick={handleApplyPolicy}
              disabled={applying}
              className="btn-suno-black w-full py-3 text-xs font-mono font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {applying ? (
                <span>Committing Policy to SQLite…</span>
              ) : appliedSuccess ? (
                <>
                  <CheckCircle2 size={15} className="text-emerald-400" />
                  <span>Policy Active in Control Plane ✓</span>
                </>
              ) : (
                <>
                  <Zap size={14} className="text-orange-400" />
                  <span>Apply Simulated Capacity ({capacity} Links)</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Counterfactual Projected Results Column */}
        <div className="lg:col-span-6 rounded-xl bg-zinc-50 border border-zinc-200 p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 font-bold mb-3 flex items-center gap-2">
              <TrendingUp size={14} className="text-orange-600" />
              <span>Projected Counterfactual Yield</span>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-3.5 rounded-lg bg-white border border-zinc-200/80 shadow-2xs">
                <span className="text-[10px] font-mono text-zinc-400 uppercase block mb-1">
                  Net Incremental Revenue
                </span>
                <span className="text-lg font-bold text-zinc-950 font-mono">
                  ₹{simulation.expectedIncrementalInr.toLocaleString("en-IN")}
                </span>
                <span className="text-[10px] font-mono text-emerald-600 block mt-0.5">
                  model-estimated net lift
                </span>
              </div>

              <div className="p-3.5 rounded-lg bg-white border border-zinc-200/80 shadow-2xs">
                <span className="text-[10px] font-mono text-zinc-400 uppercase block mb-1">
                  Shadow Price (λ*)
                </span>
                <span className="text-lg font-bold text-orange-600 font-mono">
                  ₹{simulation.shadowPriceInr}
                </span>
                <span className="text-[10px] font-mono text-zinc-500 block mt-0.5">
                  marginal cut-off value
                </span>
              </div>
            </div>

            {/* Allocation Breakdown */}
            <div className="space-y-2 text-xs font-mono">
              <div className="flex justify-between py-1.5 border-b border-zinc-200/50">
                <span className="text-zinc-500">Opportunities ACTed:</span>
                <span className="font-bold text-emerald-700">{simulation.accepted} links</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-zinc-200/50">
                <span className="text-zinc-500">Opportunities Deferred (Cap Bound):</span>
                <span className="font-bold text-amber-700">{simulation.deferred} links</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-zinc-500">Opportunities Abstained (Negative IVEN):</span>
                <span className="font-bold text-zinc-500">{simulation.abstained} links</span>
              </div>
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-orange-100/50 border border-orange-200/70 text-[11px] font-mono text-orange-900 leading-normal">
            💡 <strong>Economic Rule:</strong> When capacity binds at {capacity} links, CTRL automatically rejects opportunities below the shadow price of ₹{simulation.shadowPriceInr} to ensure scarce attention is spent only on highest-yield recoveries.
          </div>
        </div>
      </div>
    </div>
  );
}
