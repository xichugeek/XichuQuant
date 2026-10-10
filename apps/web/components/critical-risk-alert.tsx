import type { RiskAlertView } from "@xichu-risk/shared";
import { ChevronRight, ShieldAlert } from "lucide-react";
import Link from "next/link";

import { formatPercent } from "@/lib/formatters";

export function CriticalRiskAlert({ alert }: { alert: RiskAlertView }) {
  return (
    <section className="critical-risk" aria-label="严重风险报警">
      <span className="critical-risk__icon">
        <ShieldAlert aria-hidden="true" size={25} />
      </span>
      <div className="critical-risk__body">
        <small>VIOLATION · 严重违纪</small>
        <h2>{alert.title}</h2>
        <p>{alert.suggestedAction}</p>
      </div>
      <div className="critical-risk__values">
        <span>
          <small>当前值</small>
          <strong>{formatPercent(alert.currentValue)}</strong>
        </span>
        <span>
          <small>限制值</small>
          <strong>{formatPercent(alert.limitValue)}</strong>
        </span>
      </div>
      <Link className="critical-risk__link" href="/risk">
        查看全部报警
        <ChevronRight aria-hidden="true" size={14} />
      </Link>
    </section>
  );
}
