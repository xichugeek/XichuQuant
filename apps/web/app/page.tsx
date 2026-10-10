import {
  AlertTriangle,
  CircleDollarSign,
  ClipboardCheck,
  Gauge,
  Landmark,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import Link from "next/link";

import { CriticalRiskAlert } from "@/components/critical-risk-alert";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { PositionsTable } from "@/components/positions-table";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { fetchWithFallback } from "@/lib/server-api-client";
import { emptyRiskSummary } from "@/lib/operational-fallbacks";

export const dynamic = "force-dynamic";

const riskLabels = {
  LOW: "正常",
  MEDIUM: "关注",
  WARNING: "警告",
  DANGER: "高风险",
  VIOLATION: "严重违纪",
} as const;

export default async function DashboardPage() {
  const result = await fetchWithFallback<RiskSummary>("/risk/summary", emptyRiskSummary);
  const summary = result.data;
  const criticalAlert = summary.alerts.find((alert) => alert.level === "VIOLATION");
  const maxTheme = [...summary.exposureByRiskTheme].sort(
    (left, right) => right.grossEffectiveExposurePct - left.grossEffectiveExposurePct,
  )[0];
  const riskTone =
    summary.overallRiskLevel === "VIOLATION"
      ? "danger"
      : summary.overallRiskLevel === "DANGER" || summary.overallRiskLevel === "WARNING"
        ? "warning"
        : "positive";
  const discipline = [
    ...new Set(summary.alerts.map((alert) => alert.suggestedAction)),
  ];
  if (discipline.length === 0) {
    discipline.push(
      summary.positions.length === 0 ? "当前模拟账户暂无持仓。" : "当前持仓未触发风险红线。",
      "新仓必须填写止损或明确退出条件，并通过风险预算与集中度校验。",
      "IBKR Paper 订单仍需审批、二次确认和实时行情门禁。",
    );
  }
  const metrics = [
    {
      detail: summary.accountName,
      icon: Landmark,
      label: "账户总资产",
      tone: "neutral",
      value: formatCurrency(summary.totalEquity),
    },
    {
      detail: "可用现金",
      icon: WalletCards,
      label: "现金余额",
      tone: "neutral",
      value: formatCurrency(summary.cashBalance),
    },
    {
      detail: "账户安全垫",
      icon: Gauge,
      label: "现金占比",
      tone: "positive",
      value: formatPercent(summary.cashPercent),
    },
    {
      detail: "券商年度已实现盈亏",
      icon: CircleDollarSign,
      label: "今年已实现盈利",
      tone: (summary.realizedPnlYtd ?? 0) >= 0 ? "positive" : "negative",
      value: summary.annualPnlKnown === false ? "年度未核实" : formatCurrency(summary.realizedPnlYtd),
    },
    {
      detail: "当前持仓合计",
      icon: TrendingDown,
      label: "当前浮动盈亏",
      tone: summary.unrealizedPnlTotal < 0 ? "negative" : "neutral",
      value: formatCurrency(summary.unrealizedPnlTotal),
    },
    {
      detail: "已实现 + 浮动盈亏",
      icon: TrendingUp,
      label: "全年净收益",
      tone: "positive",
      value: summary.annualPnlKnown === false ? "年度未核实" : formatCurrency(summary.annualNetPnl),
    },
    {
      detail: "限制值 10.00%",
      icon: AlertTriangle,
      label: "杠杆 ETF 仓位",
      tone: "warning",
      value: formatPercent(summary.leveragedEtfPercent),
    },
    {
      detail: summary.accountType === "PAPER" ? "模拟交易，使用虚拟资金" : "统一风控引擎结果",
      icon: AlertTriangle,
      label: "当前风险等级",
      tone: riskTone,
      value: riskLabels[summary.overallRiskLevel],
    },
  ];

  return (
    <>
      <PageHeader
        action={
          <Link
            className="primary-button"
            href={summary.dataSource === "BROKER_SYNC" ? "/broker-paper-execution" : "/trade-plans"}
          >
            <ClipboardCheck aria-hidden="true" size={14} />
            {summary.dataSource === "BROKER_SYNC" ? "新建 Paper 审查" : "新建买入审查"}
          </Link>
        }
        description={`${summary.accountName} · USD · ${
          result.source === "api"
            ? summary.dataSource === "BROKER_SYNC"
              ? "IBKR 同步快照"
              : `${summary.dataOrigin ?? "UNKNOWN"} · 本地存储`
            : "API 暂不可用"
        }`}
        title="账户风险总览"
      />

      <section className="kpi-grid" aria-label="账户关键数据">
        {metrics.map(({ detail, icon: Icon, label, tone, value }) => (
          <article className={["kpi-card", "kpi-card--" + tone].join(" ")} key={label}>
            <div>
              <span>{label}</span>
              <Icon aria-hidden="true" size={16} />
            </div>
            <strong>{value}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </section>

      {criticalAlert ? <CriticalRiskAlert alert={criticalAlert} /> : null}

      <Panel
        description="仓位、浮亏和风险等级均由统一风控引擎计算"
        title="持仓风险监控"
        trailing={
          <Link className="text-link" href="/positions">
            管理全部持仓
          </Link>
        }
      >
        <PositionsTable positions={summary.positions} />
      </Panel>

      <section className="risk-summary-grid">
        <article className="summary-card summary-card--danger">
          <span>最大 Theme 有效总敞口</span>
          <strong>{formatPercent(summary.maxRiskThemeEffectiveExposurePercent)}</strong>
          <p>
            {maxTheme
              ? `${maxTheme.key}：${maxTheme.symbols.join(" / ")}，按 Gross Effective Exposure 聚合。`
              : "当前账户没有 Theme 风险敞口。"}
          </p>
        </article>
        <article className="summary-card summary-card--warning">
          <span>浮亏吞噬已实现盈利</span>
          <strong>{formatPercent(summary.floatingLossToRealizedProfitPercent)}</strong>
          <p>
            {(summary.realizedPnlYtd ?? 0) > 0
              ? "用于监控当前浮亏对年度已实现利润的侵蚀。"
              : "当前没有年度已实现利润基准。"}
          </p>
        </article>
        <article className="summary-card">
          <span>新增风险订单</span>
          <strong>{summary.overallRiskLevel === "VIOLATION" ? "当前禁止" : "须通过风控审批"}</strong>
          <p>新仓必须填写退出条件，并通过实时行情、风险预算和组合集中度门禁。</p>
        </article>
      </section>

      <Panel description="当前风险状态下必须执行的约束" title="今日纪律">
        <ol className="discipline-list">
          {discipline.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </Panel>
    </>
  );
}
import type { RiskSummary } from "@xichu-risk/shared";
