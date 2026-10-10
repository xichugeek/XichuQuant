"use client";

import { Calculator, History, LoaderCircle, Save, ServerCrash, WalletCards } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { getJson, patchJson } from "@/lib/api-client";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import type { PortfolioDashboard } from "@/lib/portfolio-types";

type AllocationDraft = Record<
  string,
  { manualAmount: number; riskBudget: number; targetAllocationPercent: number; volatility: number }
>;

export default function CapitalAllocationPage() {
  const [data, setData] = useState<PortfolioDashboard | null>(null);
  const [draft, setDraft] = useState<AllocationDraft>({});
  const [mode, setMode] = useState("FIXED_PERCENT");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await getJson<PortfolioDashboard>("/portfolios/dashboard");
      setData(result);
      if (result.portfolio) {
        setMode(result.portfolio.allocationMode);
        setDraft(
          Object.fromEntries(
            result.portfolio.strategies.map((item) => [
              item.id,
              {
                manualAmount: item.manualAmount || item.virtualCapital,
                riskBudget: 1,
                targetAllocationPercent: item.targetAllocationPercent,
                volatility: 0.2,
              },
            ]),
          ),
        );
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "资金分配 API 不可用");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const portfolio = data?.portfolio;
  const investable = portfolio
    ? portfolio.initialCapital * (1 - portfolio.cashReservePercent / 100)
    : 0;
  const requested = useMemo(
    () =>
      Object.values(draft).reduce(
        (sum, item) =>
          sum + (mode === "MANUAL_AMOUNT" ? item.manualAmount : item.targetAllocationPercent),
        0,
      ),
    [draft, mode],
  );

  async function save() {
    if (!portfolio) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await patchJson(`/portfolios/${portfolio.id}/allocation`, {
        allocationMode: mode,
        items: portfolio.strategies.map((member) => ({
          portfolioStrategyId: member.id,
          ...draft[member.id],
        })),
      });
      setMessage("资金分配已保存为新的不可变历史版本。");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "资金分配失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        description="固定比例、等权、波动率反比、风险预算和手动金额；每次变更追加历史版本"
        title="资金分配"
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
          正在读取资金池和分配版本…
        </div>
      ) : null}
      {portfolio ? (
        <>
          <div className="v16-allocation-hero">
            <span>
              <WalletCards size={21} />
              <b>{formatCurrency(portfolio.initialCapital)}</b>
              <small>组合初始资金</small>
            </span>
            <span>
              <Calculator size={21} />
              <b>{formatCurrency(investable)}</b>
              <small>扣除 {formatPercent(portfolio.cashReservePercent)} 储备后的可投资资金</small>
            </span>
            <span>
              <History size={21} />
              <b>v{portfolio.allocationRules.at(-1)?.version ?? 1}</b>
              <small>当前分配规则版本</small>
            </span>
          </div>
          <Panel description="策略资金上限和杠杆策略更低上限由后端再次校验" title="分配参数">
            <div className="v16-allocation-toolbar">
              <label>
                <span>分配模式</span>
                <select value={mode} onChange={(event) => setMode(event.target.value)}>
                  <option value="FIXED_PERCENT">固定比例分配</option>
                  <option value="EQUAL_WEIGHT">等权分配</option>
                  <option value="INVERSE_VOLATILITY">按波动率反比分配</option>
                  <option value="RISK_BUDGET">按风险预算分配</option>
                  <option value="MANUAL_AMOUNT">手动金额分配</option>
                </select>
              </label>
              <small>
                {mode === "MANUAL_AMOUNT"
                  ? `输入金额合计 ${formatCurrency(requested)}`
                  : `输入比例合计 ${formatPercent(requested)}`}
              </small>
              <button
                className="primary-button"
                disabled={busy || portfolio.strategies.length === 0}
                onClick={() => void save()}
                type="button"
              >
                <Save size={15} />
                保存新版本
              </button>
            </div>
            <div className="table-scroll">
              <table className="data-table v16-allocation-table">
                <thead>
                  <tr>
                    <th>策略</th>
                    <th>目标比例</th>
                    <th>手动金额</th>
                    <th>年化波动率</th>
                    <th>风险预算</th>
                    <th>策略资金上限</th>
                    <th>当前虚拟资金</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.strategies.map((member) => {
                    const row = draft[member.id];
                    return (
                      <tr key={member.id}>
                        <td>
                          <b>{member.strategy.name}</b>
                          <small>{member.strategy.symbolUniverse.join(" / ")}</small>
                        </td>
                        <td>
                          <input
                            type="number"
                            value={row?.targetAllocationPercent ?? 0}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                [member.id]: {
                                  ...current[member.id]!,
                                  targetAllocationPercent: Number(event.target.value),
                                },
                              }))
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            value={row?.manualAmount ?? 0}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                [member.id]: {
                                  ...current[member.id]!,
                                  manualAmount: Number(event.target.value),
                                },
                              }))
                            }
                          />
                        </td>
                        <td>
                          <input
                            step="0.01"
                            type="number"
                            value={row?.volatility ?? 0.2}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                [member.id]: {
                                  ...current[member.id]!,
                                  volatility: Number(event.target.value),
                                },
                              }))
                            }
                          />
                        </td>
                        <td>
                          <input
                            step="0.1"
                            type="number"
                            value={row?.riskBudget ?? 1}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                [member.id]: {
                                  ...current[member.id]!,
                                  riskBudget: Number(event.target.value),
                                },
                              }))
                            }
                          />
                        </td>
                        <td>{formatPercent(member.maxCapitalPercent)}</td>
                        <td>{formatCurrency(member.virtualCapital)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
          <div className="v16-two-column">
            <Panel description="组合级规则与真实账户 RiskEngine 同时保留" title="当前组合风控预算">
              {portfolio.riskRules.at(-1) ? (
                <div className="v16-risk-grid">
                  {Object.entries(portfolio.riskRules.at(-1)!)
                    .filter(([key]) => key !== "version")
                    .map(([key, value]) => (
                      <span key={key}>
                        <small>{key}</small>
                        <b>{typeof value === "number" ? value : String(value)}</b>
                      </span>
                    ))}
                </div>
              ) : null}
            </Panel>
            <Panel description="旧版本不会被覆盖；再平衡记录固定引用分配版本" title="分配历史">
              <div className="v16-version-list">
                {[...portfolio.allocationRules].reverse().map((rule) => (
                  <article key={rule.id}>
                    <b>v{rule.version}</b>
                    <span>{rule.allocationMode}</span>
                    <time>{new Date(rule.effectiveFrom).toLocaleString("zh-CN")}</time>
                  </article>
                ))}
              </div>
            </Panel>
          </div>
        </>
      ) : !loading ? (
        <div className="empty-state">请先在“策略组合”创建组合并加入已审批策略。</div>
      ) : null}
    </>
  );
}
