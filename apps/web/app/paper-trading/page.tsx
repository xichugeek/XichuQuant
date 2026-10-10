"use client";

import { Ban, CirclePause, CirclePlay, LoaderCircle, Power, RotateCcw, ServerCrash, Square } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { PaperEquityChart } from "@/components/paper-equity-chart";
import { Panel } from "@/components/panel";
import { fetchWithFallback, postJson, type DataSource } from "@/lib/api-client";
import { formatCurrency, formatPercent } from "@/lib/formatters";

type Strategy = { id: string; name: string; approvalStatus: string };
type Deployment = {
  id: string;
  strategyId: string;
  name: string;
  status: string;
  capitalAllocation: number;
  maxPositionPercent: number;
  consecutiveLosses: number;
  strategy: Strategy;
};
type PaperAccount = {
  id: string;
  name: string;
  status: string;
  initialCapital: number;
  cashBalance: number;
  totalEquity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  maxDrawdown: number;
  killSwitchEnabled: boolean;
  deployments: Deployment[];
  positions: Array<{ id: string; symbol: string; quantity: number; avgCost: number; currentPrice: number; marketValue: number; unrealizedPnl: number; realizedPnl: number }>;
  snapshots: Array<{ snapshotTime: string; totalEquity: number; drawdown: number }>;
};
type PaperDashboard = {
  control: { killSwitchEnabled: boolean; reason: string | null };
  accounts: PaperAccount[];
  orders: Array<{ id: string; symbol: string; side: string; status: string; signalTradeDate: string; earliestFillDate: string | null; requestedAmount: number | null; approvedQuantity: number | null; rejectionReason: string | null }>;
  fills: Array<{ id: string; price: number; quantity: number; commission: number; slippage: number; realizedPnl: number | null; executionTime: string; paperOrder: { symbol: string; side: string } }>;
  events: Array<{ id: string; eventType: string; severity: string; createdAt: string; payload: Record<string, unknown> }>;
  riskDecisions: Array<{ id: string; decision: string; createdAt: string; violations: Array<{ code: string; reason: string }> }>;
  safeguards: Record<string, boolean>;
};
type Review = { deploymentId: string; deploymentName: string; status: string; paperReturn: number; backtestReturn: number | null; returnDeviation: number | null; fillCount: number; commissionImpact: number; winRate: number; maxDrawdown: number; alerts: string[] };

const emptyDashboard: PaperDashboard = { control: { killSwitchEnabled: false, reason: null }, accounts: [], orders: [], fills: [], events: [], riskDecisions: [], safeguards: {} };

export default function PaperTradingPage() {
  const [source, setSource] = useState<DataSource>("mock");
  const [dashboard, setDashboard] = useState<PaperDashboard>(emptyDashboard);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [strategyId, setStrategyId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [allocation, setAllocation] = useState("10000");
  const [runDate, setRunDate] = useState("2026-07-16");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    const [dashboardResult, strategyResult, reviewResult] = await Promise.all([
      fetchWithFallback<PaperDashboard>("/paper-trading/dashboard", emptyDashboard),
      fetchWithFallback<Strategy[]>("/strategies", []),
      fetchWithFallback<Review[]>("/paper-trading/review", []),
    ]);
    setSource(dashboardResult.source === "api" && strategyResult.source === "api" ? "api" : "mock");
    setDashboard(dashboardResult.data);
    setReviews(reviewResult.data);
    const approved = strategyResult.data.filter((item) => item.approvalStatus === "PAPER_APPROVED" || item.approvalStatus === "PAPER_RUNNING" || item.approvalStatus === "PAPER_OBSERVING" || item.approvalStatus === "PAPER_PAUSED");
    setStrategies(approved);
    setStrategyId((current) => current || approved[0]?.id || "");
    setAccountId((current) => current || dashboardResult.data.accounts[0]?.id || "");
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function mutate(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  const account = dashboard.accounts[0];
  const deployment = account?.deployments[0];
  const review = reviews.find((item) => item.deploymentId === deployment?.id);

  return (
    <>
      <PageHeader description="独立 Paper* 账本 · 收盘信号最早下一交易日开盘成交 · 禁止融资、裸空和真实券商下单" title="模拟交易" />
      {source === "mock" ? <div className="service-error"><ServerCrash size={18} />模拟交易 API 不可用；不会显示伪造账户、订单或成交。</div> : null}
      {loading && !account ? <div className="detail-loading"><LoaderCircle className="spin" size={22} />正在读取独立模拟账本、订单和成交…</div> : null}
      <div className={`paper-kill-switch ${dashboard.control.killSwitchEnabled ? "is-active" : ""}`}>
        <span><Power size={20} /><b>全局 Kill Switch</b><small>{dashboard.control.killSwitchEnabled ? dashboard.control.reason : "未触发；仅控制模拟策略"}</small></span>
        <button disabled={busy || source !== "api"} onClick={() => void mutate(() => postJson("/paper-trading/kill-switch", { enabled: !dashboard.control.killSwitchEnabled, reason: dashboard.control.killSwitchEnabled ? "人工解除停止" : "人工紧急停止全部模拟交易" }), dashboard.control.killSwitchEnabled ? "Kill Switch 已解除，策略仍需人工重新启动。" : "所有模拟策略已暂停，待成交订单已撤销。") } type="button">{dashboard.control.killSwitchEnabled ? <RotateCcw size={16} /> : <Ban size={16} />}{dashboard.control.killSwitchEnabled ? "解除停止" : "立即停止"}</button>
      </div>
      {account ? (
        <div className="paper-kpis">
          <article><span>模拟初始资金</span><strong>{formatCurrency(account.initialCapital)}</strong><small>与真实账户隔离</small></article>
          <article><span>模拟总权益</span><strong>{formatCurrency(account.totalEquity)}</strong><small>{account.name}</small></article>
          <article><span>可用现金</span><strong>{formatCurrency(account.cashBalance)}</strong><small>禁止负现金</small></article>
          <article><span>已实现盈亏</span><strong className={account.realizedPnl < 0 ? "is-danger" : "is-success"}>{formatCurrency(account.realizedPnl)}</strong><small>仅 PaperFill</small></article>
          <article><span>未实现盈亏</span><strong className={account.unrealizedPnl < 0 ? "is-danger" : "is-success"}>{formatCurrency(account.unrealizedPnl)}</strong><small>模拟持仓</small></article>
          <article><span>最大回撤</span><strong className="is-danger">{formatPercent(account.maxDrawdown)}</strong><small>停止线 -20%</small></article>
        </div>
      ) : null}

      <div className="paper-control-grid">
        <Panel description="只有 PAPER_APPROVED 策略可以创建独立部署" title="策略部署">
          <div className="paper-deploy-form">
            <label><span>模拟账户</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{dashboard.accounts.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
            <label><span>已审批策略</span><select value={strategyId} onChange={(event) => setStrategyId(event.target.value)}>{strategies.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
            <label><span>分配资金</span><input type="number" min="1" value={allocation} onChange={(event) => setAllocation(event.target.value)} /></label>
            <button className="primary-button" disabled={busy || !strategyId || !accountId} onClick={() => void mutate(() => postJson("/paper-trading/deployments", { strategyId, paperAccountId: accountId, name: "策略模拟部署", capitalAllocation: Number(allocation), maxPositionPercent: 15, stopLossCondition: "策略回撤达到 8% 或风控规则触发时退出", exitCondition: "人工停止、Kill Switch 或达到策略退出条件" }), "模拟部署已创建。") } type="button">创建部署</button>
          </div>
          {deployment ? <div className="deployment-card"><header><span><b>{deployment.name}</b><small>{deployment.strategy.name}</small></span><em className={`quant-status quant-status--${deployment.status.toLowerCase()}`}>{deployment.status}</em></header><div><span>分配资金 <b>{formatCurrency(deployment.capitalAllocation)}</b></span><span>仓位上限 <b>{formatPercent(deployment.maxPositionPercent)}</b></span><span>连续亏损 <b>{deployment.consecutiveLosses}</b></span></div><footer><button disabled={busy || deployment.status === "PAPER_RUNNING"} onClick={() => void mutate(() => postJson(`/paper-trading/deployments/${deployment.id}/status`, { action: "START" }), "模拟策略已启动。") } type="button"><CirclePlay size={15} />启动</button><button disabled={busy || deployment.status !== "PAPER_RUNNING"} onClick={() => void mutate(() => postJson(`/paper-trading/deployments/${deployment.id}/status`, { action: "PAUSE" }), "模拟策略已暂停。") } type="button"><CirclePause size={15} />暂停</button><button disabled={busy || deployment.status === "PAPER_STOPPED"} onClick={() => void mutate(() => postJson(`/paper-trading/deployments/${deployment.id}/status`, { action: "STOP" }), "模拟策略已停止。") } type="button"><Square size={14} />停止</button></footer></div> : <div className="empty-state">尚无策略部署</div>}
        </Panel>
        <Panel description="同一策略、标的、交易日和版本只能执行一次" title="执行与幂等检查">
          <div className="paper-run-box"><label><span>信号交易日</span><input type="date" value={runDate} onChange={(event) => setRunDate(event.target.value)} /></label><button className="primary-button" disabled={busy || !deployment || deployment.status !== "PAPER_RUNNING"} onClick={() => { if (deployment) void mutate(() => postJson(`/paper-trading/deployments/${deployment.id}/run`, { signalTradeDate: runDate }), "模拟执行完成；重复运行只会返回同一执行任务。"); }} type="button">{busy ? <LoaderCircle className="spin" size={16} /> : <CirclePlay size={16} />}生成信号并审查</button><button disabled={busy} onClick={() => void mutate(() => postJson("/paper-trading/orders/process"), "待成交订单处理完成。") } type="button">处理下一开盘</button></div>
          <div className="safeguard-list">{Object.entries(dashboard.safeguards).map(([name, enabled]) => <span key={name} className={enabled ? "is-on" : "is-off"}><i />{name}: {String(enabled)}</span>)}</div>
        </Panel>
      </div>
      {message ? <p className="quant-message">{message}</p> : null}

      {account ? <Panel description="权益、回撤和真实成交成本均来自独立模拟账本" title="模拟账户表现"><PaperEquityChart points={account.snapshots} /></Panel> : null}

      <div className="paper-data-grid">
        <Panel description={`${account?.positions.length ?? 0} 个模拟持仓`} title="模拟持仓">
          <div className="table-scroll"><table className="data-table"><thead><tr><th>代码</th><th>数量</th><th>平均成本</th><th>当前价</th><th>市值</th><th>浮盈亏</th></tr></thead><tbody>{account?.positions.map((item) => <tr key={item.id}><td><b>{item.symbol}</b></td><td>{item.quantity}</td><td>{formatCurrency(item.avgCost)}</td><td>{formatCurrency(item.currentPrice)}</td><td>{formatCurrency(item.marketValue)}</td><td className={item.unrealizedPnl < 0 ? "is-danger" : "is-success"}>{formatCurrency(item.unrealizedPnl)}</td></tr>)}</tbody></table></div>
        </Panel>
        <Panel description="信号日与成交日严格分离" title="模拟订单与成交">
          <div className="table-scroll"><table className="data-table"><thead><tr><th>标的</th><th>方向</th><th>信号日</th><th>最早成交</th><th>状态</th><th>成交数量</th></tr></thead><tbody>{dashboard.orders.map((item) => <tr key={item.id}><td><b>{item.symbol}</b></td><td>{item.side}</td><td>{item.signalTradeDate.slice(0, 10)}</td><td>{item.earliestFillDate?.slice(0, 10) ?? "等待行情"}</td><td><em className={`quant-status quant-status--${item.status.toLowerCase()}`}>{item.status}</em></td><td>{item.approvedQuantity ?? "—"}</td></tr>)}</tbody></table></div>
        </Panel>
      </div>
      <div className="paper-data-grid">
        <Panel description="成交价格、滑点、手续费、盈亏均可追溯" title="成交明细">
          <div className="paper-fill-list">{dashboard.fills.map((fill) => <article key={fill.id}><b>{fill.paperOrder.side} {fill.paperOrder.symbol}</b><span>{fill.executionTime.slice(0, 10)} · {fill.quantity} 股 × {formatCurrency(fill.price)}</span><small>手续费 {formatCurrency(fill.commission)} · 滑点 {formatCurrency(fill.slippage)} · 已实现 {fill.realizedPnl === null ? "—" : formatCurrency(fill.realizedPnl)}</small></article>)}</div>
        </Panel>
        <Panel description="模拟实盘与历史回测偏差必须同时观察" title="模拟复盘">
          {review ? <div className="paper-review"><div><span>模拟收益 <b>{formatPercent(review.paperReturn)}</b></span><span>回测收益 <b>{review.backtestReturn === null ? "—" : formatPercent(review.backtestReturn)}</b></span><span>收益偏差 <b>{review.returnDeviation === null ? "—" : formatPercent(review.returnDeviation)}</b></span><span>手续费影响 <b>{formatCurrency(review.commissionImpact)}</b></span></div>{review.alerts.length ? <ul>{review.alerts.map((alert) => <li key={alert}>{alert}</li>)}</ul> : <p>当前没有达到复盘警戒阈值。</p>}</div> : <div className="empty-state">部署产生模拟成交后显示对比</div>}
        </Panel>
      </div>
      <Panel description="审批、信号、风控、订单、成交、停止操作均留痕" title="审计事件">
        <div className="paper-event-list">{dashboard.events.map((event) => <article key={event.id}><em>{event.severity}</em><b>{event.eventType}</b><span>{new Date(event.createdAt).toLocaleString("zh-CN")}</span><code>{JSON.stringify(event.payload)}</code></article>)}</div>
      </Panel>
    </>
  );
}
