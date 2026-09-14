"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();

  useEffect(() => {
    // Forward directly to unified OTP sign-in / sign-up
    router.replace("/login");
  }, [router]);

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: "100vh", background: "#000000", color: "#a1a1aa"
    }}>
      Redirecting to sign-in…
    </div>
  );
}
