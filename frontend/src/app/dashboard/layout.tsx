"use client";

import React, { ReactNode, useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Settings,
  LogOut,
  Sparkles,
  Bell,
  CheckCircle2,
} from "lucide-react";
import { useAuth, api } from "../../lib/auth";

interface NotificationItem {
  id: string;
  tenant_id: string;
  type: "LINK_CREATED" | "PAYMENT_RECOVERED" | "SWEEP_COMPLETED" | "INTEGRATION_ERROR" | "KILL_SWITCH_TRIGGERED";
  title: string;
  message: string;
  link_url?: string;
  read: boolean;
  created_at: string;
}

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/settings", label: "Settings", icon: Settings, exact: false },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, token, logout } = useAuth();
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Notification Center State
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [showNotifications, setShowNotifications] = useState<boolean>(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api<{ unread_count: number; notifications: NotificationItem[] }>("/v1/notifications");
      if (data) {
        setUnreadCount(data.unread_count || 0);
        setNotifications(data.notifications || []);
      }
    } catch {
      // Background notifications silent catch
    }
  }, [token]);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 6000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Click outside to close notifications dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const markAllRead = async () => {
    try {
      await api("/v1/notifications/mark-all-read", { method: "POST" });
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (e) {
      console.error(e);
    }
  };

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-[#fafafa] text-zinc-900 flex flex-col selection:bg-orange-200 selection:text-orange-950">
      {/* Top Global Bar */}
      <header className="sticky top-0 z-40 h-16 bg-white/95 border-b border-zinc-200 backdrop-blur-xl px-6 flex items-center justify-between shadow-xs">
        {/* Brand */}
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-orange-600 to-amber-400 p-[1.5px] shadow-sm">
              <div className="w-full h-full bg-white rounded-[7px] flex items-center justify-center font-mono font-bold text-sm text-orange-600 group-hover:scale-105 transition-transform">
                C
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-wider text-sm text-zinc-950">CTRL</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                  Live Control
                </span>
              </div>
            </div>
          </Link>

          {/* Quick Nav */}
          <nav className="hidden md:flex items-center gap-2 pl-4 border-l border-zinc-200">
            {NAV_ITEMS.map((item) => {
              const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 transition-all ${
                    active
                      ? "bg-orange-50 text-orange-700 font-bold border border-orange-200 shadow-xs"
                      : "text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100"
                  }`}
                >
                  <Icon size={14} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right Action Icons & Profile */}
        <div className="flex items-center gap-3">

          {/* Notification Bell */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-2 rounded-lg bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 text-zinc-600 hover:text-zinc-950 transition-all cursor-pointer"
              title="Alerts"
            >
              <Bell size={16} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-[10px] font-bold text-white flex items-center justify-center shadow-xs">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            {/* Notification Dropdown */}
            {showNotifications && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl bg-white border border-zinc-200 shadow-xl p-4 z-50">
                <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
                  <div className="flex items-center gap-2">
                    <Bell size={14} className="text-orange-600" />
                    <span className="text-xs font-bold text-zinc-900 uppercase tracking-wider font-mono">
                      Activity
                    </span>
                  </div>
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllRead}
                      className="text-[11px] text-orange-600 hover:underline cursor-pointer"
                    >
                      Mark all read
                    </button>
                  )}
                </div>

                <div className="max-h-72 overflow-y-auto divide-y divide-zinc-100 py-2 space-y-1">
                  {notifications.length === 0 ? (
                    <div className="py-6 text-center text-xs text-zinc-400">No recent activity</div>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.id}
                        className={`p-2.5 rounded-lg transition-colors ${
                          !n.read ? "bg-orange-50/70" : "hover:bg-zinc-50"
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500">
                          <span className="font-semibold text-zinc-900">{n.title}</span>
                          <span className="text-[10px] text-zinc-400">
                            {new Date(n.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-600 mt-1 leading-normal">{n.message}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* User Profile / Logout */}
          <div className="flex items-center gap-2 pl-2 border-l border-zinc-200">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-medium text-zinc-900 truncate max-w-[120px]">
                {user?.email || "Demo Merchant"}
              </div>
              <div className="text-[10px] font-mono text-orange-600">Live Store</div>
            </div>
            <button
              onClick={() => logout()}
              title="Sign Out"
              className="p-2 rounded-lg bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 text-zinc-500 hover:text-rose-600 transition-colors cursor-pointer"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8">{children}</main>
    </div>
  );
}
