import { AlertTriangle, ArrowLeft } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { fetchWithFallback } from "@/lib/server-api-client";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { mockIncidentReplay, type IncidentReplay } from "@/lib/risk-discipline-types";

export const dynamic = "force-dynamic";

export default async function IncidentReplayPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const result = await fetchWithFallback<IncidentReplay>(
    `/risk-discipline/incidents/${encodeURIComponent(id)}/replay`,
    mockIncidentReplay,
  );
  if (result.source === "mock" && !(process.env.XICHURISK_DATA_MODE === "DEMO" && id === "position-incident-synthetic-lab")) return <Panel title="事故数据暂不可用" description="未找到已验证的事故账本；请恢复 API 或核对事故编号。"><p>未展示演示账本。</p></Panel>;
  const replay = result.data;
  return (
    <>
      <PageHeader
        action={<Link className="secondary-button" href="/risk-discipline"><ArrowLeft size={14} />返回风险纪律</Link>}
        description={`${replay.incident.symbols.join(" / ")} · ${replay.incident.riskTheme ?? "未分类"}`}
        title={replay.incident.title}
      />
      <div className="discipline-methodology"><AlertTriangle size={18} /><span><b>{replay.dataGranularity}</b><small>{replay.methodology}</small></span></div>
      <section className="discipline-replay-kpis">
        <article><small>最大浮亏 / MAE</small><strong>{formatCurrency(replay.maximumUnrealizedLoss)}</strong></article>
        <article><small>最大 MFE</small><strong>{formatCurrency(replay.maximumFavorableExcursion)}</strong></article>
        <article><small>最终实现盈亏</small><strong>{formatCurrency(replay.finalRealizedPnl)}</strong></article>
        <article><small>首次违规到平仓</small><strong>{replay.firstViolationToCloseHours === null ? "—" : `${replay.firstViolationToCloseHours.toFixed(1)}h`}</strong></article>
      </section>
      <div className="discipline-grid">
        <Panel title="仓位路径" description="初始建仓、每次加仓、拆股调整与退出均保留">
          <div className="table-wrap"><table className="data-table"><thead><tr><th>时间</th><th>阶段</th><th>标的</th><th>数量</th><th>价格 / 平均成本</th></tr></thead><tbody>
            {replay.entries.map((entry, index) => <tr key={`${entry.time}-${entry.symbol}-${index}`}><td>{new Date(entry.time).toLocaleString("zh-CN", { hour12: false })}</td><td>{entry.stage}</td><td><b>{entry.symbol}</b></td><td>{entry.quantity}</td><td>{formatCurrency(entry.price)}<br /><small>{entry.averageCostAfter === undefined ? "—" : `均价 ${formatCurrency(entry.averageCostAfter)}`}</small></td></tr>)}
          </tbody></table></div>
          <p className="discipline-split">拆股来源优先级：IBKR_CORPORATE_ACTION → OHLCV_SPLIT_FACTOR；本次匹配 {replay.splitAdjustments.length} 条。</p>
          {replay.splitAdjustments.map((split) => <p className="discipline-split" key={`${split.date}-${split.symbol}`}>{split.date} · {split.symbol} · {split.ratio}:1 · {split.source}</p>)}
        </Panel>
        <Panel title="风险轨迹" description="成本、市值、权益占比、Effective Leverage Exposure 与每日 MAE/MFE">
          <div className="table-wrap"><table className="data-table"><thead><tr><th>日期</th><th>成本 / 市值</th><th>权益占比</th><th>有效敞口</th><th>MAE / MFE</th></tr></thead><tbody>
            {replay.timeline.map((row) => <tr key={row.date}><td>{row.date}</td><td>{formatCurrency(row.costBasis)} / {formatCurrency(row.marketValue)}</td><td>{formatPercent(row.accountEquityPercent)}</td><td>{formatCurrency(row.effectiveLeverageExposure)}<br /><small>{formatPercent(row.effectiveLeverageExposurePct)}</small></td><td>{formatCurrency(row.dailyMae)} / {formatCurrency(row.dailyMfe)}</td></tr>)}
          </tbody></table></div>
        </Panel>
      </div>
    </>
  );
}
