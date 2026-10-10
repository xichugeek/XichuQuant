"use client";

import type { PositionRiskView, RiskLevel } from "@xichu-risk/shared";
import * as echarts from "echarts";
import { ChartPie, Crosshair, ShieldCheck, WalletCards } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import type { DataSource } from "@/lib/api-client";
import { formatCurrency, formatPercent } from "@/lib/formatters";

type PositionAllocationMapProps = {
  accountName: string;
  cashBalance: number;
  overallRiskLevel: RiskLevel;
  positions: PositionRiskView[];
  source: DataSource;
  totalEquity: number;
};

type AllocationSlice = {
  color: string;
  id: string;
  name: string;
  percent: number;
  riskLevel: RiskLevel | "CASH";
  symbol: string;
  value: number;
};

const allocationPalette = [
  "#ff5c72",
  "#ff9a52",
  "#19c9f5",
  "#9a78ff",
  "#4ddd98",
  "#f3ca62",
  "#35d7c8",
];

const riskLabels: Record<RiskLevel, string> = {
  DANGER: "高风险",
  LOW: "稳健",
  MEDIUM: "关注",
  VIOLATION: "违规",
  WARNING: "警告",
};

function conciseName(value: string) {
  return value.length > 14 ? `${value.slice(0, 14)}…` : value;
}

function distinctPositionName(symbol: string, name: string) {
  const normalizedName = name.trim();
  return normalizedName.localeCompare(symbol.trim(), undefined, { sensitivity: "accent" }) === 0
    ? ""
    : normalizedName;
}

function sliceSubtitle(slice: AllocationSlice) {
  const distinctName = distinctPositionName(slice.symbol, slice.name);
  if (distinctName) return distinctName;
  return slice.riskLevel === "CASH" ? "可用现金与现金等价物" : riskLabels[slice.riskLevel];
}

function buildSlices(
  positions: PositionRiskView[],
  cashBalance: number,
  totalEquity: number,
): AllocationSlice[] {
  const sorted = positions
    .filter((position) => position.marketValue > 0)
    .sort((left, right) => right.marketValue - left.marketValue);
  const visible = sorted.slice(0, 7);
  const remainder = sorted.slice(7);
  const divisor = totalEquity > 0 ? totalEquity : cashBalance + sorted.reduce((sum, item) => sum + item.marketValue, 0);
  const slices: AllocationSlice[] = visible.map((position, index) => ({
    color: allocationPalette[index % allocationPalette.length]!,
    id: position.id,
    name: position.name,
    percent: divisor > 0 ? (position.marketValue / divisor) * 100 : 0,
    riskLevel: position.riskLevel,
    symbol: position.symbol,
    value: position.marketValue,
  }));

  if (remainder.length > 0) {
    const value = remainder.reduce((sum, item) => sum + item.marketValue, 0);
    slices.push({
      color: "#7d90aa",
      id: "other-positions",
      name: `${remainder.length} 只较小仓位`,
      percent: divisor > 0 ? (value / divisor) * 100 : 0,
      riskLevel: "MEDIUM",
      symbol: "其他",
      value,
    });
  }

  if (cashBalance > 0) {
    slices.push({
      color: "#438cff",
      id: "cash",
      name: "可用现金与现金等价物",
      percent: divisor > 0 ? (cashBalance / divisor) * 100 : 0,
      riskLevel: "CASH",
      symbol: "现金",
      value: cashBalance,
    });
  }

  return slices;
}

export function PositionAllocationMap({
  accountName,
  cashBalance,
  overallRiskLevel,
  positions,
  source,
  totalEquity,
}: PositionAllocationMapProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const slices = useMemo(
    () => buildSlices(positions, cashBalance, totalEquity),
    [cashBalance, positions, totalEquity],
  );
  const largestPosition = useMemo(
    () => [...positions].sort((left, right) => right.marketValue - left.marketValue)[0],
    [positions],
  );
  const coreExposure = positions
    .filter((position) => position.category === "CORE")
    .reduce((sum, position) => sum + position.marketValue, 0);
  const highRiskExposure = positions
    .filter((position) => ["DANGER", "VIOLATION"].includes(position.riskLevel))
    .reduce((sum, position) => sum + position.marketValue, 0);
  const allocationLabel = slices
    .map((slice) => `${slice.symbol} ${formatPercent(slice.percent, 1)}`)
    .join("，");

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const data = slices.map((slice) => ({
      ...slice,
      itemStyle: {
        borderColor: slice.color,
        borderWidth: 2,
        color: new echarts.graphic.LinearGradient(0, 0, 1, 1, [
          { color: `${slice.color}e8`, offset: 0 },
          { color: `${slice.color}55`, offset: 0.58 },
          { color: `${slice.color}25`, offset: 1 },
        ]),
        shadowBlur: 18,
        shadowColor: `${slice.color}70`,
      },
      name: slice.symbol,
      value: slice.value,
    }));
    const fullLabel = (parameters: unknown) => {
      const item = (parameters as { data: AllocationSlice }).data;
      const distinctName = distinctPositionName(item.symbol, item.name);
      return [
        `{symbol|${item.symbol}}`,
        distinctName ? `{name|${conciseName(distinctName)}}` : "",
        `{percent|${formatPercent(item.percent, 1)}}`,
      ]
        .filter(Boolean)
        .join("\n");
    };
    const compactLabel = (parameters: unknown) => {
      const item = (parameters as { data: AllocationSlice }).data;
      return `{symbol|${item.symbol}}\n{percent|${formatPercent(item.percent, 1)}}`;
    };

    chart.setOption({
      animation: !reducedMotion,
      animationDuration: 900,
      animationEasing: "cubicOut",
      backgroundColor: "transparent",
      series: [
        {
          avoidLabelOverlap: true,
          center: ["50%", "50%"],
          data,
          emphasis: {
            itemStyle: { shadowBlur: 28, shadowColor: "rgba(88, 174, 255, .55)" },
            scale: true,
            scaleSize: 7,
          },
          label: {
            color: "#dfeaff",
            formatter: fullLabel,
            lineHeight: 19,
            rich: {
              name: { color: "#879bb6", fontSize: 11, lineHeight: 16 },
              percent: {
                color: "#f2f7ff",
                fontFamily: "Cascadia Code, monospace",
                fontSize: 14,
                fontWeight: 700,
                lineHeight: 19,
              },
              symbol: { color: "#f8fbff", fontSize: 15, fontWeight: 800, lineHeight: 20 },
            },
          },
          labelLine: {
            length: 18,
            length2: 12,
            lineStyle: { color: "rgba(117, 177, 255, .55)", width: 1 },
          },
          minAngle: 3,
          radius: ["42%", "72%"],
          type: "pie",
        },
        {
          data: [{ value: 1 }],
          itemStyle: {
            borderColor: "rgba(91, 178, 255, .72)",
            borderWidth: 1,
            color: "transparent",
            shadowBlur: 22,
            shadowColor: "rgba(56, 142, 255, .45)",
          },
          label: { show: false },
          radius: ["76%", "77%"],
          silent: true,
          type: "pie",
          z: 0,
        },
      ],
      tooltip: {
        backgroundColor: "rgba(8, 18, 34, .96)",
        borderColor: "rgba(100, 176, 255, .45)",
        borderWidth: 1,
        formatter: (parameters: unknown) => {
          const item = (parameters as { data: AllocationSlice }).data;
          if (!item?.symbol) return "";
          const risk = item.riskLevel === "CASH" ? "现金储备" : riskLabels[item.riskLevel];
          const distinctName = distinctPositionName(item.symbol, item.name);
          return [
            item.symbol,
            distinctName,
            `${formatCurrency(item.value)} · ${formatPercent(item.percent)}`,
            risk,
          ]
            .filter(Boolean)
            .join("\n");
        },
        renderMode: "richText",
        textStyle: { color: "#e8f2ff", fontSize: 12, lineHeight: 20 },
        trigger: "item",
      },
    });

    chart.setOption({
      media: [
        {
          option: {
            series: [
              {
                label: { formatter: compactLabel, position: "inside" },
                labelLine: { show: false },
                radius: ["39%", "74%"],
              },
            ],
          },
          query: { maxWidth: 620 },
        },
      ],
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(chartRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [slices]);

  return (
    <section className="position-allocation-visual">
      <header className="position-allocation-visual__header">
        <div>
          <span className="position-allocation-visual__eyebrow">
            ACCOUNT ALLOCATION · LIVE RISK VIEW
          </span>
          <h2>我的美股持仓配置</h2>
          <p>账户权益、现金储备与每只标的的真实市值分布</p>
        </div>
        <span
          className={[
            "position-allocation-visual__source",
            source === "api" ? "position-allocation-visual__source--live" : "",
          ].join(" ")}
        >
          <i />
          {source === "api" ? "API 账户数据" : "API 暂不可用"}
        </span>
      </header>

      <div className="position-allocation-visual__body">
        <div className="position-allocation-visual__stage">
          <div
            aria-label={`当前账户仓位分布：${allocationLabel}`}
            className="position-allocation-visual__chart"
            ref={chartRef}
            role="img"
          />
          <div aria-hidden="true" className="position-allocation-visual__center">
            <WalletCards size={18} />
            <span>账户总权益</span>
            <strong>{formatCurrency(totalEquity)}</strong>
            <small>{accountName}</small>
          </div>
        </div>

        <aside className="position-allocation-legend">
          <div className="position-allocation-legend__title">
            <span>配置明细</span>
            <b>{formatPercent(100 - (totalEquity > 0 ? (cashBalance / totalEquity) * 100 : 0), 1)} 已投资</b>
          </div>
          <div className="position-allocation-legend__rows">
            {slices.map((slice) => (
              <article key={slice.id}>
                <i style={{ backgroundColor: slice.color, boxShadow: `0 0 12px ${slice.color}` }} />
                <span>
                  <b>{slice.symbol}</b>
                  <small>{sliceSubtitle(slice)}</small>
                </span>
                <span>
                  <b>{formatPercent(slice.percent, 1)}</b>
                  <small>{formatCurrency(slice.value)}</small>
                </span>
              </article>
            ))}
          </div>
        </aside>
      </div>

      <footer className="position-allocation-insights">
        <article>
          <Crosshair aria-hidden="true" size={18} />
          <span>
            <small>核心配置</small>
            <b>{formatPercent(totalEquity > 0 ? (coreExposure / totalEquity) * 100 : 0, 1)}</b>
          </span>
        </article>
        <article>
          <ChartPie aria-hidden="true" size={18} />
          <span>
            <small>最大单一仓位</small>
            <b>
              {largestPosition?.symbol ?? "—"} · {formatPercent(largestPosition?.positionPercent ?? 0, 1)}
            </b>
          </span>
        </article>
        <article className={highRiskExposure > 0 ? "position-allocation-insights__risk" : ""}>
          <ShieldCheck aria-hidden="true" size={18} />
          <span>
            <small>高风险暴露</small>
            <b>{formatPercent(totalEquity > 0 ? (highRiskExposure / totalEquity) * 100 : 0, 1)}</b>
          </span>
        </article>
        <article>
          <ShieldCheck aria-hidden="true" size={18} />
          <span>
            <small>组合风险状态</small>
            <b>{riskLabels[overallRiskLevel]}</b>
          </span>
        </article>
      </footer>
    </section>
  );
}
