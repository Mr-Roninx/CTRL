import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Orbitron } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "../lib/auth";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

const orbitron = Orbitron({
  subsets: ["latin"],
  variable: "--font-orbitron",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CTRL — Autonomous Payment Recovery Control Plane",
  description:
    "CTRL is an autonomous economic control plane for failed-payment recovery on Razorpay. Arbitrage scarce recovery capacity with counterfactual incremental value and deterministic compliance.",
  keywords: ["payment recovery", "razorpay", "failed payments", "fintech", "autonomous control plane"],
  authors: [{ name: "CTRL" }],
  robots: "noindex, nofollow",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} ${orbitron.variable}`}>
      <body className="antialiased bg-white text-zinc-900 w-full min-h-screen">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
