import type { RiskSummary } from "@xichu-risk/shared";
import { Plus } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { PositionAllocationMap } from "@/components/position-allocation-map";
import { PositionPriceEditor } from "@/components/position-price-editor";
import { PositionsTable } from "@/components/positions-table";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { fetchWithFallback } from "@/lib/server-api-client";
import { emptyRiskSummary } from "@/lib/operational-fallbacks";

export const dynamic = "force-dynamic";

export default async function PositionsPage() {
  const result = await fetchWithFallback<RiskSummary>("/risk/summary", emptyRiskSummary);
  const summary = result.data;
  const highRiskPositionCount = summary.positions.filter(
    (position) => position.riskLevel === "DANGER" || position.riskLevel === "VIOLATION",
  ).length;

  return (
    <>
      <PageHeader
        action={
          <button className="primary-button" type="button">
            <Plus aria-hidden="true" size={14} />
            新增持仓
          </button>
        }
        description="维护当前持仓并查看由后端规则口径计算的仓位与盈亏"
        title="持仓监控"
      />

      <section className="compact-stat-grid">
        <article>
          <span>持仓市值</span>
          <strong>{formatCurrency(summary.positionValue)}</strong>
        </article>
        <article>
          <span>持仓占比</span>
          <strong>{formatPercent(summary.positionPercent)}</strong>
        </article>
        <article>
          <span>高风险持仓</span>
          <strong className={highRiskPositionCount > 0 ? "loss-text" : ""}>
            {highRiskPositionCount}
          </strong>
        </article>
        <article>
          <span>当前总浮亏</span>
          <strong className="loss-text">{formatCurrency(-summary.unrealizedLossTotal)}</strong>
        </article>
      </section>

      <PositionAllocationMap
        accountName={summary.accountName}
        cashBalance={summary.cashBalance}
        overallRiskLevel={summary.overallRiskLevel}
        positions={summary.positions}
        source={result.source}
        totalEquity={summary.totalEquity}
      />

      {summary.dataSource !== "BROKER_SYNC" ? (
        <PositionPriceEditor positions={summary.positions} source={result.source} />
      ) : null}

      <Panel
        description={
          result.source === "api"
            ? summary.dataSource === "BROKER_SYNC"
              ? "数据来自 IBKR Paper 最新同步快照；券商持仓不可在此手工修改"
              : "数据来自 Position API，价格变更后自动重算风险"
            : "API 暂不可用，当前未展示账户数据"
        }
        title="当前持仓"
        trailing={<span className="panel-count">{summary.positions.length} 条</span>}
      >
        <PositionsTable positions={summary.positions} />
      </Panel>
    </>
  );
}
