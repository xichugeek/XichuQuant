"use client";

import { Activity, CheckCircle2, LoaderCircle, RefreshCw, ServerCrash, ShieldAlert, Telescope } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { getJson, postJson } from "@/lib/api-client";
import { formatCurrency, formatPercent } from "@/lib/formatters";

type Metrics = { totalReturn?: number; maxDrawdown?: number; executionCount?: number };
type Observation = {
  id: string;
  observationDate: string;
  runningTradingDays: number;
  signalCount: number;
  fillCount: number;
  actualReturn: number;
  theoreticalReturn: number;
  returnDeviation: number;
  actualSlippage: number;
  totalCommission: number;
  maxDrawdown: number;
  consecutiveLosses: number;
  riskRejectedCount: number;
  dataSkippedCount: number;
  serviceSkippedCount: number;
  comparison: {
    historicalBacktest: Metrics | null;
    outOfSample: Metrics | null;
    walkForward: Array<{ start: string; end: string; return: number }>;
    forward: Metrics & { runningTradingDays: number; signalCount: number; fillCount: number };
    observationEligible: boolean;
  };
};
type DeploymentObservation = {
  deployment: { id: string; name: string; status: string; observationRequiredDays: number; observationStartedAt: string | null; strategy: { name: string; code: string; approvalStatus: string } };
  latest: Observation | null;
  history: Observation[];
  boundaries: Record<string, boolean>;
};

const pct = (value?: number | null) => value === null || value === undefined ? "—" : formatPercent(value);

export default function ForwardObservationPage() {
  const [rows, setRows] = useState<DeploymentObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [marketDate, setMarketDate] = useState("2026-07-17");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { setRows(await getJson<DeploymentObservation[]>("/operations/forward-observations")); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "前向观察 API 不可用"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function recalculate() {
    setBusy(true); setMessage(""); setError("");
    try { await postJson("/operations/forward-observations/refresh", { marketDate }); setMessage("前向观察指标已按真实 Paper 账本重新计算。"); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "计算失败"); }
    finally { setBusy(false); }
  }

  const selected = rows[0];
  const latest = selected?.latest;
  const progress = latest && selected ? Math.min(100, latest.runningTradingDays / selected.deployment.observationRequiredDays * 100) : 0;

  return (
    <>
      <PageHeader description="历史回测、样本外、Walk-forward 与前向模拟严格分栏；观察期不会自动升级为实盘资格" title="前向模拟观察" />
      {error ? <div className="service-error"><ServerCrash size={18} />{error}</div> : null}
      <div className="v15-action-bar">
        <label><span>观察截止交易日</span><input type="date" value={marketDate} onChange={(event) => setMarketDate(event.target.value)} /></label>
        <button className="primary-button" disabled={busy} onClick={() => void recalculate()} type="button">{busy ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}重算观察指标</button>
        <small>只读取 Paper* 模拟账本，不修改真实账户</small>
      </div>
      {message ? <p className="quant-message">{message}</p> : null}
      {loading && rows.length === 0 ? <div className="detail-loading"><LoaderCircle className="spin" size={22} />正在读取模拟成交、验证和回测对比…</div> : null}
      {selected && latest ? (
        <>
          <div className="v15-observation-hero">
            <span><Telescope size={21} /><b>{selected.deployment.name}</b><small>{selected.deployment.strategy.name} · {selected.deployment.strategy.approvalStatus}</small></span>
            <div><label>观察期 {latest.runningTradingDays}/{selected.deployment.observationRequiredDays} 个交易日</label><span><i style={{ width: `${progress}%` }} /></span></div>
            <em className={latest.comparison.observationEligible ? "is-pass" : "is-wait"}>{latest.comparison.observationEligible ? "观察条件已满足" : "PAPER_OBSERVING"}</em>
          </div>
          <div className="paper-kpis">
            <article><span>运行交易日</span><strong>{latest.runningTradingDays}</strong><small>目标 {selected.deployment.observationRequiredDays}</small></article>
            <article><span>信号 / 成交</span><strong>{latest.signalCount} / {latest.fillCount}</strong><small>有效事件</small></article>
            <article><span>模拟收益</span><strong className={latest.actualReturn < 0 ? "is-danger" : "is-success"}>{pct(latest.actualReturn)}</strong><small>Paper 账本</small></article>
            <article><span>同期理论收益</span><strong>{pct(latest.theoreticalReturn)}</strong><small>复权价格</small></article>
            <article><span>收益偏差</span><strong className={Math.abs(latest.returnDeviation) > 10 ? "is-danger" : "is-success"}>{pct(latest.returnDeviation)}</strong><small>警戒 ±10%</small></article>
            <article><span>最大回撤</span><strong className="is-danger">{pct(latest.maxDrawdown)}</strong><small>模拟账户</small></article>
          </div>
          <Panel description="四个阶段不会合并收益；每列使用独立数据来源" title="策略阶段对比">
            <div className="v15-stage-grid">
              <article><header>历史回测</header><strong>{pct(latest.comparison.historicalBacktest?.totalReturn)}</strong><span>最大回撤 {pct(latest.comparison.historicalBacktest?.maxDrawdown)}</span><small>历史全区间，仅用于研究</small></article>
              <article><header>样本外验证</header><strong>{pct(latest.comparison.outOfSample?.totalReturn)}</strong><span>最大回撤 {pct(latest.comparison.outOfSample?.maxDrawdown)}</span><small>时间顺序后 30%</small></article>
              <article><header>Walk-forward</header><strong>{latest.comparison.walkForward.length} 窗口</strong><span>累计窗口独立保存</span><small>滚动训练/验证</small></article>
              <article className="is-forward"><header>前向模拟</header><strong>{pct(latest.actualReturn)}</strong><span>{latest.runningTradingDays} 个真实推进交易日</span><small>模拟订单与成交</small></article>
            </div>
          </Panel>
          <div className="paper-data-grid">
            <Panel description="滑点、手续费、拒绝和跳过均来自真实任务与账本" title="执行质量">
              <div className="v15-metric-list"><p><span>实际滑点</span><b>{formatCurrency(latest.actualSlippage)}</b></p><p><span>手续费</span><b>{formatCurrency(latest.totalCommission)}</b></p><p><span>RiskEngine 拒绝</span><b>{latest.riskRejectedCount}</b></p><p><span>数据异常跳过</span><b>{latest.dataSkippedCount}</b></p><p><span>服务异常跳过</span><b>{latest.serviceSkippedCount}</b></p><p><span>连续亏损</span><b>{latest.consecutiveLosses}</b></p></div>
            </Panel>
            <Panel description="满足观察期也不会自动进入真实交易" title="观察期资格">
              <div className="v15-observation-checks"><p className={latest.runningTradingDays >= selected.deployment.observationRequiredDays ? "is-pass" : ""}><CheckCircle2 size={15} />至少 {selected.deployment.observationRequiredDays} 个完整交易日</p><p className={latest.signalCount + latest.fillCount > 0 ? "is-pass" : ""}><CheckCircle2 size={15} />存在有效信号或成交</p><p className={latest.riskRejectedCount === 0 ? "is-pass" : ""}><ShieldAlert size={15} />未触发重大风控事件</p><p className={Math.abs(latest.returnDeviation) <= 10 ? "is-pass" : ""}><Activity size={15} />回测偏差在允许范围</p></div>
            </Panel>
          </div>
          <Panel description="每个交易日保存独立快照，支持长期观察" title="观察历史">
            <div className="table-scroll"><table className="data-table"><thead><tr><th>日期</th><th>交易日</th><th>信号</th><th>成交</th><th>模拟收益</th><th>同期理论</th><th>偏差</th><th>回撤</th><th>手续费</th></tr></thead><tbody>{selected.history.map((item) => <tr key={item.id}><td>{item.observationDate.slice(0, 10)}</td><td>{item.runningTradingDays}</td><td>{item.signalCount}</td><td>{item.fillCount}</td><td>{pct(item.actualReturn)}</td><td>{pct(item.theoreticalReturn)}</td><td className={Math.abs(item.returnDeviation) > 10 ? "is-danger" : ""}>{pct(item.returnDeviation)}</td><td className="is-danger">{pct(item.maxDrawdown)}</td><td>{formatCurrency(item.totalCommission)}</td></tr>)}</tbody></table></div>
          </Panel>
        </>
      ) : !loading ? <div className="empty-state">尚无 PAPER_RUNNING / PAPER_OBSERVING 策略数据</div> : null}
    </>
  );
}
