"use client";

import { CalendarClock, LoaderCircle, Play, RefreshCw, RotateCcw, ServerCrash } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { getJson, postJson } from "@/lib/api-client";

type Task = {
  id: string;
  parentTaskId: string | null;
  taskType: string;
  idempotencyKey: string;
  status: string;
  marketDate: string | null;
  attemptCount: number;
  maxAttempts: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  input: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
};

const taskLabels: Record<string, string> = {
  DAILY_CYCLE: "每日总任务",
  MARKET_DATA_SYNC: "行情同步",
  DATA_QUALITY_GATE: "数据质量门",
  STRATEGY_EXECUTION: "策略运行",
  PAPER_ORDER_EXECUTION: "模拟订单执行",
  EQUITY_SNAPSHOT: "权益快照",
  RISK_RECALCULATION: "风控重算",
  FORWARD_OBSERVATION: "前向观察",
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [marketDate, setMarketDate] = useState("2026-07-17");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { setTasks(await getJson<Task[]>("/operations/tasks")); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "任务 API 不可用"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function runCycle() {
    setBusy(true); setMessage(""); setError("");
    try {
      const result = await postJson<{ idempotent?: boolean; status: string }>("/operations/daily-cycle", { marketDate, providerCode: "SEED_V1_3" });
      setMessage(result.idempotent ? "同一交易日任务已存在，返回原结果，未重复写库。" : `每日任务已执行：${result.status}`);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "任务执行失败"); }
    finally { setBusy(false); }
  }

  async function retry(id: string) {
    setBusy(true); setMessage("");
    try { await postJson(`/operations/tasks/${id}/retry`); setMessage("失败任务已按原幂等键安全重试。"); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "重试失败"); }
    finally { setBusy(false); }
  }

  const visible = useMemo(() => statusFilter === "ALL" ? tasks : tasks.filter((task) => task.status === statusFilter), [statusFilter, tasks]);
  const count = (status: string) => tasks.filter((task) => task.status === status).length;

  return (
    <>
      <PageHeader description="行情同步、策略运行、模拟订单、权益快照、风控与前向观察统一编排；全部使用稳定幂等键" title="任务中心" />
      {error ? <div className="service-error"><ServerCrash size={18} />{error}</div> : null}
      <div className="v15-action-bar">
        <label><span>执行交易日</span><input type="date" value={marketDate} onChange={(event) => setMarketDate(event.target.value)} /></label>
        <button className="primary-button" disabled={busy} onClick={() => void runCycle()} type="button">{busy ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}运行每日闭环</button>
        <button disabled={busy} onClick={() => void refresh()} type="button"><RefreshCw size={15} />刷新</button>
        <small>重复运行不会重复写行情、信号、订单、成交或现金流水</small>
      </div>
      {message ? <p className="quant-message">{message}</p> : null}
      <div className="paper-kpis">
        <article><span>任务总数</span><strong>{tasks.length}</strong><small>SQL Server 审计</small></article>
        <article><span>已完成</span><strong className="is-success">{count("COMPLETED")}</strong><small>含幂等返回</small></article>
        <article><span>运行中</span><strong>{count("RUNNING") + count("RETRYING")}</strong><small>重启可恢复</small></article>
        <article><span>失败</span><strong className="is-danger">{count("FAILED")}</strong><small>默认不放行</small></article>
        <article><span>已跳过</span><strong>{count("SKIPPED")}</strong><small>休市/质量门/Kill Switch</small></article>
        <article><span>最大重试</span><strong>3</strong><small>同一幂等键</small></article>
      </div>
      <Panel description="状态：PENDING / RUNNING / COMPLETED / FAILED / RETRYING / CANCELLED / SKIPPED" title="任务流水">
        <div className="v15-table-toolbar"><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">全部状态</option>{["PENDING", "RUNNING", "COMPLETED", "FAILED", "RETRYING", "CANCELLED", "SKIPPED"].map((status) => <option value={status} key={status}>{status}</option>)}</select><span>{visible.length} 条</span></div>
        {loading && tasks.length === 0 ? <div className="detail-loading"><LoaderCircle className="spin" size={20} />正在读取任务账本…</div> : null}
        <div className="table-scroll"><table className="data-table v15-wide-table"><thead><tr><th>任务</th><th>交易日</th><th>状态</th><th>开始</th><th>结束</th><th>重试</th><th>幂等键</th><th>错误原因</th><th>操作</th></tr></thead><tbody>{visible.map((task) => <tr key={task.id}><td><b>{taskLabels[task.taskType] ?? task.taskType}</b><small className="v15-cell-note">{task.parentTaskId ? "子任务" : "顶层任务"}</small></td><td>{task.marketDate?.slice(0, 10) ?? "—"}</td><td><em className={`quant-status quant-status--${task.status.toLowerCase()}`}>{task.status}</em></td><td>{task.startedAt ? new Date(task.startedAt).toLocaleString("zh-CN") : "—"}</td><td>{task.completedAt ? new Date(task.completedAt).toLocaleString("zh-CN") : "—"}</td><td>{task.attemptCount}/{task.maxAttempts}</td><td><code className="v15-idempotency">{task.idempotencyKey}</code></td><td className="is-danger">{task.errorMessage ?? "—"}</td><td>{task.status === "FAILED" ? <button disabled={busy} onClick={() => void retry(task.id)} type="button"><RotateCcw size={13} />重试</button> : "—"}</td></tr>)}</tbody></table></div>
        {visible.length === 0 && !loading ? <div className="empty-state"><CalendarClock size={18} />没有符合筛选条件的任务</div> : null}
      </Panel>
    </>
  );
}
