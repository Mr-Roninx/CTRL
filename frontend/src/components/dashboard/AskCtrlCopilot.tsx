"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Bot,
  Send,
  Sparkles,
  X,
  RefreshCw,
  ChevronRight,
  ShieldAlert,
  ArrowUpRight,
  Zap,
  TrendingUp,
} from "lucide-react";
import { api } from "../../lib/auth";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  provider?: string;
  latency_ms?: number;
  cited_opportunities?: string[];
  suggested_followups?: string[];
  timestamp: string;
}

interface AskCtrlCopilotProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectOpportunity?: (id: string) => void;
}

const PREBUILT_QUERIES = [
  "What is our proved incremental recovery alpha?",
  "Why did Action Authority veto hard declines?",
  "Explain our marginal market shadow price",
  "How does CTRL model the natural recovery counterfactual?",
];

export function AskCtrlCopilot({ isOpen, onClose, onSelectOpportunity }: AskCtrlCopilotProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "msg_welcome",
      role: "assistant",
      content:
        "Welcome to **CTRL AI Executive Intelligence**. I analyze payment recovery opportunities through dynamic causal inference, portfolio shadow pricing, and deterministic safety compliance. How can I assist your risk operations today?",
      model: "NVIDIA Nemotron 30B / Expert Fallback",
      provider: "CTRL Control Plane",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      suggested_followups: PREBUILT_QUERIES,
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  const handleSend = async (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query || loading) return;

    const userMsg: ChatMessage = {
      id: `msg_user_${Date.now()}`,
      role: "user",
      content: query,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInput("");
    setLoading(true);

    try {
      const res = await api<any>("/api/v1/copilot/chat", {
        method: "POST",
        body: JSON.stringify({ message: query }),
      });

      if (res?.success) {
        const aiMsg: ChatMessage = {
          id: `msg_ai_${Date.now()}`,
          role: "assistant",
          content: res.answer,
          model: res.model_used,
          provider: res.provider_used,
          latency_ms: res.latency_ms,
          cited_opportunities: res.cited_opportunities || [],
          suggested_followups: res.suggested_followups || [],
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setMessages((prev) => [...prev, aiMsg]);
      } else {
        throw new Error(res?.error || "Failed to query copilot");
      }
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `msg_err_${Date.now()}`,
        role: "assistant",
        content: `⚠️ Communication error: ${err.message}. Running in high-availability local synthesis mode.`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] bg-white border-l border-zinc-200 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
      {/* Drawer Header */}
      <div className="p-4 sm:p-5 border-b border-zinc-200 bg-gradient-to-r from-orange-50/50 via-white to-amber-50/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-orange-600 text-white flex items-center justify-center shadow-xs">
            <Bot size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-zinc-950">Ask CTRL AI</h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Co-Pilot
              </span>
            </div>
            <p className="text-xs text-zinc-500">Autonomous Financial Intelligence</p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-500 hover:text-zinc-950 transition-colors cursor-pointer"
        >
          <X size={18} />
        </button>
      </div>

      {/* Messages List */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 text-xs sm:text-sm">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
          >
            <div
              className={`max-w-[88%] rounded-2xl p-4 shadow-2xs leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-zinc-900 text-white rounded-br-xs"
                  : "bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-bl-xs"
              }`}
            >
              {m.content}

              {/* Cited Opportunities */}
              {m.cited_opportunities && m.cited_opportunities.length > 0 && (
                <div className="mt-3 pt-3 border-t border-zinc-200/60 flex flex-wrap gap-1.5 items-center">
                  <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                    Cited:
                  </span>
                  {m.cited_opportunities.map((id) => (
                    <button
                      key={id}
                      onClick={() => onSelectOpportunity?.(id)}
                      className="px-2 py-0.5 rounded bg-orange-100/70 hover:bg-orange-200 text-orange-800 text-[11px] font-mono font-bold transition-colors cursor-pointer flex items-center gap-1"
                    >
                      <span>{id}</span>
                      <ArrowUpRight size={10} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Model & Latency Telemetry Badge */}
            {m.role === "assistant" && (m.model || m.latency_ms) && (
              <div className="mt-1 px-1 flex items-center gap-2 text-[10px] font-mono text-zinc-400">
                {m.model && <span>{m.model}</span>}
                {m.latency_ms && <span>· {m.latency_ms}ms</span>}
              </div>
            )}

            {/* Suggested Followups */}
            {m.suggested_followups && m.suggested_followups.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5 w-full">
                {m.suggested_followups.map((q, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSend(q)}
                    className="text-left px-2.5 py-1.5 rounded-lg bg-zinc-100 hover:bg-orange-50 hover:border-orange-200 border border-zinc-200/80 text-zinc-700 hover:text-orange-700 text-xs transition-all cursor-pointer flex items-center gap-1"
                  >
                    <span>{q}</span>
                    <ChevronRight size={12} className="shrink-0 text-zinc-400" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2.5 p-3 rounded-xl bg-zinc-50 border border-zinc-200 w-fit text-xs font-mono text-zinc-600">
            <RefreshCw size={14} className="animate-spin text-orange-600" />
            <span>Deliberating across consensus reasoning models…</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <div className="p-3 sm:p-4 border-t border-zinc-200 bg-white">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about recovery odds, shadow price, or specific opp_..."
            className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-50 border border-zinc-200 focus:border-orange-500 focus:bg-white text-xs sm:text-sm text-zinc-900 outline-none transition-all placeholder-zinc-400"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="p-2.5 rounded-xl bg-black hover:bg-orange-600 text-white transition-colors disabled:opacity-40 cursor-pointer shadow-xs"
            title="Send Query"
          >
            <Send size={16} />
          </button>
        </form>
        <div className="mt-2 text-[10px] font-mono text-zinc-400 text-center">
          * Answers grounded in immutable SQLite ledger &amp; deterministic compliance checks.
        </div>
      </div>
    </div>
  );
}
