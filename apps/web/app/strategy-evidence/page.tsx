"use client";

import { CheckCircle2, DatabaseZap, LoaderCircle, RefreshCcw, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { fetchWithFallback, postJson } from "@/lib/api-client";
import type { StrategyEvidenceDashboard } from "@/lib/quant-types";

const metricLabels: Record<string, string> = {
  DAYS_TO_COVER: "回补天数",
  FINANCIAL_CONDITIONS_Z: "融资条件 Z 分数",
  FUNDAMENTAL_GROWTH_SCORE: "基本面增长分",
  ORDER_BOOK_IMBALANCE: "盘口买卖量不平衡",
  SHORT_INTEREST_PERCENT: "空头持仓比例",
  EFFECTIVE_FED_FUNDS_RATE: "联邦基金有效利率",
  FED_BROAD_DOLLAR_INDEX: "美联储广义美元指数",
  CBOE_VIX_CLOSE: "Cboe VIX 收盘指数",
};

export default function StrategyEvidencePage() {
  const [symbol, setSymbol] = useState("QQQM");
  const [dashboard, setDashboard] = useState<StrategyEvidenceDashboard | null>(null);
  const [cik, setCik] = useState("");
  const [contractId, setContractId] = useState("");
  const [shortInterest, setShortInterest] = useState("");
  const [daysToCover, setDaysToCover] = useState("");
  const [sourceUrl, setSourceUrl] = useState("https://www.finra.org/finra-data/browse-catalog/equity-short-interest/data");
  const [observedAt, setObservedAt] = useState(new Date().toISOString().slice(0, 10));
  const [availableAt, setAvailableAt] = useState(new Date().toISOString().slice(0, 10));
  const [macroObservationStart, setMacroObservationStart] = useState(() => {
    const start = new Date();
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    return start.toISOString().slice(0, 10);
  });
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const result = await fetchWithFallback<StrategyEvidenceDashboard | null>(
      `/strategy-evidence/dashboard?symbol=${encodeURIComponent(symbol)}`,
      null,
    );
    setDashboard(result.data);
  }, [symbol]);

  useEffect(() => {
    let active = true;
    void fetchWithFallback<StrategyEvidenceDashboard | null>(
      `/strategy-evidence/dashboard?symbol=${encodeURIComponent(symbol)}`,
      null,
    ).then((result) => { if (active) setDashboard(result.data); });
    return () => { active = false; };
  }, [symbol]);

  async function run(action: string, request: () => Promise<unknown>) {
    setBusy(action);
    setMessage("");
    try {
      await request();
      setMessage("官方数据已按 availableAt 写入；研究因子不会自动生成交易信号。");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "同步失败");
    } finally {
      setBusy("");
    }
  }

  function importShortInterest() {
    const common = {
      availableAt: `${availableAt}T00:00:00.000Z`,
      observedAt: `${observedAt}T00:00:00.000Z`,
      providerCode: "OFFICIAL_SHORT_INTEREST",
      sourceUrl,
      symbol,
    };
    return Promise.all([
      postJson("/strategy-evidence/observations", {
        ...common,
        derivation: "官方发布的空头股数除以流通股数；禁止使用短卖成交量替代",
        metricCode: "SHORT_INTEREST_PERCENT",
        unit: "percent",
        value: Number(shortInterest),
      }),
      postJson("/strategy-evidence/observations", {
        ...common,
        derivation: "官方 Short Interest / Average Daily Volume",
        metricCode: "DAYS_TO_COVER",
        unit: "days",
        value: Number(daysToCover),
      }),
    ]);
  }

  const macroFactors =
    dashboard?.latest.filter((item) => dashboard.researchOnlyMetrics.includes(item.metricCode)) ??
    [];

  return (
    <>
      <PageHeader
        description="真实财报、盘口、融资条件与空头持仓；缺失或过期时三层策略默认拒绝开仓"
        title="策略证据"
      />
      {message ? <div className="quant-message">{message}</div> : null}

      <Panel description="五项证据必须全部核验并满足时效要求" title="三层证据就绪状态">
        <div className="strategy-create-grid">
          <label><span>标的</span><input onChange={(event) => setSymbol(event.target.value.toUpperCase())} value={symbol} /></label>
          <button className="secondary-button" onClick={() => void load()} type="button"><RefreshCcw size={14} />刷新状态</button>
        </div>
        <div className={`strategy-evidence-status ${dashboard?.ready ? "ready" : "blocked"}`}>
          {dashboard?.ready ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}
          <strong>{dashboard?.ready ? "真实证据已就绪" : "真实证据未就绪，策略禁止开仓"}</strong>
          <span>{dashboard ? (dashboard.missingMetrics.length ? `缺少：${dashboard.missingMetrics.map((item) => metricLabels[item] ?? item).join("、")}` : dashboard.safeguards.note) : "API 当前不可用"}</span>
        </div>
        <div className="provider-list">
          {dashboard?.providers.map((provider) => <article key={provider.id}><span><DatabaseZap size={16} /></span><div><strong>{provider.name}</strong><small>{provider.code} · {provider.lastHealthMessage}</small></div><em className={provider.configured ? "is-success" : "is-muted"}>{provider.configured ? "已配置" : "待配置"}</em></article>)}
        </div>
      </Panel>

      <Panel description="凭据只从服务端 .env 读取，不在浏览器保存" title="官方接口同步">
        <div className="strategy-create-grid">
          <label><span>SEC CIK（普通股票）</span><input onChange={(event) => setCik(event.target.value)} placeholder="10 位 CIK" value={cik} /></label>
          <button className="primary-button" disabled={Boolean(busy) || !cik} onClick={() => void run("sec", () => postJson("/strategy-evidence/sync/sec", { cik, symbol }))} type="button">{busy === "sec" ? <LoaderCircle className="spin" size={14} /> : null}同步 SEC</button>
          <label><span>IBKR Contract ID</span><input onChange={(event) => setContractId(event.target.value)} placeholder="conid" value={contractId} /></label>
          <button className="primary-button" disabled={Boolean(busy) || !contractId} onClick={() => void run("ibkr", () => postJson("/strategy-evidence/sync/ibkr-top-of-book", { contractId, symbol }))} type="button">{busy === "ibkr" ? <LoaderCircle className="spin" size={14} /> : null}采集 IBKR 盘口</button>
          <button className="primary-button" disabled={Boolean(busy)} onClick={() => void run("fred", () => postJson("/strategy-evidence/sync/fred", { seriesId: "NFCI" }))} type="button">{busy === "fred" ? <LoaderCircle className="spin" size={14} /> : null}同步 FRED NFCI</button>
        </div>
      </Panel>

      <Panel
        description="保存官方原始值、观测日和首次可用日；不设置方向阈值，不参与三层策略就绪判断"
        title="宏观市场研究因子（不生成交易）"
      >
        <div className="provider-list">
          {macroFactors.length ? (
            macroFactors.map((factor) => (
              <article key={factor.id}>
                <span><DatabaseZap size={16} /></span>
                <div>
                  <strong>{metricLabels[factor.metricCode] ?? factor.metricCode}</strong>
                  <small>
                    观测 {factor.observedAt.slice(0, 10)} · 首次可用 {factor.availableAt.slice(0, 10)} · {factor.provider.name}
                  </small>
                </div>
                <em>{factor.value.toLocaleString()} {factor.unit ?? ""}</em>
              </article>
            ))
          ) : (
            <article>
              <span><ShieldAlert size={16} /></span>
              <div>
                <strong>尚无已核验宏观因子</strong>
                <small>可直接同步当前官方快照；配置 FRED_API_KEY 后才允许回填历史初次发布值</small>
              </div>
              <em className="is-muted">研究待同步</em>
            </article>
          )}
        </div>
        <div className="strategy-create-grid">
          <label>
            <span>同步起始日</span>
            <input
              onChange={(event) => setMacroObservationStart(event.target.value)}
              type="date"
              value={macroObservationStart}
            />
          </label>
          <button
            className="secondary-button"
            disabled={Boolean(busy)}
            onClick={() =>
              void run("fred-macro", () =>
                postJson("/strategy-evidence/sync/fred-market-factors", {
                  observationStart: macroObservationStart,
                }),
              )
            }
            type="button"
          >
            {busy === "fred-macro" ? <LoaderCircle className="spin" size={14} /> : null}
            同步三项官方因子
          </button>
        </div>
        <div className="strategy-evidence-status blocked">
          <ShieldAlert size={18} />
          <strong>研究观察专用</strong>
          <span>利率、美元或 VIX 的高低本身不等于买入或卖出；必须先完成独立样本外验证。</span>
        </div>
      </Panel>

      <Panel description="只接受 FINRA 或挂牌交易所官方页面；日短卖成交量不能替代空头持仓" title="导入官方空头持仓">
        <div className="strategy-create-grid">
          <label><span>空头持仓比例（%）</span><input onChange={(event) => setShortInterest(event.target.value)} type="number" value={shortInterest} /></label>
          <label><span>回补天数</span><input onChange={(event) => setDaysToCover(event.target.value)} type="number" value={daysToCover} /></label>
          <label><span>结算日期</span><input onChange={(event) => setObservedAt(event.target.value)} type="date" value={observedAt} /></label>
          <label><span>公开日期</span><input onChange={(event) => setAvailableAt(event.target.value)} type="date" value={availableAt} /></label>
          <label><span>官方来源 URL</span><input onChange={(event) => setSourceUrl(event.target.value)} value={sourceUrl} /></label>
          <button className="primary-button" disabled={Boolean(busy) || !shortInterest || !daysToCover} onClick={() => void run("short", importShortInterest)} type="button">{busy === "short" ? <LoaderCircle className="spin" size={14} /> : null}核验并导入</button>
        </div>
      </Panel>
    </>
  );
}
