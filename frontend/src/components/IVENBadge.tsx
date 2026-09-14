"use client";

import React from "react";
import { TrendingUp, AlertTriangle, ShieldAlert, Sparkles } from "lucide-react";

export type IVENBand = "STRONG" | "MODERATE" | "WEAK" | "NEGATIVE";

interface IVENBadgeProps {
  band?: IVENBand;
  valuePaise?: number;
  showExplanation?: boolean;
  size?: "sm" | "md" | "lg";
}

export function IVENBadge({
  band,
  valuePaise,
  showExplanation = false,
  size = "md",
}: IVENBadgeProps) {
  // Derive band from valuePaise if band not provided
  let effectiveBand: IVENBand = band || "WEAK";
  if (!band && typeof valuePaise === "number") {
    if (valuePaise >= 15000) effectiveBand = "STRONG";
    else if (valuePaise >= 5000) effectiveBand = "MODERATE";
    else if (valuePaise > 0) effectiveBand = "WEAK";
    else effectiveBand = "NEGATIVE";
  }

  const config = {
    STRONG: {
      label: "STRONG IVEN",
      range: "≥ ₹150",
      color: "text-emerald-700 bg-emerald-50 border-emerald-200 shadow-2xs",
      dot: "bg-emerald-500 animate-pulse",
      icon: TrendingUp,
      desc: "High economic conviction: net expected incremental recovery value exceeds ₹150.",
    },
    MODERATE: {
      label: "MODERATE IVEN",
      range: "₹50 - ₹149",
      color: "text-orange-700 bg-orange-50 border-orange-200 shadow-2xs",
      dot: "bg-orange-500",
      icon: Sparkles,
      desc: "Profitable recovery: incremental recovery exceeds operational and fatigue friction.",
    },
    WEAK: {
      label: "WEAK IVEN",
      range: "< ₹50",
      color: "text-amber-700 bg-amber-50 border-amber-200 shadow-2xs",
      dot: "bg-amber-500",
      icon: AlertTriangle,
      desc: "Marginal opportunity: vulnerable to shadow price exclusion when capacity is tight.",
    },
    NEGATIVE: {
      label: "NEGATIVE IVEN",
      range: "≤ ₹0",
      color: "text-rose-700 bg-rose-50 border-rose-200 shadow-2xs",
      dot: "bg-rose-500",
      icon: ShieldAlert,
      desc: "Value destructive: action costs exceed incremental recovery probability. Must ABSTAIN.",
    },
  }[effectiveBand];

  const sizeClasses = {
    sm: "px-2 py-0.5 text-[10px] gap-1",
    md: "px-2.5 py-1 text-xs gap-1.5",
    lg: "px-3 py-1.5 text-sm gap-2",
  }[size];

  const Icon = config.icon;
  const formattedValue = typeof valuePaise === "number" ? `₹${(valuePaise / 100).toFixed(2)}` : null;

  return (
    <div className="inline-flex flex-col gap-0.5">
      <div
        className={`inline-flex items-center font-mono font-medium rounded-full border transition-all ${config.color} ${sizeClasses}`}
        title={`${config.label} (${config.range}): ${config.desc} *Model-estimated`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
        <Icon className={size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5"} />
        <span>{config.label}</span>
        {formattedValue && (
          <span className="opacity-90 font-semibold pl-0.5">({formattedValue})</span>
        )}
      </div>
      {showExplanation && (
        <span className="text-[10px] text-zinc-500 font-sans pl-1">
          {config.range} • <em className="text-zinc-400">*Model-estimated</em>
        </span>
      )}
    </div>
  );
}
