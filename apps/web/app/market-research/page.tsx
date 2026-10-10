"use client";

import {
  Ban,
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  LoaderCircle,
  RefreshCw,
  ServerCrash,
  ShieldAlert,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { getJson, postJson } from "@/lib/api-client";
import type {
  MarketResearchDashboard,
  MarketResearchFactor,
  MarketResearchSource,
} from "@/lib/market-research-types";

const regimeLabels: Record<string, string> = {
  RISK_ON: "风险偏好",
  RISK_ON_CROWDED: "风险偏好但交易拥挤",
  RISK_OFF: "风险规避",
  RISK_OFF_STRESSED: "风险规避且压力较高",
  DIRECTIONAL_UNCLEAR_HIGH_TAIL_RISK: "方向不清但尾部风险偏高",
  NEUTRAL: "中性",
};

const verificationLabels: Record<string, string> = {
  VERIFIED: "已核验",
  PARTIAL: "部分核验",
  UNVERIFIED: "未核验",
  STALE: "已过期",
};

const freshnessLabels: Record<string, string> = {
  CURRENT: "当前",
  LAGGED: "滞后",
  HISTORICAL: "历史",
  STALE: "陈旧",
  UNVERIFIED: "未确认",
};

type FactorRow = { factor: MarketResearchFactor; source: MarketResearchSource };

function formatFactorValue(factor: MarketResearchFactor) {
  if (factor.value === null) return "定性";
  if (factor.unit === "BOOLEAN") return factor.value === 1 ? "是" : "否";
  if (factor.unit === "PERCENT") return `${factor.value}%`;
  if (factor.unit === "PERCENTAGE_POINTS") return `${factor.value} 个百分点`;
  if (factor.unit === "X") return `${factor.value} 倍`;
  if (factor.unit?.startsWith("POINTS")) return `${factor.value.toLocaleString("zh-CN")} 点`;
  return `${factor.value}${factor.unit ? ` ${factor.unit}` : ""}`;
}

function formatTimestamp(seconds: number | null) {
  if (seconds === null) return "—";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function MarketResearchPage() {
  const [data, setData] = useState<MarketResearchDashboard | null>(null);
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [horizonDays, setHorizonDays] = useState(20);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await getJson<MarketResearchDashboard>("/market-research/dashboard"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "市场研究 API 不可用");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const factorRows = useMemo<FactorRow[]>(
    () =>
      (data?.sources ?? []).flatMap((source) =>
        source.factors.map((factor) => ({ factor, source })),
      ),
    [data],
  );

  async function createSnapshot() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await postJson("/market-research/evaluate", { target: "NDX", asOfDate, horizonDays });
      setMessage("研究快照已保存；样本不足，因此没有生成涨跌概率、交易信号或订单。 ");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "研究快照生成失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        action={
          <button
            className="secondary-button"
            disabled={loading}
            onClick={() => void refresh()}
            type="button"
          >
            <RefreshCw className={loading ? "spin" : ""} size={16} />
            刷新
          </button>
        }
        description="视频观点拆解 · 官方数据核验 · 时效降权 · 市场状态研究（不直连信号与订单）"
        title="市场研究因子中心"
      />

      <div className="research-boundary">
        <ShieldAlert size={20} />
        <span>
          <b>研究边界</b>
          创作者观点属于备选数据，不等于事实或投资建议；当前样本不足，系统明确禁用概率预测。
        </span>
        <em>
          <Ban size={14} />
          不生成交易
        </em>
      </div>

      {error ? (
        <div className="service-error">
          <ServerCrash size={18} />
          {error}
        </div>
      ) : null}
      {message ? <p className="quant-message">{message}</p> : null}
      {loading && !data ? (
        <div className="detail-loading">
          <LoaderCircle className="spin" size={22} />
          正在读取研究来源和因子…
        </div>
      ) : null}

      {data ? (
        <>
          <div className="research-action-bar">
            <label>
              <span>评估日期</span>
              <input
                type="date"
                value={asOfDate}
                onChange={(event) => setAsOfDate(event.target.value)}
              />
            </label>
            <label>
              <span>观察周期</span>
              <select
                value={horizonDays}
                onChange={(event) => setHorizonDays(Number(event.target.value))}
              >
                <option value={5}>5 个交易日</option>
                <option value={20}>20 个交易日</option>
                <option value={60}>60 个交易日</option>
                <option value={120}>120 个交易日</option>
              </select>
            </label>
            <button
              className="primary-button"
              disabled={busy || !asOfDate}
              onClick={() => void createSnapshot()}
              type="button"
            >
              {busy ? <LoaderCircle className="spin" size={16} /> : <FlaskConical size={16} />}
              生成研究快照
            </button>
            <small>保存可审计的当日因子截面；不会进入策略、信号或执行模块。</small>
          </div>

          <div className="paper-kpis research-kpis">
            <article>
              <span>已审阅来源</span>
              <strong>{data.stats.sourceCount}</strong>
              <small>
                已建档 {data.stats.totalSourceCount} · 门槛{" "}
                {data.methodology.minimumReviewedSources}
              </small>
            </article>
            <article>
              <span>提取因子</span>
              <strong>{data.stats.factorCount}</strong>
              <small>{data.stats.includedFactorCount} 项参与聚合</small>
            </article>
            <article>
              <span>官方已核验</span>
              <strong className="is-success">{data.stats.verifiedFactorCount}</strong>
              <small>其余按置信度降权</small>
            </article>
            <article>
              <span>必需因子覆盖</span>
              <strong>{data.preview.coveragePercent}%</strong>
              <small>
                {Math.round(
                  (data.preview.coveragePercent / 100) *
                    data.methodology.requiredFactorCodes.length,
                )}
                /{data.methodology.requiredFactorCodes.length} 类有效
              </small>
            </article>
            <article>
              <span>方向分</span>
              <strong>{data.preview.directionScore}</strong>
              <small>-100 风险规避 / +100 风险偏好</small>
            </article>
            <article>
              <span>尾部风险</span>
              <strong className={data.preview.tailRiskScore >= 65 ? "is-danger" : ""}>
                {data.preview.tailRiskScore}
              </strong>
              <small>证据置信 {data.preview.evidenceConfidence}</small>
            </article>
          </div>

          <div className="research-summary-grid">
            <Panel description={`方法版本 ${data.methodology.version}`} title="当前市场状态">
              <div className="research-regime">
                <span
                  className={`research-regime__status ${data.preview.status === "INSUFFICIENT_HISTORY" ? "is-blocked" : ""}`}
                >
                  {data.preview.status === "INSUFFICIENT_HISTORY" ? "样本不足" : "仅供研究"}
                </span>
                <h3>{regimeLabels[data.preview.regime] ?? data.preview.regime}</h3>
                <p>{data.preview.summary}</p>
                <dl>
                  <div>
                    <dt>方向分</dt>
                    <dd>{data.preview.directionScore}</dd>
                  </div>
                  <div>
                    <dt>尾部风险</dt>
                    <dd>{data.preview.tailRiskScore}</dd>
                  </div>
                  <div>
                    <dt>证据置信</dt>
                    <dd>{data.preview.evidenceConfidence}</dd>
                  </div>
                </dl>
              </div>
            </Panel>
            <Panel description="任一项未满足时，概率输出保持关闭" title="预测准入阻断">
              <ul className="research-blockers">
                {data.preview.blockers.map((blocker) => (
                  <li key={blocker}>
                    <ShieldAlert size={15} />
                    <span>{blocker}</span>
                  </li>
                ))}
              </ul>
              <div className="research-safeguards">
                <span>
                  <Ban size={14} />
                  上涨/下跌概率：关闭
                </span>
                <span>
                  <Ban size={14} />
                  回撤概率：关闭
                </span>
                <span>
                  <CheckCircle2 size={14} />
                  只读研究状态：开启
                </span>
              </div>
            </Panel>
          </div>

          <Panel
            description="保留原始视频时间点、数据日期、核验状态和官方出处；情景预测与定性归档默认不参与聚合"
            title="影响因子证据表"
          >
            <div className="table-scroll">
              <table className="data-table research-factor-table">
                <thead>
                  <tr>
                    <th>来源 / 时间点</th>
                    <th>因子</th>
                    <th>数值</th>
                    <th>方向 / 风险</th>
                    <th>数据日期</th>
                    <th>核验 / 时效</th>
                    <th>证据摘要</th>
                    <th>聚合</th>
                  </tr>
                </thead>
                <tbody>
                  {factorRows.map(({ factor, source }) => (
                    <tr key={factor.id}>
                      <td>
                        <a
                          href={`${source.url}&t=${factor.sourceTimestampSeconds ?? 0}s`}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {source.externalId}
                          <ExternalLink size={11} />
                        </a>
                        <small>{formatTimestamp(factor.sourceTimestampSeconds)}</small>
                      </td>
                      <td>
                        <b>{factor.label}</b>
                        <code>{factor.code}</code>
                      </td>
                      <td>{formatFactorValue(factor)}</td>
                      <td>
                        <span className={`research-direction is-${factor.direction.toLowerCase()}`}>
                          {factor.direction}
                        </span>
                        <small>
                          {factor.directionScore} / {factor.tailRiskScore}
                        </small>
                      </td>
                      <td>{factor.asOfDate ?? "未确认"}</td>
                      <td>
                        <span
                          className={`research-verification is-${factor.verificationStatus.toLowerCase()}`}
                        >
                          {verificationLabels[factor.verificationStatus] ??
                            factor.verificationStatus}
                        </span>
                        <small>{freshnessLabels[factor.freshness] ?? factor.freshness}</small>
                      </td>
                      <td>
                        <p>{factor.evidenceSummary}</p>
                        {factor.officialSourceUrl ? (
                          <a href={factor.officialSourceUrl} rel="noreferrer" target="_blank">
                            官方出处
                            <ExternalLink size={11} />
                          </a>
                        ) : null}
                      </td>
                      <td>
                        {factor.includeInAssessment ? (
                          <span className="is-success">参与</span>
                        ) : (
                          <span className="is-muted">仅归档</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel
            description={`频道共 ${data.channelInventory.channelVideoCount} 条视频；已加载 ${data.channelInventory.accessibleLongVideoCount} 条长视频并按标题筛出 ${data.channelInventory.titleScreenedCandidateCount} 条候选。已跳过 ${data.channelInventory.duplicateSkippedExternalIds.length} 条既有来源。`}
            title="研究来源与复核队列"
          >
            <div className="research-source-list">
              {data.sources.map((source) => (
                <article key={source.id}>
                  <Video size={20} />
                  <div>
                    <a href={source.url} rel="noreferrer" target="_blank">
                      {source.title}
                      <ExternalLink size={12} />
                    </a>
                    <p>
                      {source.creatorName} {source.creatorHandle} ·{" "}
                      {new Date(source.publishedAt).toLocaleString("zh-CN")} ·{" "}
                      {Math.floor((source.durationSeconds ?? 0) / 60)} 分钟
                    </p>
                    <small>{source.notes}</small>
                  </div>
                  <em>{source.reviewStatus}</em>
                </article>
              ))}
            </div>
            <p className="is-muted">
              待人工复核 {data.stats.candidateSourceCount} 条；非交易研究误匹配{" "}
              {data.stats.rejectedSourceCount} 条；访问受限 {data.stats.blockedSourceCount}{" "}
              条。误匹配和受限来源的因子数为 0；只有 REVIEWED 来源的因子具备进入聚合的资格。
            </p>
          </Panel>
        </>
      ) : null}
    </>
  );
}
