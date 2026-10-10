"use client";

import { Braces, CheckCircle2, FlaskConical, LoaderCircle, Plus, ServerCrash } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { fetchWithFallback, postJson, type DataSource } from "@/lib/api-client";
import type { StrategyEvidenceDashboard, StrategyView } from "@/lib/quant-types";

const strategyNames = {
  BuyAndHold: "买入并持有",
  MovingAverageCross: "均线交叉",
  RsiMeanReversion: "RSI 均值回归",
  TimeSeriesMomentum: "时间序列动量（开源研究候选）",
  FundamentalLiquidityCrowding: "基本面·流动性·拥挤三层防线",
};

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState<StrategyView[]>([]);
  const [source, setSource] = useState<DataSource>("mock");
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<StrategyView["strategyType"]>("TimeSeriesMomentum");
  const [name, setName] = useState("自定义时间序列动量策略");
  const [code, setCode] = useState("CUSTOM_TSMOM");
  const [symbol, setSymbol] = useState("QQQ");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [evidenceBySymbol, setEvidenceBySymbol] = useState<
    Record<string, StrategyEvidenceDashboard>
  >({});

  const defaults = useMemo(() => {
    if (type === "BuyAndHold")
      return {
        positionPercent: 90,
        stopLossCondition: "回撤达到计划阈值",
        exitCondition: "研究期结束",
      };
    if (type === "TimeSeriesMomentum")
      return {
        lookbackDays: 120,
        positionPercent: 100,
        stopLossCondition: "动量状态转为非正",
        exitCondition: "回看期收益由正转为非正",
      };
    if (type === "FundamentalLiquidityCrowding")
      return {
        trendPeriod: 120,
        trendSlopeLookback: 20,
        liquidityPeriod: 20,
        minimumDollarVolumeRatio: 0.5,
        maximumIlliquidityMultiple: 3,
        crowdingPeriod: 20,
        maximumCrowdingZScore: 2.5,
        crowdingVolumeMultiple: 1.5,
        dataMode: "REQUIRE_VERIFIED_REAL",
        minimumFundamentalGrowthScore: 0,
        minimumOrderBookImbalance: -0.35,
        maximumFinancialConditionsZ: 1,
        maximumShortInterestPercent: 30,
        maximumDaysToCover: 7,
        fundamentalMaxAgeDays: 140,
        orderBookMaxAgeDays: 1,
        financingMaxAgeDays: 30,
        shortInterestMaxAgeDays: 30,
        positionPercent: 70,
        stopLossCondition: "任一真实证据过期、缺失或越过风险阈值",
        exitCondition: "基本面、盘口、融资条件或空头拥挤任一层失效",
      };
    return {
      positionPercent: 90,
      stopLossCondition: "回撤达到计划阈值",
      exitCondition: "研究期结束",
    };
  }, [type]);

  const fetchPageData = useCallback(async () => {
    const result = await fetchWithFallback<StrategyView[]>("/strategies", []);
    const symbols = [
      ...new Set(
        result.data
          .filter((item) => item.strategyType === "FundamentalLiquidityCrowding")
          .flatMap((item) => item.symbolUniverse),
      ),
    ];
    const dashboards = await Promise.all(
      symbols.map(async (item) => {
        const response = await fetchWithFallback<StrategyEvidenceDashboard | null>(
          `/strategy-evidence/dashboard?symbol=${encodeURIComponent(item)}`,
          null,
        );
        return [item, response.data] as const;
      }),
    );
    const validDashboards = dashboards.filter(
      (item): item is readonly [string, StrategyEvidenceDashboard] => item[1] !== null,
    );
    return { evidence: Object.fromEntries(validDashboards), strategies: result };
  }, []);
  const refresh = useCallback(async () => {
    const result = await fetchPageData();
    setStrategies(result.strategies.data);
    setSource(result.strategies.source);
    setEvidenceBySymbol(result.evidence);
  }, [fetchPageData]);
  useEffect(() => {
    let active = true;
    void fetchPageData().then((result) => {
      if (!active) return;
      setStrategies(result.strategies.data);
      setSource(result.strategies.source);
      setEvidenceBySymbol(result.evidence);
    });
    return () => {
      active = false;
    };
  }, [fetchPageData]);

  async function createStrategy() {
    setBusy(true);
    setMessage("");
    try {
      await postJson("/strategies", {
        name,
        code,
        description: "由策略管理页面创建；只保存结构化参数，不执行任意 Python 代码。",
        strategyType: type,
        symbolUniverse: [symbol],
        timeframe: "1D",
        parameters: defaults,
        initialCapital: 100000,
        commissionRate: 0.001,
        slippageRate: 0.0005,
        positionSizingMode: "PERCENT_OF_EQUITY",
        maxPositionPercent: Number(defaults.positionPercent),
        enabled: true,
      });
      setMessage("策略已通过 quant-engine 的 Pydantic 校验并保存。 ");
      setShowForm(false);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "策略保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        action={
          <button
            className="primary-button"
            disabled={source !== "api"}
            onClick={() => setShowForm((value) => !value)}
            type="button"
          >
            <Plus size={15} />
            新建策略
          </button>
        }
        description="结构化参数、严格版本和标的池管理；数据库中不保存或执行任意 Python 代码"
        title="量化策略管理"
      />
      {source === "mock" ? (
        <div className="service-error">
          <ServerCrash size={18} />
          策略 API 或 quant-engine 当前不可用，未显示伪造策略结果。
        </div>
      ) : null}
      {message ? <div className="quant-message">{message}</div> : null}
      {showForm ? (
        <Panel
          description="保存前由 POST /strategies/validate 进行严格参数校验"
          title="新建结构化策略"
        >
          <div className="strategy-create-grid">
            <label>
              <span>策略类型</span>
              <select
                onChange={(event) => setType(event.target.value as StrategyView["strategyType"])}
                value={type}
              >
                <option value="BuyAndHold">BuyAndHold</option>
                <option value="TimeSeriesMomentum">TimeSeriesMomentum</option>
                <option value="FundamentalLiquidityCrowding">FundamentalLiquidityCrowding</option>
              </select>
            </label>
            <label>
              <span>名称</span>
              <input onChange={(event) => setName(event.target.value)} value={name} />
            </label>
            <label>
              <span>策略代码</span>
              <input onChange={(event) => setCode(event.target.value.toUpperCase())} value={code} />
            </label>
            <label>
              <span>标的池（V1.3 单标的）</span>
              <input
                onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                value={symbol}
              />
            </label>
            <label className="strategy-params-preview">
              <span>结构化参数预览</span>
              <pre>{JSON.stringify(defaults, null, 2)}</pre>
            </label>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void createStrategy()}
              type="button"
            >
              {busy ? <LoaderCircle className="spin" size={15} /> : <CheckCircle2 size={15} />}
              校验并保存
            </button>
          </div>
        </Panel>
      ) : null}

      <div className="strategy-grid">
        {strategies.map((strategy) => (
          <article className="strategy-card" key={strategy.id}>
            <header>
              <span>
                <FlaskConical size={18} />
              </span>
              <div>
                <strong>{strategy.name}</strong>
                <small>
                  {strategy.code} · v{strategy.version}
                </small>
              </div>
              <em>{strategy.enabled ? "启用" : "停用"}</em>
            </header>
            <p>{strategy.description}</p>
            <div className="strategy-type-row">
              <b>{strategyNames[strategy.strategyType]}</b>
              <span>{strategy.timeframe}</span>
              <span>{strategy.symbolUniverse.join(" / ")}</span>
            </div>
            <pre>{JSON.stringify(strategy.parameters, null, 2)}</pre>
            {strategy.strategyType === "TimeSeriesMomentum" ? (
              <div className="strategy-evidence-status">
                <strong>开源研究候选，未证明跑赢 Buy &amp; Hold</strong>
                <span>固定回看期收益转正时持有，转为非正时退出；信号后下一交易日开盘成交。</span>
                <small>独立适配自 MIT 许可实现；不复制外部运行时，也不自动获准进入 Paper。</small>
                <a
                  href="https://github.com/bonnie-mcconnell/backtesting-engine"
                  rel="noreferrer"
                  target="_blank"
                >
                  查看 MIT 开源实现
                </a>
                <a
                  href="https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2089463"
                  rel="noreferrer"
                  target="_blank"
                >
                  查看时间序列动量论文
                </a>
              </div>
            ) : null}
            {strategy.strategyType === "FundamentalLiquidityCrowding"
              ? (() => {
                  const evidence = evidenceBySymbol[strategy.symbolUniverse[0] ?? ""];
                  return (
                    <div
                      className={`strategy-evidence-status ${evidence?.ready ? "ready" : "blocked"}`}
                    >
                      <strong>
                        {evidence?.ready ? "真实证据已就绪" : "真实证据未就绪，禁止开仓"}
                      </strong>
                      <span>
                        {evidence
                          ? evidence.ready
                            ? evidence.safeguards.note
                            : `缺少：${evidence.missingMetrics.join("、")}`
                          : "正在读取证据状态"}
                      </span>
                      <small>SEC 财报 · IBKR 盘口 · FRED 融资条件 · FINRA/挂牌交易所空头持仓</small>
                      <a
                        href={`/strategy-evidence?symbol=${encodeURIComponent(strategy.symbolUniverse[0] ?? "QQQM")}`}
                      >
                        管理真实证据
                      </a>
                      <a
                        href="https://www.youtube.com/watch?v=Mtbfh5XA6D0"
                        rel="noreferrer"
                        target="_blank"
                      >
                        查看视频依据
                      </a>
                    </div>
                  );
                })()
              : null}
            <footer>
              <span>
                本金 <b>${strategy.initialCapital.toLocaleString()}</b>
              </span>
              <span>
                佣金 <b>{(strategy.commissionRate * 100).toFixed(3)}%</b>
              </span>
              <span>
                滑点 <b>{(strategy.slippageRate * 100).toFixed(3)}%</b>
              </span>
            </footer>
            <div className="strategy-counts">
              <Braces size={14} />
              严格参数 · 回测 {strategy._count?.backtestRuns ?? 0} · 信号{" "}
              {strategy._count?.signals ?? 0}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
