"use client";

import { AlertTriangle, ArrowLeft, Download, LoaderCircle, ServerCrash } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { BacktestPerformanceCharts, BacktestPriceChart } from "@/components/backtest-charts";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { API_BASE_URL, fetchWithFallback, type DataSource } from "@/lib/api-client";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import type { BacktestRunView } from "@/lib/quant-types";

const metricLabels: Record<string, string> = {
  initialCapital: "初始资金",
  finalEquity: "最终权益",
  totalReturn: "总收益率",
  cagr: "年化收益 CAGR",
  maxDrawdown: "最大回撤",
  annualVolatility: "年化波动率",
  historicalVaR95: "95% 历史 VaR（日收益分位）",
  expectedShortfall95: "95% Expected Shortfall（左尾均值）",
  worstDailyReturn: "最差单日收益",
  sharpeRatio: "Sharpe Ratio",
  sortinoRatio: "Sortino Ratio",
  winRate: "胜率",
  profitFactor: "Profit Factor",
  payoffRatio: "盈亏比",
  totalTrades: "总交易次数",
  averageWin: "平均盈利",
  averageLoss: "平均亏损",
  expectancyPerTrade: "净单笔期望值",
  expectancyR: "期望 R",
  breakEvenWinRate: "盈亏平衡胜率",
  completedTrades: "已完成交易",
  executionCount: "成交笔数",
  averageHoldingDays: "平均持仓天数",
  maxConsecutiveWins: "最大连续盈利",
  maxConsecutiveLosses: "最大连续亏损",
  capitalUtilization: "资金使用率",
  benchmarkReturn: "Buy & Hold 收益",
  excessReturn: "相对基准超额",
  totalCommission: "手续费合计",
  totalSlippage: "滑点影响",
};
const currencyMetrics = new Set([
  "initialCapital",
  "finalEquity",
  "totalCommission",
  "totalSlippage",
  "averageWin",
  "averageLoss",
  "expectancyPerTrade",
]);
const percentMetrics = new Set([
  "totalReturn",
  "cagr",
  "maxDrawdown",
  "annualVolatility",
  "historicalVaR95",
  "expectedShortfall95",
  "worstDailyReturn",
  "winRate",
  "breakEvenWinRate",
  "capitalUtilization",
  "benchmarkReturn",
  "excessReturn",
]);

export default function BacktestDetailPage() {
  const params = useParams<{ id: string }>();
  const [run, setRun] = useState<BacktestRunView | null>(null);
  const [source, setSource] = useState<DataSource>("mock");
  useEffect(() => {
    let active = true;
    void fetchWithFallback<BacktestRunView | null>(`/backtests/${params.id}`, null).then(
      (result) => {
        if (!active) return;
        setRun(result.data);
        setSource(result.source);
      },
    );
    return () => {
      active = false;
    };
  }, [params.id]);
  const metrics = useMemo(() => Object.entries(run?.metrics ?? {}), [run]);
  if (!run)
    return (
      <div className="detail-loading">
        {source === "mock" ? (
          <>
            <ServerCrash size={22} />
            回测 API 不可用，没有伪造结果。
          </>
        ) : (
          <>
            <LoaderCircle className="spin" size={22} />
            读取回测结果……
          </>
        )}
      </div>
    );
  const displayMetric = (key: string, value: number | null) =>
    value === null
      ? "N/A"
      : currencyMetrics.has(key)
        ? formatCurrency(value)
        : percentMetrics.has(key)
          ? formatPercent(value)
          : Number(value).toFixed(
              ["totalTrades", "maxConsecutiveWins", "maxConsecutiveLosses"].includes(key) ? 0 : 2,
            );
  return (
    <>
      <PageHeader
        action={
          <div className="detail-actions">
            <Link href="/backtests">
              <ArrowLeft size={14} />
              返回
            </Link>
            <a href={`${API_BASE_URL}/backtests/${run.id}/export`}>
              <Download size={14} />
              导出 CSV
            </a>
          </div>
        }
        description={`${run.strategy?.name ?? run.strategyId} · ${run.symbol} · ${run.marketDataStart.slice(0, 10)} 至 ${run.marketDataEnd.slice(0, 10)} · ${run.marketDataSource}`}
        title="回测结果分析"
      />
      <div className="backtest-result-banner">
        <span className={`quant-status quant-status--${run.status.toLowerCase()}`}>
          {run.status}
        </span>
        <strong>策略收益 {formatPercent(run.totalReturn ?? 0)}</strong>
        <span>最大回撤 {formatPercent(run.maxDrawdown ?? 0)}</span>
        <span>基准 {formatPercent(run.benchmarkReturn ?? 0)}</span>
        <span>手续费 {formatCurrency(run.totalCommission ?? 0)}</span>
        <span>运行 {run.runDurationMs ?? 0} ms</span>
      </div>
      <div className="metric-card-grid">
        {metrics.map(([key, value]) => (
          <article
            className={
              [
                "maxDrawdown",
                "historicalVaR95",
                "expectedShortfall95",
                "worstDailyReturn",
              ].includes(key) ||
              (key === "expectancyPerTrade" && (value ?? 0) <= 0)
                ? "is-danger"
                : key === "totalReturn" || key === "expectancyPerTrade"
                  ? "is-primary"
                  : ""
            }
            key={key}
          >
            <span>{metricLabels[key] ?? key}</span>
            <strong>{displayMetric(key, value)}</strong>
          </article>
        ))}
      </div>
      <Panel description="策略权益必须与 Buy & Hold 同屏；支持区间缩放" title="绩效与回撤">
        <BacktestPerformanceCharts run={run} />
      </Panel>
      <Panel
        description={`${run.symbol} 日 K 线；图上只标记该基准标的成交，多资产成交见下方明细`}
        title="价格与买卖点"
      >
        <BacktestPriceChart run={run} />
      </Panel>
      <div className="quant-two-column">
        <Panel
          description={`策略 v${run.strategyVersion} · 随机种子和代码版本随任务保存`}
          title="参数快照"
        >
          <pre className="parameter-snapshot">{JSON.stringify(run.parameters, null, 2)}</pre>
        </Panel>
        <Panel description="回测账户与真实 IBKR 账户严格隔离" title="风险提示">
          <div className="backtest-risk-notice">
            <AlertTriangle size={20} />
            <p>{run.riskNotice}</p>
            <ul>
              <li>收盘信号最早在下一交易日开盘成交</li>
              <li>缺失行情不使用未来价格填补</li>
              <li>策略信号仍需真实账户 RiskEngine 审查</li>
              <li>系统不具备任何自动下单能力</li>
            </ul>
          </div>
        </Panel>
      </div>
      <Panel description="保存信号、下单和成交时间，以及费用、滑点和触发原因" title="逐笔交易明细">
        <div className="table-scroll quant-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>标的</th>
                <th>方向</th>
                <th>信号时间</th>
                <th>成交时间</th>
                <th>成交价</th>
                <th>数量</th>
                <th>名义金额</th>
                <th>手续费</th>
                <th>滑点</th>
                <th>已实现盈亏</th>
                <th>持仓天数</th>
                <th>触发原因</th>
              </tr>
            </thead>
            <tbody>
              {(run.trades ?? []).map((trade) => (
                <tr key={trade.id}>
                  <td>{trade.symbol}</td>
                  <td className={trade.side === "BUY" ? "positive-cell" : "negative-cell"}>
                    {trade.side}
                  </td>
                  <td>{trade.signalTime.slice(0, 10)}</td>
                  <td>{trade.executionTime.slice(0, 10)}</td>
                  <td>{formatCurrency(trade.executionPrice)}</td>
                  <td>{trade.quantity}</td>
                  <td>{formatCurrency(trade.notional)}</td>
                  <td>{formatCurrency(trade.commission)}</td>
                  <td>{formatCurrency(trade.slippage)}</td>
                  <td className={(trade.realizedPnl ?? 0) >= 0 ? "positive-cell" : "negative-cell"}>
                    {trade.realizedPnl === null ? "-" : formatCurrency(trade.realizedPnl)}
                  </td>
                  <td>{trade.holdingDays ?? "-"}</td>
                  <td>{trade.triggerReason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
