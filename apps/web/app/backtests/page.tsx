"use client";

import { Activity, ArrowRight, CirclePlay, Clock3, LoaderCircle, ServerCrash, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { fetchWithFallback, postJson, type DataSource } from "@/lib/api-client";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import type { BacktestRunView, StrategyView } from "@/lib/quant-types";

export default function BacktestsPage() {
  const [runs, setRuns] = useState<BacktestRunView[]>([]);
  const [strategies, setStrategies] = useState<StrategyView[]>([]);
  const [source, setSource] = useState<DataSource>("mock");
  const [strategyId, setStrategyId] = useState("");
  const [symbol, setSymbol] = useState("AAPL");
  const [startDate, setStartDate] = useState("2023-01-03");
  const [endDate, setEndDate] = useState("2026-07-17");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const [runResult, strategyResult] = await Promise.all([
      fetchWithFallback<BacktestRunView[]>("/backtests", []),
      fetchWithFallback<StrategyView[]>("/strategies", []),
    ]);
    setRuns(runResult.data);
    setStrategies(strategyResult.data);
    setSource(runResult.source === "api" && strategyResult.source === "api" ? "api" : "mock");
    setStrategyId((current) => current || strategyResult.data[0]?.id || "");
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.all([
      fetchWithFallback<BacktestRunView[]>("/backtests", []),
      fetchWithFallback<StrategyView[]>("/strategies", []),
    ]).then(([runResult, strategyResult]) => {
      if (!active) return;
      setRuns(runResult.data);
      setStrategies(strategyResult.data);
      setSource(runResult.source === "api" && strategyResult.source === "api" ? "api" : "mock");
      setStrategyId(strategyResult.data[0]?.id ?? "");
    });
    return () => { active = false; };
  }, []);

  async function runBacktest() {
    if (!strategyId) return;
    setBusy(true);
    setMessage("任务已创建，NestJS 正在调用 quant-engine 计算并事务保存结果……");
    try {
      const run = await postJson<BacktestRunView>("/backtests/run", {
        strategyId,
        symbol,
        startDate,
        endDate,
        marketDataSource: "SEED_V1_3",
        priceMode: "ADJUSTED",
        randomSeed: 42,
      });
      setMessage(`回测已完成：收益 ${formatPercent(run.totalReturn ?? 0)}，最大回撤 ${formatPercent(run.maxDrawdown ?? 0)}。`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "回测失败");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const completed = runs.filter((run) => run.status === "COMPLETED");
  return (
    <>
      <PageHeader description="Next.js → NestJS 任务编排 → Python 纯计算 → SQL Server 结果持久化" title="回测中心" />
      {source === "mock" ? <div className="service-error"><ServerCrash size={18} />API 或 quant-engine 当前不可用。系统不会伪造已完成回测，V1.2 风控功能不受影响。</div> : null}
      <div className="quant-stat-grid">
        <article><span>历史任务</span><strong>{runs.length}</strong><small>全部状态可追溯</small></article>
        <article><span>已完成</span><strong>{completed.length}</strong><small>事务已落库</small></article>
        <article><span>可用策略</span><strong>{strategies.filter((item) => item.enabled).length}</strong><small>结构化参数</small></article>
        <article><span>执行规则</span><strong>T+1 Open</strong><small>收盘信号次日开盘</small></article>
      </div>
      <Panel description="默认使用复权价格、手续费 0.10%、滑点 0.05%，禁止融资与裸空" title="创建回测任务">
        <div className="backtest-run-form">
          <label><span>策略</span><select onChange={(event) => setStrategyId(event.target.value)} value={strategyId}>{strategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.name}</option>)}</select></label>
          <label><span>标的</span><input onChange={(event) => setSymbol(event.target.value.toUpperCase())} value={symbol} /></label>
          <label><span>开始日期</span><input onChange={(event) => setStartDate(event.target.value)} type="date" value={startDate} /></label>
          <label><span>结束日期</span><input onChange={(event) => setEndDate(event.target.value)} type="date" value={endDate} /></label>
          <button className="primary-button" disabled={busy || source !== "api" || !strategyId} onClick={() => void runBacktest()} type="button">{busy ? <LoaderCircle className="spin" size={16} /> : <CirclePlay size={16} />}启动真实回测</button>
        </div>
        {message ? <p className="quant-message">{message}</p> : null}
      </Panel>
      <Panel description="每次运行保存策略版本、参数快照、行情范围、费用、随机种子、代码版本和错误信息" title="回测任务记录">
        <div className="table-scroll quant-table-scroll"><table className="data-table"><thead><tr><th>状态</th><th>策略</th><th>标的/区间</th><th>最终权益</th><th>总收益</th><th>最大回撤</th><th>基准收益</th><th>手续费</th><th>交易次数</th><th>详情</th></tr></thead><tbody>
          {runs.map((run) => <tr key={run.id}>
            <td><span className={`quant-status quant-status--${run.status.toLowerCase()}`}>{run.status}</span></td>
            <td><strong>{run.strategy?.name ?? run.strategyId}</strong><small className="table-subtext">v{run.strategyVersion} · {run.marketDataSource}</small></td>
            <td>{run.symbol}<small className="table-subtext">{run.marketDataStart.slice(0, 10)} → {run.marketDataEnd.slice(0, 10)}</small></td>
            <td>{run.finalEquity === null ? "-" : formatCurrency(run.finalEquity)}</td>
            <td className={(run.totalReturn ?? 0) >= 0 ? "positive-cell" : "negative-cell"}>{run.totalReturn === null ? "-" : formatPercent(run.totalReturn)}</td>
            <td className="negative-cell">{run.maxDrawdown === null ? "-" : formatPercent(run.maxDrawdown)}</td>
            <td>{run.benchmarkReturn === null ? "-" : formatPercent(run.benchmarkReturn)}</td>
            <td>{run.totalCommission === null ? "-" : formatCurrency(run.totalCommission)}</td>
            <td>{run.tradeCount ?? "-"}</td>
            <td>{run.status === "COMPLETED" ? <Link className="table-link" href={`/backtests/${run.id}`}>分析 <ArrowRight size={13} /></Link> : <span className="table-subtext">{run.errorMessage ?? "等待计算"}</span>}</td>
          </tr>)}
          {runs.length === 0 ? <tr><td colSpan={10}><div className="import-empty"><Activity size={20} /><strong>暂无真实回测任务</strong><span>选择策略后启动，结果由 quant-engine 计算。</span></div></td></tr> : null}
        </tbody></table></div>
      </Panel>
      <div className="quant-risk-footnote"><ShieldAlert size={16} /><span>回测不是收益承诺。页面始终同时展示最大回撤、交易次数、手续费和 Buy & Hold 基准，避免只看收益率。</span><Clock3 size={15} /></div>
    </>
  );
}
