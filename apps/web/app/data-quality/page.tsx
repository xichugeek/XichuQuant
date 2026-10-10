"use client";

import { CheckCircle2, DatabaseZap, LoaderCircle, RefreshCw, ServerCrash, ShieldX, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { getJson, postJson } from "@/lib/api-client";

type Provider = {
  id: string;
  code: string;
  name: string;
  providerType: string;
  enabled: boolean;
  lastSyncAt: string | null;
  lastHealthStatus: string | null;
  health: { ok: boolean; message: string; version: string; rateLimit: { limit: number | null; remaining: number | null } | null };
};
type Report = {
  id: string;
  symbol: string;
  analysisDate: string;
  latestTradeDate: string | null;
  missingDayCount: number;
  duplicateCount: number;
  invalidOhlcCount: number;
  zeroVolumeCount: number;
  splitEventCount: number;
  dividendEventCount: number;
  allowStrategyRun: boolean;
  status: string;
  provider: Provider;
  issues: { issues: string[]; missingDays: string[] };
};
type SyncJob = { id: string; status: string; createdAt: string; finishedAt: string | null; errorMessage: string | null; provider: Provider };
type Dashboard = { providers: Provider[]; reports: Report[]; syncJobs: SyncJob[]; safeguards: Record<string, boolean | string> };

export default function DataQualityPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [marketDate, setMarketDate] = useState("2026-07-17");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await getJson<Dashboard>("/operations/data-quality"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "数据质量 API 不可用");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function runQualityCheck() {
    setBusy(true); setMessage(""); setError("");
    try {
      await postJson("/operations/data-quality/refresh", { marketDate, providerCode: "SEED_V1_3" });
      setMessage("数据质量检查已完成；异常标的会阻止策略运行。");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "检查失败");
    } finally { setBusy(false); }
  }

  const latestReports = useMemo(() => {
    const seen = new Set<string>();
    return (data?.reports ?? []).filter((report) => !seen.has(report.symbol) && seen.add(report.symbol));
  }, [data]);
  const blocked = latestReports.filter((report) => !report.allowStrategyRun).length;

  return (
    <>
      <PageHeader description="美国交易日历 · Provider 健康度 · OHLC/成交量/拆分/股息检查 · 异常数据默认阻止策略" title="数据质量中心" />
      {error ? <div className="service-error"><ServerCrash size={18} />{error}；系统不会把异常数据伪装成可交易。</div> : null}
      <div className="v15-action-bar">
        <label><span>检查交易日</span><input type="date" value={marketDate} onChange={(event) => setMarketDate(event.target.value)} /></label>
        <button className="primary-button" disabled={busy} onClick={() => void runQualityCheck()} type="button">{busy ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}重新检查</button>
        <small>时区固定 America/New_York，不使用服务器本地日期</small>
      </div>
      {message ? <p className="quant-message">{message}</p> : null}
      {loading && !data ? <div className="detail-loading"><LoaderCircle className="spin" size={22} />正在读取 Provider、同步任务和质量报告…</div> : null}
      {data ? (
        <>
          <div className="paper-kpis">
            <article><span>行情 Provider</span><strong>{data.providers.length}</strong><small>统一适配接口</small></article>
            <article><span>健康 Provider</span><strong className="is-success">{data.providers.filter((item) => item.health?.ok).length}</strong><small>在线源默认未配置</small></article>
            <article><span>检查标的</span><strong>{latestReports.length}</strong><small>最近一份报告</small></article>
            <article><span>阻止运行</span><strong className={blocked ? "is-danger" : "is-success"}>{blocked}</strong><small>默认拒绝</small></article>
            <article><span>缺失交易日</span><strong className="is-danger">{latestReports.reduce((sum, item) => sum + item.missingDayCount, 0)}</strong><small>纽约交易日历</small></article>
            <article><span>异常 OHLC</span><strong className="is-danger">{latestReports.reduce((sum, item) => sum + item.invalidOhlcCount, 0)}</strong><small>事务前检查</small></article>
          </div>
          <div className="v15-provider-grid">
            {data.providers.map((provider) => <article key={provider.id}><header><DatabaseZap size={17} /><span><b>{provider.name}</b><small>{provider.code} · {provider.providerType}</small></span><em className={provider.health?.ok ? "is-good" : "is-muted"}>{provider.health?.ok ? "HEALTHY" : provider.enabled ? "UNAVAILABLE" : "DISABLED"}</em></header><p>{provider.health?.message ?? "尚未检查"}</p><footer><span>版本 {provider.health?.version ?? "—"}</span><span>最近同步 {provider.lastSyncAt ? new Date(provider.lastSyncAt).toLocaleString("zh-CN") : "—"}</span></footer></article>)}
          </div>
          <Panel description="最新日期、缺失、重复、OHLC、零成交量和公司行动均来自 SQL Server" title="标的数据质量">
            <div className="table-scroll"><table className="data-table v15-wide-table"><thead><tr><th>标的</th><th>数据源</th><th>最新行情</th><th>缺失日</th><th>重复</th><th>异常 OHLC</th><th>零成交量</th><th>拆分</th><th>股息</th><th>策略运行</th><th>问题</th></tr></thead><tbody>{latestReports.map((report) => <tr key={report.id}><td><b>{report.symbol}</b></td><td>{report.provider.code}</td><td>{report.latestTradeDate?.slice(0, 10) ?? "—"}</td><td>{report.missingDayCount}</td><td>{report.duplicateCount}</td><td>{report.invalidOhlcCount}</td><td>{report.zeroVolumeCount}</td><td>{report.splitEventCount}</td><td>{report.dividendEventCount}</td><td>{report.allowStrategyRun ? <span className="v15-gate is-pass"><CheckCircle2 size={13} />允许</span> : <span className="v15-gate is-block"><ShieldX size={13} />阻止</span>}</td><td>{report.issues.issues.length ? <span className="v15-issues"><TriangleAlert size={13} />{report.issues.issues.join("；")}</span> : "无异常"}</td></tr>)}</tbody></table></div>
            {latestReports.length === 0 ? <div className="empty-state">尚无真实质量报告，请运行一次检查</div> : null}
          </Panel>
          <Panel description="失败原因不会被吞掉；Provider 超时不会写入半截数据" title="最近同步任务">
            <div className="v15-compact-list">{data.syncJobs.map((job) => <article key={job.id}><em className={`quant-status quant-status--${job.status.toLowerCase()}`}>{job.status}</em><b>{job.provider.code}</b><span>{new Date(job.createdAt).toLocaleString("zh-CN")}</span><small>{job.errorMessage ?? "同步事务完整"}</small></article>)}</div>
          </Panel>
        </>
      ) : null}
    </>
  );
}
