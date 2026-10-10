"use client";

import {
  Ban,
  CirclePause,
  CirclePlay,
  Eye,
  LoaderCircle,
  Plus,
  ServerCrash,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { getJson, postJson } from "@/lib/api-client";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import type { PortfolioDashboard } from "@/lib/portfolio-types";

export default function PortfoliosPage() {
  const [data, setData] = useState<PortfolioDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [strategyId, setStrategyId] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await getJson<PortfolioDashboard>("/portfolios/dashboard");
      setData(result);
      setStrategyId((current) => current || result.availableStrategies[0]?.id || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "策略组合 API 不可用");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function mutate(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(success);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "组合操作失败");
    } finally {
      setBusy(false);
    }
  }

  const portfolio = data?.portfolio;
  const selected = data?.availableStrategies.find((item) => item.id === strategyId);
  return (
    <>
      <PageHeader
        description="多个已审批策略共享独立模拟资金池；组合账本、真实账户和券商接口严格隔离"
        title="策略组合"
      />
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
          正在读取组合资金池、成员策略和审计记录…
        </div>
      ) : null}
      {!portfolio && !loading ? (
        <Panel description="验收基线：初始资金 $100,000，现金储备 20%" title="创建第一个模拟组合">
          <div className="v16-create-form">
            <span>
              <b>多策略核心组合</b>
              <small>固定比例 · 手动再平衡 · NETTING</small>
            </span>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() =>
                void mutate(
                  () =>
                    postJson("/portfolios", {
                      allocationMode: "FIXED_PERCENT",
                      cashReservePercent: 20,
                      conflictPolicy: "NETTING",
                      description: "V1.6 多策略统一资金池与组合级风险预算",
                      initialCapital: 100000,
                      name: "多策略核心组合",
                      rebalanceMode: "MANUAL",
                    }),
                  "组合已创建；尚未启动任何模拟订单。",
                )
              }
              type="button"
            >
              <Plus size={16} />
              创建 $100,000 组合
            </button>
          </div>
        </Panel>
      ) : null}
      {portfolio ? (
        <>
          <div className="v16-portfolio-banner">
            <span>
              <ShieldCheck size={22} />
              <b>{portfolio.name}</b>
              <small>
                {portfolio.status} · {portfolio.allocationMode} · {portfolio.conflictPolicy}
              </small>
            </span>
            <div>
              <button
                disabled={busy || portfolio.status !== "DRAFT" || portfolio.strategies.length < 2}
                onClick={() =>
                  void mutate(
                    () => postJson(`/portfolios/${portfolio.id}/status`, { action: "VALIDATE" }),
                    "组合进入验证状态。",
                  )
                }
                type="button"
              >
                验证
              </button>
              <button
                disabled={busy || portfolio.status !== "VALIDATING"}
                onClick={() =>
                  void mutate(
                    () => postJson(`/portfolios/${portfolio.id}/status`, { action: "APPROVE" }),
                    "组合已批准进入 Paper 阶段。",
                  )
                }
                type="button"
              >
                批准 Paper
              </button>
              <button
                disabled={busy || !["PAPER_APPROVED", "PAUSED"].includes(portfolio.status)}
                onClick={() =>
                  void mutate(
                    () => postJson(`/portfolios/${portfolio.id}/status`, { action: "START" }),
                    "组合已启动模拟运行。",
                  )
                }
                type="button"
              >
                <CirclePlay size={14} />
                启动
              </button>
              <button
                disabled={busy || portfolio.status !== "PAPER_RUNNING"}
                onClick={() =>
                  void mutate(
                    () =>
                      postJson(`/portfolios/${portfolio.id}/status`, {
                        action: "PAUSE",
                        reason: "人工暂停组合",
                      }),
                    "组合已暂停。",
                  )
                }
                type="button"
              >
                <CirclePause size={14} />
                暂停
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void mutate(
                    () =>
                      postJson(`/portfolios/${portfolio.id}/status`, {
                        action: "NO_NEW_POSITIONS",
                        enabled: !portfolio.noNewPositions,
                      }),
                    "新开仓控制已更新。",
                  )
                }
                type="button"
              >
                <Ban size={14} />
                {portfolio.noNewPositions ? "允许开仓" : "仅允许平仓"}
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void mutate(
                    () =>
                      postJson(`/portfolios/${portfolio.id}/status`, {
                        action: "READ_ONLY",
                        enabled: !portfolio.readOnlyMode,
                      }),
                    "只读观察模式已更新。",
                  )
                }
                type="button"
              >
                <Eye size={14} />
                {portfolio.readOnlyMode ? "退出只读" : "只读观察"}
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void mutate(
                    () =>
                      postJson(`/portfolios/${portfolio.id}/status`, {
                        action: "CANCEL_OPEN_ORDERS",
                        reason: "人工撤销全部组合未成交模拟订单",
                      }),
                    "全部未成交组合模拟订单已撤销。",
                  )
                }
                type="button"
              >
                <Ban size={14} />
                撤销未成交
              </button>
            </div>
          </div>
          {data?.control.killSwitchEnabled ? (
            <div className="critical-risk-alert">
              全局 Kill Switch 已启用：所有组合新订单均被阻止。
            </div>
          ) : null}
          <div className="paper-kpis">
            <article>
              <span>组合初始资金</span>
              <strong>{formatCurrency(portfolio.initialCapital)}</strong>
              <small>独立模拟资金池</small>
            </article>
            <article>
              <span>组合总权益</span>
              <strong>{formatCurrency(portfolio.totalEquity)}</strong>
              <small>现金 + 组合持仓</small>
            </article>
            <article>
              <span>可用现金</span>
              <strong>{formatCurrency(portfolio.cashBalance)}</strong>
              <small>储备 {formatPercent(portfolio.cashReservePercent)}</small>
            </article>
            <article>
              <span>成员策略</span>
              <strong>{portfolio.strategies.length}</strong>
              <small>只允许已审批部署</small>
            </article>
            <article>
              <span>未实现盈亏</span>
              <strong className={portfolio.unrealizedPnl < 0 ? "is-danger" : "is-success"}>
                {formatCurrency(portfolio.unrealizedPnl)}
              </strong>
              <small>组合独立持仓</small>
            </article>
            <article>
              <span>最大回撤</span>
              <strong className="is-danger">{formatPercent(portfolio.maxDrawdown)}</strong>
              <small>组合停止线</small>
            </article>
          </div>
          <div className="v16-two-column">
            <Panel
              description="加入时校验审批状态、部署状态和杠杆策略资金上限"
              title="添加已审批策略"
            >
              <div className="v16-member-form">
                <label>
                  <span>策略</span>
                  <select
                    value={strategyId}
                    onChange={(event) => setStrategyId(event.target.value)}
                  >
                    {data?.availableStrategies.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.approvalStatus}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="primary-button"
                  disabled={
                    busy ||
                    !selected ||
                    portfolio.strategies.some((item) => item.strategy.id === selected.id)
                  }
                  onClick={() =>
                    void mutate(
                      () =>
                        postJson(`/portfolios/${portfolio.id}/strategies`, {
                          maxCapitalPercent: 40,
                          priority: portfolio.strategies.length + 1,
                          strategyDeploymentId: selected?.deployments[0]?.id,
                          strategyId: selected?.id,
                          targetAllocationPercent: portfolio.strategies.length === 0 ? 40 : 20,
                        }),
                      "已审批策略已加入组合。",
                    )
                  }
                  type="button"
                >
                  <Plus size={15} />
                  加入组合
                </button>
              </div>
              <div className="v16-member-list">
                {portfolio.strategies.map((member) => (
                  <article key={member.id}>
                    <span>
                      <b>{member.strategy.name}</b>
                      <small>
                        {member.strategy.code} · {member.deployment?.status}
                      </small>
                    </span>
                    <span>
                      目标占比<b>{formatPercent(member.targetAllocationPercent)}</b>
                    </span>
                    <span>
                      资金上限<b>{formatPercent(member.maxCapitalPercent)}</b>
                    </span>
                    <span>
                      虚拟资金<b>{formatCurrency(member.virtualCapital)}</b>
                    </span>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          () =>
                            postJson(`/portfolios/${portfolio.id}/strategies/${member.id}/status`, {
                              action: member.status === "ACTIVE" ? "PAUSE" : "RESUME",
                              reason: "组合成员策略人工控制",
                            }),
                          member.status === "ACTIVE" ? "成员策略已暂停。" : "成员策略已恢复。",
                        )
                      }
                      type="button"
                    >
                      {member.status === "ACTIVE" ? (
                        <CirclePause size={13} />
                      ) : (
                        <CirclePlay size={13} />
                      )}
                      {member.status === "ACTIVE" ? "暂停策略" : "恢复策略"}
                    </button>
                  </article>
                ))}
                {portfolio.strategies.length === 0 ? (
                  <p className="empty-state">尚未加入策略</p>
                ) : null}
              </div>
            </Panel>
            <Panel description="所有暂停、开仓限制、只读及订单撤销均写入数据库" title="组合审计">
              <div className="v16-audit-list">
                {portfolio.auditEvents.slice(0, 12).map((event) => (
                  <article key={event.id}>
                    <em>{event.severity}</em>
                    <span>
                      <b>{event.eventType}</b>
                      <small>{new Date(event.createdAt).toLocaleString("zh-CN")}</small>
                    </span>
                  </article>
                ))}
              </div>
            </Panel>
          </div>
          <div className="safeguard-list">
            {Object.entries(data?.safeguards ?? {}).map(([key, enabled]) => (
              <span className={enabled ? "is-on" : ""} key={key}>
                <i />
                {key}
              </span>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
