"use client";

import { AlertTriangle, CheckCircle2, Database, FileUp, LoaderCircle, ServerCrash } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { fetchWithFallback, postJson, type DataSource } from "@/lib/api-client";
import type { MarketDataSummary, MarketImportPreview } from "@/lib/quant-types";

const emptySummary: MarketDataSummary = { providers: [], series: [], importBatches: [], syncJobs: [] };

export default function MarketDataPage() {
  const [summary, setSummary] = useState(emptySummary);
  const [source, setSource] = useState<DataSource>("mock");
  const [file, setFile] = useState<File | null>(null);
  const [symbol, setSymbol] = useState("");
  const [preview, setPreview] = useState<MarketImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const result = await fetchWithFallback("/market-data/summary", emptySummary);
    setSummary(result.data);
    setSource(result.source);
  }, []);

  useEffect(() => {
    let active = true;
    void fetchWithFallback<MarketDataSummary>("/market-data/summary", emptySummary).then((result) => {
      if (!active) return;
      setSummary(result.data);
      setSource(result.source);
    });
    return () => { active = false; };
  }, []);

  async function previewFile() {
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await postJson<MarketImportPreview>("/market-data/imports/preview", {
        fileName: file.name,
        content: await file.text(),
        symbol: symbol.trim() || undefined,
        providerCode: "CSV_IMPORT",
      });
      setPreview(result);
      setMessage("解析完成。请核对映射、异常和重复记录后再确认写库。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "行情解析失败");
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (!preview) return;
    setBusy(true);
    try {
      const result = await postJson<MarketImportPreview>(
        `/market-data/imports/${preview.id}/confirm`,
      );
      setPreview(result);
      setMessage(`已写入 ${result.importedRecords} 条日线；异常和重复记录未写入。`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "行情导入失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        action={<span className={`service-pill service-pill--${source}`}>{source === "api" ? "SQL Server 行情在线" : "行情 API 不可用"}</span>}
        description="日线数据统一入库、质量检查和 Provider 管理；不包含分钟级或高频行情"
        title="行情数据中心"
      />
      {source === "mock" ? (
        <div className="service-error"><ServerCrash size={18} />行情 API 当前不可用。页面不会伪造行情或回测结果，现有风控页面仍可使用。</div>
      ) : null}

      <div className="quant-stat-grid">
        <article><span>行情序列</span><strong>{summary.series.length}</strong><small>symbol + source</small></article>
        <article><span>日线总记录</span><strong>{summary.series.reduce((sum, item) => sum + item.count, 0).toLocaleString()}</strong><small>唯一键防重复</small></article>
        <article><span>可用 Provider</span><strong>{summary.providers.filter((item) => item.enabled).length}</strong><small>CSV / Seed</small></article>
        <article><span>数据粒度</span><strong>1D</strong><small>V1.3 仅日线</small></article>
      </div>

      <div className="quant-two-column">
        <Panel description="先解析预览，确认后才以事务写入 SQL Server" title="CSV 历史行情导入">
          <div className="quant-form">
            <label><span>行情 CSV 文件</span><input accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} type="file" /></label>
            <label><span>缺少 Symbol 列时指定代码</span><input onChange={(event) => setSymbol(event.target.value.toUpperCase())} placeholder="例如 AAPL" value={symbol} /></label>
            <button className="primary-button" disabled={!file || busy || source !== "api"} onClick={() => void previewFile()} type="button">
              {busy ? <LoaderCircle className="spin" size={15} /> : <FileUp size={15} />}解析并预览
            </button>
          </div>
          {message ? <p className="quant-message">{message}</p> : null}
        </Panel>
        <Panel description="具体数据源逻辑由 Provider 适配层隔离" title="行情 Provider">
          <div className="provider-list">
            {summary.providers.map((provider) => (
              <article key={provider.id}>
                <Database size={17} /><span><strong>{provider.name}</strong><small>{provider.code} · {provider.providerType}</small></span>
                <em className={provider.enabled ? "is-success" : "is-muted"}>{provider.enabled ? "已启用" : "预留"}</em>
              </article>
            ))}
          </div>
        </Panel>
      </div>

      {preview ? (
        <Panel
          description={`${preview.startDate?.slice(0, 10) ?? "-"} 至 ${preview.endDate?.slice(0, 10) ?? "-"} · 工作日缺口 ${preview.missingDays.length} 个（不自动用未来价格填补）`}
          title={`导入预览 · ${preview.fileName}`}
          trailing={<button className="primary-button" disabled={busy || preview.validRecords === 0 || preview.status !== "PREVIEW"} onClick={() => void confirmImport()} type="button"><CheckCircle2 size={15} />确认写库</button>}
        >
          <div className="import-stat-grid market-import-stats">
            <article><span>总记录</span><strong>{preview.totalRecords}</strong></article>
            <article className="is-success"><span>有效</span><strong>{preview.validRecords}</strong></article>
            <article className="is-warning"><span>待确认</span><strong>{preview.pendingRecords}</strong></article>
            <article><span>重复</span><strong>{preview.duplicateRecords}</strong></article>
            <article><span>已导入</span><strong>{preview.importedRecords}</strong></article>
            <article><span>状态</span><strong className="import-stat-date">{preview.status}</strong></article>
          </div>
          <div className="table-scroll quant-table-scroll">
            <table className="data-table">
              <thead><tr><th>行</th><th>状态</th><th>代码</th><th>日期</th><th>开/高/低/收</th><th>股息</th><th>拆分</th><th>校验结果</th></tr></thead>
              <tbody>
                {preview.records.slice(0, 200).map((record) => {
                  const row = record.normalized ?? {};
                  return <tr key={record.id}>
                    <td>{record.sourceRow}</td><td><span className={`quant-status quant-status--${record.status.toLowerCase()}`}>{record.status}</span></td>
                    <td>{record.symbol ?? "-"}</td><td>{record.tradeDate?.slice(0, 10) ?? "-"}</td>
                    <td className="mono-cell">{String(row.open ?? "-")} / {String(row.high ?? "-")} / {String(row.low ?? "-")} / {String(row.close ?? "-")}</td>
                    <td>{String(row.dividend ?? 0)}</td><td>{String(row.splitFactor ?? 1)}</td>
                    <td className={record.errors.length ? "warning-cell" : "success-cell"}>{record.errors.length ? <><AlertTriangle size={13} />{record.errors.join("；")}</> : "通过"}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      <Panel description="系统 Seed 覆盖超过三年；CSV 与 Seed 使用相同统一字段" title="可用日线序列">
        <div className="table-scroll quant-table-scroll"><table className="data-table"><thead><tr><th>代码</th><th>来源</th><th>开始日期</th><th>结束日期</th><th>记录数</th><th>质量状态</th></tr></thead><tbody>
          {summary.series.map((series) => <tr key={`${series.symbol}-${series.source}`}><td className="symbol-cell">{series.symbol}</td><td>{series.source}</td><td>{series.startDate}</td><td>{series.endDate}</td><td>{series.count.toLocaleString()}</td><td className="success-cell">唯一键已校验</td></tr>)}
        </tbody></table></div>
      </Panel>
    </>
  );
}
