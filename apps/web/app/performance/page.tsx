"use client";

import type { AccountPerformance } from "@xichu-risk/shared";
import { Activity, ArrowDownRight, ArrowUpRight, Landmark, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { fetchWithFallback, type DataSource } from "@/lib/api-client";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { getEmptyAccountPerformance } from "@/lib/operational-fallbacks";

const periods: Array<{ label: string; value: AccountPerformance["period"] }> = [
  { label: "近 1 月", value: "1M" },
  { label: "近 3 月", value: "3M" },
  { label: "今年", value: "YTD" },
  { label: "近 1 年", value: "1Y" },
  { label: "全部", value: "ALL" },
];

function PerformanceChart({ performance }: { performance: AccountPerformance }) {
  const chart = useMemo(() => {
    const width = 900;
    const height = 270;
    const padding = { top: 24, right: 24, bottom: 42, left: 70 };
    const values = performance.series.map((point) => point.equity);
    const min = Math.min(...values, performance.currentEquity);
    const max = Math.max(...values, performance.currentEquity);
    const range = Math.max(max - min, 1);
    const x = (index: number) =>
      padding.left +
      (index / Math.max(performance.series.length - 1, 1)) * (width - padding.left - padding.right);
    const y = (value: number) =>
      padding.top + ((max - value) / range) * (height - padding.top - padding.bottom);
    const points = performance.series
      .map((point, index) => `${x(index)},${y(point.equity)}`)
      .join(" ");
    const area = `${padding.left},${height - padding.bottom} ${points} ${x(performance.series.length - 1)},${height - padding.bottom}`;
    return { area, height, max, min, padding, points, width, x, y };
  }, [performance]);

  return (
    <div className="performance-chart">
      <svg
        aria-label={`${performance.periodLabel}账户权益曲线`}
        role="img"
        viewBox={`0 0 ${chart.width} ${chart.height}`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const value = chart.max - (chart.max - chart.min) * ratio;
          const y = chart.y(value);
          return (
            <g key={ratio}>
              <line
                className="performance-chart__grid"
                x1={chart.padding.left}
                x2={chart.width - chart.padding.right}
                y1={y}
                y2={y}
              />
              <text className="performance-chart__axis" x={chart.padding.left - 12} y={y + 4}>
                {formatCurrency(value)}
              </text>
            </g>
          );
        })}
        <polygon className="performance-chart__area" points={chart.area} />
        <polyline className="performance-chart__line" points={chart.points} />
        {performance.series.map((point, index) => (
          <g key={point.date}>
            <circle
              className="performance-chart__point"
              cx={chart.x(index)}
              cy={chart.y(point.equity)}
              r="4"
            />
            <title>{`${point.date} · ${formatCurrency(point.equity)} · ${point.note ?? "权益快照"}`}</title>
            {(index === 0 || index === performance.series.length - 1) && (
              <text className="performance-chart__date" x={chart.x(index)} y={chart.height - 15}>
                {point.date.slice(5)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function PerformancePage() {
  const [period, setPeriod] = useState<AccountPerformance["period"]>("YTD");
  const [performance, setPerformance] = useState(() => getEmptyAccountPerformance("YTD"));
  const [source, setSource] = useState<DataSource>("mock");

  useEffect(() => {
    let active = true;
    void fetchWithFallback<AccountPerformance>(
      `/accounts/current-paper/performance?period=${period}`,
      getEmptyAccountPerformance(period),
    ).then((result) => {
      if (!active) return;
      setPerformance(result.data);
      setSource(result.source);
    });
    return () => {
      active = false;
    };
  }, [period]);

  const metrics = [
    {
      label: "账户本金",
      value: formatCurrency(performance.initialCapital),
      tone: "neutral",
      icon: Landmark,
    },
    {
      label: "当前总资产",
      value: formatCurrency(performance.currentEquity),
      tone: "neutral",
      icon: WalletCards,
    },
    {
      label: `${performance.periodLabel}盈亏`,
      value: formatCurrency(performance.periodPnl),
      tone: (performance.periodPnl ?? 0) >= 0 ? "positive" : "negative",
      icon: (performance.periodPnl ?? 0) >= 0 ? ArrowUpRight : ArrowDownRight,
    },
    {
      label: `${performance.periodLabel}收益率`,
      value: formatPercent(performance.periodReturnPercent),
      tone: (performance.periodReturnPercent ?? 0) >= 0 ? "positive" : "negative",
      icon: Activity,
    },
    {
      label: "今年已实现盈利",
      value: formatCurrency(performance.realizedPnlYtd),
      tone: "positive",
      icon: ArrowUpRight,
    },
    {
      label: "当前浮动盈亏",
      value: formatCurrency(performance.unrealizedPnl),
      tone: performance.unrealizedPnl >= 0 ? "positive" : "negative",
      icon: ArrowDownRight,
    },
    {
      label: "最大回撤",
      value: formatPercent(performance.maxDrawdownPercent),
      tone: "negative",
      icon: ArrowDownRight,
    },
    {
      label: "盈利周期占比",
      value: formatPercent(performance.winRatePercent),
      tone: "positive",
      icon: Activity,
    },
  ] as const;

  return (
    <>
      <PageHeader
        action={
          <span className={`data-source-badge data-source-badge--${source}`}>
            {source === "api" ? "IBKR Paper 同步数据" : "API 暂不可用"}
          </span>
        }
        description={`${performance.accountName} · 按时间查看账户权益、盈亏、收益率和回撤`}
        title="账户表现"
      />

      <div className="performance-toolbar" aria-label="账户表现时间范围">
        {periods.map((item) => (
          <button
            className={period === item.value ? "is-active" : ""}
            key={item.value}
            onClick={() => setPeriod(item.value)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      <section className="performance-kpi-grid">
        {metrics.map(({ icon: Icon, label, tone, value }) => (
          <article className={`performance-kpi performance-kpi--${tone}`} key={label}>
            <span>
              {label}
              <Icon aria-hidden="true" size={17} />
            </span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <section className="performance-main-grid">
        <Panel
          description={`${performance.periodLabel}权益变化，数据来自账户权益快照`}
          title="账户权益曲线"
        >
          <PerformanceChart performance={performance} />
        </Panel>
        <Panel description="收益质量与风险调整后的表现" title="表现摘要">
          <dl className="performance-summary-list">
            <div>
              <dt>累计净收益</dt>
              <dd className={(performance.totalNetPnl ?? 0) >= 0 ? "profit-text" : "loss-text"}>
                {formatCurrency(performance.totalNetPnl)}
              </dd>
            </div>
            <div>
              <dt>累计收益率</dt>
              <dd>{formatPercent(performance.totalReturnPercent)}</dd>
            </div>
            <div>
              <dt>区间起始资产</dt>
              <dd>{formatCurrency(performance.periodStartEquity)}</dd>
            </div>
            <div>
              <dt>区间权益峰值</dt>
              <dd>{formatCurrency(performance.peakEquity)}</dd>
            </div>
            <div>
              <dt>现金余额 / 占比</dt>
              <dd>
                {formatCurrency(performance.cashBalance)} / {formatPercent(performance.cashPercent)}
              </dd>
            </div>
            <div>
              <dt>盈利 / 亏损周期</dt>
              <dd>
                {performance.profitPeriods} / {performance.lossPeriods}
              </dd>
            </div>
            <div>
              <dt>Profit Factor（已实现交易）</dt>
              <dd>
                {performance.profitFactor === null
                  ? "无足够已实现交易"
                  : performance.profitFactor.toFixed(2)}
              </dd>
            </div>
          </dl>
        </Panel>
      </section>

      <Panel
        description="每个快照周期的账户资产、累计盈亏和回撤"
        title="权益快照明细"
        trailing={<span className="panel-count">{performance.series.length} 条</span>}
      >
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>日期</th>
                <th className="number-cell">账户资产</th>
                <th className="number-cell">现金余额</th>
                <th className="number-cell">区间累计盈亏</th>
                <th className="number-cell">区间收益率</th>
                <th className="number-cell">回撤</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {[...performance.series].reverse().map((point) => (
                <tr key={point.date}>
                  <td className="mono">{point.date}</td>
                  <td className="number-cell mono">{formatCurrency(point.equity)}</td>
                  <td className="number-cell mono">{formatCurrency(point.cashBalance)}</td>
                  <td
                    className={`number-cell mono ${(point.periodPnl ?? 0) >= 0 ? "profit-text" : "loss-text"}`}
                  >
                    {formatCurrency(point.periodPnl)}
                  </td>
                  <td
                    className={`number-cell mono ${(point.periodReturnPercent ?? 0) >= 0 ? "profit-text" : "loss-text"}`}
                  >
                    {formatPercent(point.periodReturnPercent)}
                  </td>
                  <td className="number-cell mono loss-text">
                    {formatPercent(point.drawdownPercent)}
                  </td>
                  <td>{point.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
