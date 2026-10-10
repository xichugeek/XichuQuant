import type { RiskSummary } from "@xichu-risk/shared";
import { ShieldAlert } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { RiskBadge } from "@/components/risk-badge";
import { RiskRefreshButton } from "@/components/risk-refresh-button";
import { formatPercent } from "@/lib/formatters";
import { fetchWithFallback } from "@/lib/server-api-client";
import { emptyRiskSummary } from "@/lib/operational-fallbacks";

export const dynamic = "force-dynamic";

export default async function RiskPage() {
  const result = await fetchWithFallback<RiskSummary>("/risk/summary", emptyRiskSummary);
  const summary = result.data;

  return (
    <>
      <PageHeader
        action={<RiskRefreshButton />}
        description="集中展示统一风控引擎生成的所有未处理报警"
        title="风控红线"
      />

      <section className="risk-overview">
        <div>
          <ShieldAlert aria-hidden="true" size={26} />
          <span>
            <small>整体风险等级</small>
            <strong>
              {summary.overallRiskLevel === "VIOLATION" ? "严重违纪" : summary.overallRiskLevel}
            </strong>
          </span>
        </div>
        <div>
          <small>未处理报警</small>
          <strong>{summary.alerts.length}</strong>
        </div>
        <div>
          <small>杠杆 ETF 仓位</small>
          <strong>{formatPercent(summary.leveragedEtfPercent)}</strong>
        </div>
        <div>
          <small>存储主题仓位</small>
          <strong>{formatPercent(summary.storageThemePercent)}</strong>
        </div>
        <div>
          <small>Gross / Net Effective</small>
          <strong>{formatPercent(summary.grossEffectiveExposurePercent)} / {formatPercent(summary.netDirectionalExposurePercent)}</strong>
        </div>
        <div>
          <small>最大 Theme 有效总敞口</small>
          <strong>{formatPercent(summary.maxRiskThemeEffectiveExposurePercent)}</strong>
        </div>
      </section>

      <section className="alert-list">
        {summary.alerts.length === 0 ? (
          <article className="alert-row">
            <p>{result.source === "api" ? "当前账户没有未处理风险报警。" : "API 暂不可用。"}</p>
          </article>
        ) : summary.alerts.map((alert) => (
          <article
            className={["alert-row", "alert-row--" + alert.level.toLowerCase()].join(" ")}
            key={alert.code}
          >
            <div className="alert-row__title">
              <RiskBadge level={alert.level} />
              <span>
                <strong>{alert.title}</strong>
                <small>{alert.code}</small>
              </span>
            </div>
            <div className="alert-row__values">
              <span>
                当前值 <strong>{formatPercent(alert.currentValue)}</strong>
              </span>
              <span>
                限制值 <strong>{formatPercent(alert.limitValue)}</strong>
              </span>
            </div>
            <p>{alert.message}</p>
            <div className="alert-row__action">
              <strong>建议动作</strong>
              <span>{alert.suggestedAction}</span>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
