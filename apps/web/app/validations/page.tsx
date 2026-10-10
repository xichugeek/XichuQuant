"use client";

import {
  CheckCircle2,
  LoaderCircle,
  Play,
  ServerCrash,
  ShieldX,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { ValidationCharts } from "@/components/validation-charts";
import { fetchWithFallback, postJson, type DataSource } from "@/lib/api-client";

type Strategy = {
  id: string;
  name: string;
  code: string;
  strategyType: string;
  approvalStatus: string;
};

type ValidationListItem = {
  id: string;
  status: string;
  recommendation: string | null;
  robustnessScore: number | null;
  createdAt: string;
  strategy: Strategy;
  inSampleMetrics: Metrics | null;
  outSampleMetrics: Metrics | null;
  warnings: Array<{ code: string; level: string; message: string }>;
};

type Metrics = {
  totalReturn?: number;
  maxDrawdown?: number;
  sharpeRatio?: number;
  executionCount?: number;
  profitFactor?: number | null;
  expectancyPerTrade?: number | null;
  expectancyR?: number | null;
  breakEvenWinRate?: number | null;
  historicalVaR95?: number | null;
  expectedShortfall95?: number | null;
  worstDailyReturn?: number | null;
};

type ValidationDetail = ValidationListItem & {
  symbols: string[];
  approvalCriteria: Record<string, boolean>;
  regimeMetrics: Record<string, { days?: number; totalReturn?: number; maxDrawdown?: number }>;
  crossSymbolMetrics: Record<string, Metrics>;
  approvals: Array<{ id: string; status: string; decidedAt: string; reasons: string[] }>;
  windows: Array<{
    sequence: number;
    trainStart: string;
    trainEnd: string;
    testStart: string;
    testEnd: string;
    totalReturn: number | null;
    maxDrawdown: number | null;
    sharpeRatio: number | null;
    tradeCount: number;
  }>;
  parameterSweeps: Array<{
    summary: { candidateCount?: number; stableRegionCount?: number; singlePeak?: boolean };
    results: Array<{
      parameterKey: string;
      totalReturn: number;
      maxDrawdown: number;
      stabilityScore: number | null;
      flags: string[];
    }>;
  }>;
  stressTests: Array<{
    summary: {
      invalidated?: boolean;
      failedScenarioCount?: number;
      worstReturnDegradation?: number;
    };
    results: Array<{
      scenarioCode: string;
      returnDegradation: number;
      failed: boolean;
      totalReturn: number;
      maxDrawdown: number;
    }>;
  }>;
};

const pct = (value?: number | null) =>
  value === null || value === undefined ? "—" : `${value.toFixed(2)}%`;
const money = (value?: number | null) =>
  value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

export default function StrategyValidationsPage() {
  const [source, setSource] = useState<DataSource>("mock");
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [runs, setRuns] = useState<ValidationListItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<ValidationDetail | null>(null);
  const [strategyId, setStrategyId] = useState("");
  const [symbol, setSymbol] = useState("AAPL");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async (preferredId?: string) => {
    setLoading(true);
    const [strategyResult, runResult] = await Promise.all([
      fetchWithFallback<Strategy[]>("/strategies", []),
      fetchWithFallback<ValidationListItem[]>("/strategy-validations", []),
    ]);
    setSource(strategyResult.source === "api" && runResult.source === "api" ? "api" : "mock");
    setStrategies(strategyResult.data);
    setRuns(runResult.data);
    setStrategyId((current) => current || strategyResult.data[0]?.id || "");
    const nextId =
      preferredId || runResult.data.find((item) => item.status === "COMPLETED")?.id || "";
    setSelectedId(nextId);
    if (nextId) {
      const detailResult = await fetchWithFallback<ValidationDetail | null>(
        `/strategy-validations/${nextId}`,
        null,
      );
      setDetail(detailResult.data);
      if (detailResult.source !== "api") setSource("mock");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function runValidation() {
    setBusy(true);
    setMessage("");
    try {
      const result = await postJson<ValidationDetail>("/strategy-validations/run", {
        strategyId,
        symbol,
        crossSymbols: ["QQQM", "MUU"],
        inSampleRatio: 0.7,
        minimumOutOfSampleTrades: 20,
        walkForward: { anchored: true, maxWindows: 6, testMonths: 6, trainMonths: 18 },
      });
      setMessage("稳健性验证已完成并保存到 SQL Server。 ");
      await refresh(result.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "策略验证失败");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!detail) return;
    setBusy(true);
    try {
      const result = await postJson<{ approved: boolean; reasons: string[] }>(
        `/strategy-validations/${detail.id}/approval`,
        { userConfirmed: true },
      );
      setMessage(
        result.approved ? "人工审批通过：策略可以部署到独立模拟账户。" : result.reasons.join("；"),
      );
      await refresh(detail.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "审批失败");
    } finally {
      setBusy(false);
    }
  }

  const charts = useMemo(
    () => ({
      parameterResults: detail?.parameterSweeps[0]?.results ?? [],
      stressResults: detail?.stressTests[0]?.results ?? [],
      windows: detail?.windows ?? [],
    }),
    [detail],
  );

  return (
    <>
      <PageHeader
        description="按时间顺序验证样本内/外、Walk-forward、参数稳定性、压力场景和跨标的表现；验证结果不修改真实账户"
        title="策略稳健性验证"
      />
      {source === "mock" ? (
        <div className="service-error">
          <ServerCrash size={18} />
          策略验证 API 或 quant-engine 不可用；系统不会伪造验证结果。
        </div>
      ) : null}
      <Panel
        description="默认 70% 样本内、30% 样本外；训练窗口仅使用当时可见数据"
        title="新建验证任务"
      >
        <div className="validation-run-form">
          <label>
            <span>策略</span>
            <select value={strategyId} onChange={(event) => setStrategyId(event.target.value)}>
              {strategies.map((strategy) => (
                <option value={strategy.id} key={strategy.id}>
                  {strategy.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>主标的</span>
            <input
              value={symbol}
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
            />
          </label>
          <label>
            <span>跨标的验证</span>
            <input readOnly value="QQQM, MUU" />
          </label>
          <button
            className="primary-button"
            disabled={busy || source !== "api" || !strategyId}
            onClick={() => void runValidation()}
            type="button"
          >
            {busy ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}运行完整验证
          </button>
        </div>
        {message ? <p className="quant-message">{message}</p> : null}
      </Panel>

      <div className="validation-layout">
        <Panel description={`${runs.length} 个可追溯任务`} title="验证历史">
          <div className="validation-run-list">
            {runs.map((run) => (
              <button
                className={run.id === selectedId ? "is-active" : ""}
                key={run.id}
                onClick={() => void refresh(run.id)}
                type="button"
              >
                <span>
                  <strong>{run.strategy.name}</strong>
                  <small>{new Date(run.createdAt).toLocaleString("zh-CN")}</small>
                </span>
                <em className={`quant-status quant-status--${run.status.toLowerCase()}`}>
                  {run.status}
                </em>
                <b>{run.robustnessScore ?? 0}</b>
              </button>
            ))}
          </div>
        </Panel>
        <div className="validation-main">
          {loading && !detail ? (
            <div className="detail-loading">
              <LoaderCircle className="spin" size={22} />
              正在读取验证任务、窗口和压力结果…
            </div>
          ) : !detail ? (
            <div className="empty-state">尚未选择真实验证结果</div>
          ) : (
            <>
              <div className="validation-kpis">
                <article>
                  <span>稳健性评分</span>
                  <strong>{detail.robustnessScore ?? 0}</strong>
                  <small>{detail.recommendation}</small>
                </article>
                <article>
                  <span>样本内收益</span>
                  <strong>{pct(detail.inSampleMetrics?.totalReturn)}</strong>
                  <small>回撤 {pct(detail.inSampleMetrics?.maxDrawdown)}</small>
                </article>
                <article>
                  <span>样本外收益</span>
                  <strong
                    className={
                      (detail.outSampleMetrics?.totalReturn ?? 0) < 0 ? "is-danger" : "is-success"
                    }
                  >
                    {pct(detail.outSampleMetrics?.totalReturn)}
                  </strong>
                  <small>回撤 {pct(detail.outSampleMetrics?.maxDrawdown)}</small>
                </article>
                <article>
                  <span>样本外交易</span>
                  <strong>{detail.outSampleMetrics?.executionCount ?? 0}</strong>
                  <small>不得只看收益率</small>
                </article>
                <article>
                  <span>样本外净期望</span>
                  <strong
                    className={
                      (detail.outSampleMetrics?.expectancyPerTrade ?? 0) <= 0
                        ? "is-danger"
                        : "is-success"
                    }
                  >
                    {money(detail.outSampleMetrics?.expectancyPerTrade)}
                  </strong>
                  <small>
                    {detail.outSampleMetrics?.expectancyR?.toFixed(2) ?? "—"} R · 盈亏平衡{" "}
                    {pct(detail.outSampleMetrics?.breakEvenWinRate)}
                  </small>
                </article>
                <article>
                  <span>样本外左尾风险</span>
                  <strong className="is-danger">
                    {pct(detail.outSampleMetrics?.expectedShortfall95)}
                  </strong>
                  <small>
                    VaR {pct(detail.outSampleMetrics?.historicalVaR95)} · 最差日 {pct(detail.outSampleMetrics?.worstDailyReturn)}
                  </small>
                </article>
                <article>
                  <span>压力失败</span>
                  <strong
                    className={
                      (detail.stressTests[0]?.summary.failedScenarioCount ?? 0) > 0
                        ? "is-danger"
                        : "is-success"
                    }
                  >
                    {detail.stressTests[0]?.summary.failedScenarioCount ?? 0}
                  </strong>
                  <small>共 {detail.stressTests[0]?.results.length ?? 0} 类场景</small>
                </article>
                <article>
                  <span>审批状态</span>
                  <strong>{detail.strategy.approvalStatus}</strong>
                  <small>{detail.approvals[0]?.status ?? "待人工确认"}</small>
                </article>
              </div>
              <div className="validation-warning-panel">
                <div>
                  {detail.warnings.length === 0 ? (
                    <p>
                      <CheckCircle2 size={17} />
                      未发现自动警告
                    </p>
                  ) : (
                    detail.warnings.map((warning) => (
                      <p key={warning.code}>
                        <TriangleAlert size={17} />
                        <span>
                          <b>{warning.code}</b>
                          {warning.message}
                        </span>
                      </p>
                    ))
                  )}
                </div>
                <button
                  className="primary-button"
                  disabled={
                    busy ||
                    detail.status !== "COMPLETED" ||
                    detail.approvals.some((item) => item.status === "APPROVED")
                  }
                  onClick={() => void approve()}
                  type="button"
                >
                  <CheckCircle2 size={16} />
                  人工确认审批
                </button>
              </div>
              <ValidationCharts data={charts} />
              <div className="validation-detail-grid">
                <Panel description="每窗训练结束后，才允许验证下一段数据" title="Walk-forward 窗口">
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>窗口</th>
                          <th>训练区间</th>
                          <th>验证区间</th>
                          <th>收益</th>
                          <th>回撤</th>
                          <th>交易</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.windows.map((window) => (
                          <tr key={window.sequence}>
                            <td>W{window.sequence}</td>
                            <td>
                              {window.trainStart.slice(0, 10)} → {window.trainEnd.slice(0, 10)}
                            </td>
                            <td>
                              {window.testStart.slice(0, 10)} → {window.testEnd.slice(0, 10)}
                            </td>
                            <td>{pct(window.totalReturn)}</td>
                            <td className="is-danger">{pct(window.maxDrawdown)}</td>
                            <td>{window.tradeCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
                <Panel description="同一参数在不同市场环境和标的上的表现" title="行情状态与跨标的">
                  <div className="regime-grid">
                    {Object.entries(detail.regimeMetrics).map(([name, item]) => (
                      <article key={name}>
                        <span>{name}</span>
                        <strong>{pct(item.totalReturn)}</strong>
                        <small>
                          {item.days ?? 0} 日 · DD {pct(item.maxDrawdown)}
                        </small>
                      </article>
                    ))}
                  </div>
                  <div className="cross-symbol-list">
                    {Object.entries(detail.crossSymbolMetrics).map(([name, item]) => (
                      <p key={name}>
                        <b>{name}</b>
                        <span>收益 {pct(item.totalReturn)}</span>
                        <span>回撤 {pct(item.maxDrawdown)}</span>
                        <span>Sharpe {item.sharpeRatio?.toFixed(2) ?? "—"}</span>
                      </p>
                    ))}
                  </div>
                </Panel>
              </div>
              {detail.recommendation === "REJECT" ? (
                <div className="validation-reject">
                  <ShieldX size={19} />
                  <span>
                    <b>策略不得进入模拟交易</b>
                    验证、压力或样本外条件未通过，必须修改策略后重新回测和验证。
                  </span>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </>
  );
}
