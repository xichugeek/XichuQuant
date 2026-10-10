"use client";

import { GitMerge, LoaderCircle, Play, RefreshCw, ServerCrash, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { getJson, postJson } from "@/lib/api-client";
import { formatCurrency } from "@/lib/formatters";
import type { PortfolioDashboard, PortfolioRun } from "@/lib/portfolio-types";

export default function RebalanceCenterPage() {
  const [data, setData] = useState<PortfolioDashboard | null>(null);
  const [result, setResult] = useState<PortfolioRun | null>(null);
  const [tradeDate, setTradeDate] = useState("2026-07-17");
  const [policy, setPolicy] = useState("NETTING");
  const [runType, setRunType] = useState("MANUAL");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const dashboard = await getJson<PortfolioDashboard>("/portfolios/dashboard");
      setData(dashboard);
      setPolicy(dashboard.portfolio?.conflictPolicy ?? "NETTING");
      setRunType(dashboard.portfolio?.rebalanceMode ?? "MANUAL");
      setResult(dashboard.portfolio?.rebalanceRuns[0] ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "再平衡 API 不可用");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function run(execute: boolean) {
    const portfolio = data?.portfolio;
    if (!portfolio) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await postJson<PortfolioRun>(`/portfolios/${portfolio.id}/rebalance`, {
        conflictPolicy: policy,
        execute,
        runType,
        tradeDate,
      });
      setResult(response);
      setMessage(
        execute
          ? "组合模拟订单已按幂等键创建；最早下一交易日开盘成交。"
          : "再平衡预览已保存，尚未生成订单。",
      );
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "组合再平衡失败");
    } finally {
      setBusy(false);
    }
  }

  async function processOrders() {
    setBusy(true);
    setError("");
    try {
      await postJson("/portfolios/orders/process");
      setMessage("待成交组合订单已按可用开盘行情处理。");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "订单处理失败");
    } finally {
      setBusy(false);
    }
  }

  const portfolio = data?.portfolio;
  const active = result ?? portfolio?.rebalanceRuns[0] ?? null;
  return (
    <>
      <PageHeader
        description="调整前后分配、预计订单、手续费、现金、暴露和风控结果均在模拟执行前保存"
        title="再平衡中心"
      />
      {error ? (
        <div className="service-error">
          <ServerCrash size={18} />
          {error}
        </div>
      ) : null}
      {message ? <p className="quant-message">{message}</p> : null}
      {loading ? (
        <div className="detail-loading">
          <LoaderCircle className="spin" size={22} />
          正在读取原始信号和再平衡历史…
        </div>
      ) : null}
      {portfolio ? (
        <>
          <div className="v16-rebalance-toolbar">
            <label>
              <span>交易日</span>
              <input
                type="date"
                value={tradeDate}
                onChange={(event) => setTradeDate(event.target.value)}
              />
            </label>
            <label>
              <span>再平衡模式</span>
              <select value={runType} onChange={(event) => setRunType(event.target.value)}>
                <option value="MANUAL">手动</option>
                <option value="SCHEDULED">定期</option>
                <option value="THRESHOLD">偏离阈值</option>
                <option value="RISK_TRIGGERED">风控触发</option>
              </select>
            </label>
            <label>
              <span>冲突策略</span>
              <select value={policy} onChange={(event) => setPolicy(event.target.value)}>
                <option value="NETTING">NETTING 净额</option>
                <option value="PRIORITY">PRIORITY 优先级</option>
                <option value="REJECT_CONFLICT">REJECT_CONFLICT 全拒绝</option>
                <option value="MANUAL_REVIEW">MANUAL_REVIEW 人工确认</option>
              </select>
            </label>
            <button disabled={busy} onClick={() => void run(false)} type="button">
              <GitMerge size={15} />
              生成预览
            </button>
            <button
              className="primary-button"
              disabled={busy || portfolio.status !== "PAPER_RUNNING"}
              onClick={() => void run(true)}
              type="button"
            >
              <Play size={15} />
              模拟执行
            </button>
            <button disabled={busy} onClick={() => void processOrders()} type="button">
              <RefreshCw size={15} />
              处理待成交
            </button>
          </div>
          {active ? (
            <>
              <div
                className={`v16-risk-result ${active.riskResult?.allowed ? "is-pass" : "is-block"}`}
              >
                <ShieldAlert size={20} />
                <span>
                  <b>{active.riskResult?.allowed ? "组合风控通过" : "组合风控拒绝"}</b>
                  <small>
                    {active.status} · 分配 v{active.allocationVersion} · 风控 v{active.riskVersion}
                  </small>
                </span>
                <em>预计现金 {formatCurrency(active.estimatedCash)}</em>
                <em>预计手续费 {formatCurrency(active.estimatedCommission)}</em>
              </div>
              <div className="v16-two-column">
                <Panel
                  description="每条单策略信号保留原始 ID，不被净额过程覆盖"
                  title="原始策略信号"
                >
                  <div className="v16-signal-list">
                    {active.rawSignals?.map((signal) => (
                      <article key={signal.id}>
                        <b>{signal.symbol}</b>
                        <em>{signal.side}</em>
                        <span>{signal.portfolioStrategyId.slice(0, 8)}</span>
                        <code>{signal.id.slice(0, 12)}</code>
                      </article>
                    ))}
                    {!active.rawSignals?.length ? (
                      <p className="empty-state">该交易日没有已通过单策略风控的新信号</p>
                    ) : null}
                  </div>
                </Panel>
                <Panel
                  description={`${active.conflictPolicy} 保留完整计算过程`}
                  title="组合级净订单意图"
                >
                  <div className="v16-signal-list">
                    {active.estimatedOrders?.map((order) => (
                      <article key={`${order.symbol}-${order.side}`}>
                        <b>{order.symbol}</b>
                        <em>{order.side}</em>
                        <span>{order.quantity?.toFixed(4)} 股</span>
                        <code>@ {order.referencePrice}</code>
                      </article>
                    ))}
                    {!active.estimatedOrders?.length ? (
                      <p className="empty-state">冲突规则未生成可执行净订单</p>
                    ) : null}
                  </div>
                </Panel>
              </div>
              <div className="v16-two-column">
                <Panel
                  description="保存运行时分配版本，历史参数不会被后续修改覆盖"
                  title="调整前 / 调整后分配"
                >
                  <div className="v16-allocation-preview">
                    <section>
                      <b>调整前</b>
                      <pre>{JSON.stringify(active.beforeAllocation, null, 2)}</pre>
                    </section>
                    <section>
                      <b>调整后</b>
                      <pre>{JSON.stringify(active.afterAllocation, null, 2)}</pre>
                    </section>
                  </div>
                </Panel>
                <Panel description="预计订单执行后的标的、主题及杠杆 ETF 暴露" title="预计组合暴露">
                  <div className="v16-exposure-grid">
                    <section>
                      <b>标的暴露</b>
                      {Object.entries(active.riskResult?.projected?.symbolExposure ?? {}).map(
                        ([symbol, value]) => (
                          <p key={symbol}>
                            <span>{symbol}</span>
                            <strong>{formatCurrency(value)}</strong>
                          </p>
                        ),
                      )}
                    </section>
                    <section>
                      <b>主题暴露</b>
                      {Object.entries(active.riskResult?.projected?.themeExposure ?? {}).map(
                        ([theme, value]) => (
                          <p key={theme}>
                            <span>{theme}</span>
                            <strong>{formatCurrency(value)}</strong>
                          </p>
                        ),
                      )}
                      <p>
                        <span>杠杆 ETF</span>
                        <strong>
                          {formatCurrency(active.riskResult?.projected?.leveragedExposure ?? 0)}
                        </strong>
                      </p>
                    </section>
                  </div>
                </Panel>
              </div>
              <Panel
                description="任何 VIOLATION 都会阻止订单；组合风控服务异常默认拒绝"
                title="组合风险决策"
              >
                <div className="v16-violation-list">
                  {active.riskResult?.violations.map((item) => (
                    <article key={item.code}>
                      <em>{item.level}</em>
                      <b>{item.code}</b>
                      <span>{item.message}</span>
                    </article>
                  ))}
                  {active.riskResult?.violations.length === 0 ? (
                    <p className="empty-state">未发现组合级违规项</p>
                  ) : null}
                </div>
              </Panel>
            </>
          ) : null}
          <Panel description="组合暂停、只读或 Kill Switch 后不会产生新订单" title="组合模拟订单">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>标的</th>
                    <th>方向</th>
                    <th>信号日</th>
                    <th>最早成交日</th>
                    <th>批准数量</th>
                    <th>状态</th>
                    <th>拒绝原因</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.orders.map((order) => (
                    <tr key={order.id}>
                      <td>
                        <b>{order.symbol}</b>
                      </td>
                      <td>{order.side}</td>
                      <td>{order.signalTradeDate.slice(0, 10)}</td>
                      <td>{order.earliestFillDate?.slice(0, 10) ?? "—"}</td>
                      <td>{order.approvedQuantity}</td>
                      <td>{order.status}</td>
                      <td>{order.rejectionReason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      ) : !loading ? (
        <div className="empty-state">尚无策略组合。</div>
      ) : null}
    </>
  );
}
