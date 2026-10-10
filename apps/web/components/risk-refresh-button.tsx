"use client";

import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { postJson } from "@/lib/api-client";

export function RiskRefreshButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function refreshRisk() {
    setLoading(true);
    try {
      await postJson("/risk/evaluate");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      className="secondary-button"
      disabled={loading}
      onClick={() => void refreshRisk()}
      type="button"
    >
      <CheckCircle2 aria-hidden="true" size={14} />
      {loading ? "评估中" : "重新评估"}
    </button>
  );
}
