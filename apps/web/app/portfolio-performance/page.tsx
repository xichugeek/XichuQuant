"use client";

import { Activity, LoaderCircle, RefreshCw, ServerCrash, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { PortfolioEquityChart } from "@/components/portfolio-equity-chart";
import { getJson, postJson } from "@/lib/api-client";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import type { PortfolioDashboard } from "@/lib/portfolio-types";

type Performance = {
  totalEquity: number;
  cashBalance: number;
  cashPercent: number;
  totalReturn: number;
  annualizedReturn: number;
  maxDrawdown: number;
  annualizedVolatility: number;
  sharpe: number;
  sortino: number;
  profitFactor: number;
  totalCommission: number;
  totalSlippage: number;
  opportunityCost: number;
  idleCashDrag: number;
  positions: Array<{
    id: string;
    symbol: string;
    assetType: string;
    theme: string | null;
    quantity: number;
    avgCost: number;
    currentPrice: number;
    marketValue: number;
    unrealizedPnl: number;
  }>;
  snapshots: Array<{
    snapshotDate: string;
    totalEquity: number;
    benchmarkEquity: number;
    drawdown: number;
  }>;
  symbolExposure: Record<string, number>;
  themeExposure: Record<string, number>;
  strategyAllocation: Array<{ id: string; name: string; amount: number; percent: number }>;
  attribution: Array<{
    id: string;
    portfolioStrategyId: string;
    attributionDate: string;
    strategyReturn: number;
    allocatedContribution: number;
    riskContribution: number;
    commissionImpact: number;
    slippageImpact: number;
    riskOpportunityCost: number;
    cashDrag: number;
  }>;
};
type Analysis = {
  available?: boolean;
  message?: string;
  strategyCorrelationMatrix?: Record<string, Record<string, number>>;
  assetCorrelationMatrix?: Record<string, Record<string, number>>;
  rollingCorrelations?: Record<string, Record<string, number | null>>;
  riskContributions?: Record<
    string,
    { weight: number; marginalRiskContribution: number; riskContribution: number }
  >;
  themeConcentration?: Record<string, number>;
  maximumRiskSource?: { strategy: string; riskContribution: number };
  diversificationWarning?: string | null;
};

export default function PortfolioPerformancePage() {
  const [dashboard, setDashboard] = useState<PortfolioDashboard | null>(null);
  const [performance, setPerformance] = useState<Performance | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getJson<PortfolioDashboard>("/portfolios/dashboard");
      setDashboard(data);
      if (data.portfolio) {
        const [metrics, quant] = await Promise.all([
          getJson<Performance>(`/portfolios/${data.portfolio.id}/performance`),
          postJson<Analysis>(`/portfolios/${data.portfolio.id}/analyze`).catch(
            (reason: unknown) => ({
              available: false,
              message: reason instanceof Error ? reason.message : "组合分析服务不可用",
            }),
          ),
        ]);
        setPerformance(metrics);
        setAnalysis(quant);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "组合表现 API 不可用");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function snapshot() {
    const portfolio = dashboard?.portfolio;
    if (!portfolio) return;
    setBusy(true);
    setError("");
    try {
      await postJson(`/portfolios/${portfolio.id}/snapshot`, {});
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "权益快照失败");
    } finally {
      setBusy(false);
    }
  }

  const members = new Map(
    dashboard?.portfolio?.strategies.map((item) => [item.id, item.strategy.name]),
  );
  return (
    <>
      <PageHeader
        action={
          <button
            className="primary-button"
            disabled={busy || !dashboard?.portfolio}
            onClick={() => void snapshot()}
            type="button"
          >
            <RefreshCw size={15} />
            刷新组合权益
          </button>
        }
        description="组合收益、资金分配后贡献、交易成本、机会损益、现金拖累和真实风险分散分别展示"
        title="组合表现"
      />
      {error ? (
        <div className="service-error">
          <ServerCrash size={18} />
          {error}
        </div>
      ) : null}
      {loading ? (
        <div className="detail-loading">
          <LoaderCircle className="spin" size={22} />
          正在计算组合绩效、归因和相关性…
        </div>
      ) : null}
      {performance ? (
        <>
          {analysis?.diversificationWarning ? (
            <div className="v16-correlation-warning">
              <TriangleAlert size={19} />
              <b>{analysis.diversificationWarning}</b>
            </div>
          ) : null}
          <div className="v16-performance-kpis">
            <article>
              <span>组合总权益</span>
              <strong>{formatCurrency(performance.totalEquity)}</strong>
              <small>现金 {formatPercent(performance.cashPercent)}</small>
            </article>
            <article>
              <span>总收益率</span>
              <strong>{formatPercent(performance.totalReturn)}</strong>
              <small>年化 {formatPercent(performance.annualizedReturn)}</small>
            </article>
            <article>
              <span>最大回撤</span>
              <strong className="is-danger">{formatPercent(performance.maxDrawdown)}</strong>
              <small>组合权益曲线</small>
            </article>
            <article>
              <span>年化波动率</span>
              <strong>{formatPercent(performance.annualizedVolatility)}</strong>
              <small>日收益折算</small>
            </article>
            <article>
              <span>Sharpe / Sortino</span>
              <strong>
                {performance.sharpe.toFixed(2)} / {performance.sortino.toFixed(2)}
              </strong>
              <small>无风险利率按 0</small>
            </article>
            <article>
              <span>Profit Factor</span>
              <strong>{performance.profitFactor.toFixed(2)}</strong>
              <small>实际组合成交</small>
            </article>
          </div>
          <Panel description="组合权益、回撤与 BuyAndHold 基准严格分线" title="组合权益与回撤">
            <PortfolioEquityChart points={performance.snapshots} />
          </Panel>
          <div className="v16-two-column">
            <Panel description="目标资金、实际虚拟资金与组合现金储备分开计算" title="策略资金分配">
              <div className="v16-exposure-grid">
                <section>
                  {performance.strategyAllocation.map((item) => (
                    <p key={item.id}>
                      <span>{item.name}</span>
                      <strong>
                        {formatCurrency(item.amount)} · {formatPercent(item.percent)}
                      </strong>
                    </p>
                  ))}
                </section>
              </div>
            </Panel>
            <Panel
              description="仅来自独立 Portfolio* 模拟账本，不读取真实账户持仓"
              title="当前组合持仓"
            >
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>标的</th>
                      <th>类型 / 主题</th>
                      <th>数量</th>
                      <th>均价 / 现价</th>
                      <th>市值</th>
                      <th>浮动盈亏</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.positions.map((position) => (
                      <tr key={position.id}>
                        <td>
                          <b>{position.symbol}</b>
                        </td>
                        <td>
                          {position.assetType} / {position.theme ?? "—"}
                        </td>
                        <td>{position.quantity.toFixed(4)}</td>
                        <td>
                          {position.avgCost.toFixed(2)} / {position.currentPrice.toFixed(2)}
                        </td>
                        <td>{formatCurrency(position.marketValue)}</td>
                        <td>{formatCurrency(position.unrealizedPnl)}</td>
                      </tr>
                    ))}
                    {performance.positions.length === 0 ? (
                      <tr>
                        <td colSpan={6}>当前组合尚无持仓</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
          <div className="v16-two-column">
            <Panel description="不以策略数量替代真实风险分散" title="策略收益相关矩阵">
              {analysis?.strategyCorrelationMatrix ? (
                <div className="v16-correlation-matrix">
                  {Object.entries(analysis.strategyCorrelationMatrix).map(([row, columns]) => (
                    <article key={row}>
                      <b>{row}</b>
                      {Object.entries(columns).map(([column, value]) => (
                        <span
                          className={row !== column && value >= 0.8 ? "is-high" : ""}
                          key={column}
                        >
                          <small>{column}</small>
                          <strong>{value.toFixed(2)}</strong>
                        </span>
                      ))}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty-state">{analysis?.message ?? "相关性样本不足"}</p>
              )}
            </Panel>
            <Panel description="标的与主题集中度来自当前组合持仓" title="暴露与最大风险来源">
              <div className="v16-exposure-grid">
                <section>
                  <b>标的暴露</b>
                  {Object.entries(performance.symbolExposure).map(([key, value]) => (
                    <p key={key}>
                      <span>{key}</span>
                      <strong>{formatCurrency(value)}</strong>
                    </p>
                  ))}
                </section>
                <section>
                  <b>主题暴露</b>
                  {Object.entries(performance.themeExposure).map(([key, value]) => (
                    <p key={key}>
                      <span>{key}</span>
                      <strong>{formatCurrency(value)}</strong>
                    </p>
                  ))}
                </section>
              </div>
              {analysis?.maximumRiskSource ? (
                <p className="v16-risk-source">
                  <Activity size={15} />
                  最大单一风险来源：<b>{analysis.maximumRiskSource.strategy}</b>（
                  {formatPercent(analysis.maximumRiskSource.riskContribution * 100)}）
                </p>
              ) : null}
            </Panel>
          </div>
          <div className="v16-two-column">
            <Panel description="20 日与 60 日窗口不足时保持空值，不伪造相关性" title="滚动相关性">
              <div className="v16-exposure-grid">
                <section>
                  {Object.entries(analysis?.rollingCorrelations ?? {}).map(([pair, windows]) => (
                    <p key={pair}>
                      <span>{pair}</span>
                      <strong>
                        20D {windows["20"]?.toFixed(2) ?? "—"} · 60D{" "}
                        {windows["60"]?.toFixed(2) ?? "—"}
                      </strong>
                    </p>
                  ))}
                  {Object.keys(analysis?.rollingCorrelations ?? {}).length === 0 ? (
                    <p>滚动样本不足</p>
                  ) : null}
                </section>
              </div>
            </Panel>
            <Panel
              description="权重、边际风险贡献和总风险贡献由 Quant Engine 计算"
              title="策略风险贡献"
            >
              <div className="v16-exposure-grid">
                <section>
                  {Object.entries(analysis?.riskContributions ?? {}).map(([strategy, risk]) => (
                    <p key={strategy}>
                      <span>{strategy}</span>
                      <strong>
                        权重 {formatPercent(risk.weight * 100)} · MRC{" "}
                        {risk.marginalRiskContribution.toFixed(4)} · RC{" "}
                        {formatPercent(risk.riskContribution * 100)}
                      </strong>
                    </p>
                  ))}
                  {Object.keys(analysis?.riskContributions ?? {}).length === 0 ? (
                    <p>风险贡献样本不足</p>
                  ) : null}
                </section>
              </div>
            </Panel>
          </div>
          <Panel
            description="同一交易日期的复权收盘收益计算，不以策略标签替代标的相关性"
            title="标的收益相关矩阵"
          >
            {analysis?.assetCorrelationMatrix &&
            Object.keys(analysis.assetCorrelationMatrix).length ? (
              <div className="v16-correlation-matrix">
                {Object.entries(analysis.assetCorrelationMatrix).map(([row, columns]) => (
                  <article key={row}>
                    <b>{row}</b>
                    {Object.entries(columns).map(([column, value]) => (
                      <span
                        className={row !== column && value >= 0.8 ? "is-high" : ""}
                        key={column}
                      >
                        <small>{column}</small>
                        <strong>{value.toFixed(2)}</strong>
                      </span>
                    ))}
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-state">标的共同样本不足</p>
            )}
          </Panel>
          <div className="v16-cost-strip">
            <span>
              手续费影响<b>{formatCurrency(performance.totalCommission)}</b>
            </span>
            <span>
              滑点影响<b>{formatCurrency(performance.totalSlippage)}</b>
            </span>
            <span>
              风控拒绝机会损益<b>{formatCurrency(performance.opportunityCost)}</b>
            </span>
            <span>
              现金闲置差异<b>{formatCurrency(performance.idleCashDrag)}</b>
            </span>
          </div>
          <Panel description="策略自身收益与组合资金分配后的实际贡献分别保存" title="策略绩效归因">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>策略</th>
                    <th>策略自身收益</th>
                    <th>组合实际贡献</th>
                    <th>风险贡献</th>
                    <th>手续费</th>
                    <th>滑点</th>
                    <th>机会损益</th>
                    <th>现金拖累</th>
                  </tr>
                </thead>
                <tbody>
                  {performance.attribution.map((item) => (
                    <tr key={item.id}>
                      <td>{item.attributionDate.slice(0, 10)}</td>
                      <td>
                        <b>{members.get(item.portfolioStrategyId) ?? "策略"}</b>
                      </td>
                      <td>{formatPercent(item.strategyReturn)}</td>
                      <td>{formatPercent(item.allocatedContribution)}</td>
                      <td>{formatPercent(item.riskContribution)}</td>
                      <td>{formatCurrency(item.commissionImpact)}</td>
                      <td>{formatCurrency(item.slippageImpact)}</td>
                      <td>{formatCurrency(item.riskOpportunityCost)}</td>
                      <td>{formatCurrency(item.cashDrag)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      ) : !loading ? (
        <div className="empty-state">尚无组合绩效数据。</div>
      ) : null}
    </>
  );
}
