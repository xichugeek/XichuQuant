import { AlertTriangle, Gauge, Moon, ShieldAlert, TrendingDown } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { fetchWithFallback } from "@/lib/server-api-client";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import {
  emptyRiskDisciplineDashboard,
  type RiskDisciplineDashboard,
} from "@/lib/risk-discipline-types";

export const dynamic = "force-dynamic";

function ratio(value: number | null) {
  return value === null ? "—" : value.toFixed(2);
}

export default async function RiskDisciplinePage() {
  const result = await fetchWithFallback<RiskDisciplineDashboard>(
    "/risk-discipline/dashboard",
    emptyRiskDisciplineDashboard,
  );
  const data = result.data;
  const budget = data.recentTradeRiskBudgets[0];
  const analytics = data.tradeDiscipline;
  return (
    <>
      <PageHeader
        description="计划 → Risk Budget → 退出条件 → Theme/Leverage 校验 → 风险不可扩大 → 自动审计"
        title="风险纪律防火墙"
      />
      <div className="discipline-boundary">
        <ShieldAlert size={20} />
        <span><b>硬风控不可 Override</b><small>{data.account.name} · {data.account.accountType === "PAPER" ? "模拟交易，使用虚拟资金" : "无 Stop、亏损杠杆补仓、扩大 Stop 风险、未授权隔夜和 Kill Switch 会直接阻断。"}</small></span>
        <em>{result.source === "api" ? "当前账户快照" : "API 暂不可用"}</em>
      </div>
      <section className="discipline-kpis">
        <article><Gauge /><small>当前单笔 Risk Budget</small><strong>{budget?.plannedLoss === null || !budget ? "—" : formatCurrency(budget.plannedLoss)}</strong><span>{budget?.plannedLossPct === null || !budget ? "未计算" : formatPercent(budget.plannedLossPct)}</span></article>
        <article><ShieldAlert /><small>杠杆 ETF 本金</small><strong>{formatPercent(data.leveragedEtfPrincipalPct)}</strong><span>{formatCurrency(data.leveragedEtfPrincipal)}</span></article>
        <article><Gauge /><small>Gross Effective Exposure</small><strong>{formatPercent(data.grossEffectiveExposurePct)}</strong><span>Net {formatPercent(data.netDirectionalExposurePct)}</span></article>
        <article><AlertTriangle /><small>最大 Risk Theme</small><strong>{data.maxRiskTheme?.key ?? "—"}</strong><span>{data.maxRiskTheme ? formatPercent(data.maxRiskTheme.grossEffectiveExposurePct) : "未分类"}</span></article>
        <article><TrendingDown /><small>年度利润回吐</small><strong>{formatPercent(data.profitGiveback.profitGivebackPct)}</strong><span>{data.profitGiveback.state} · {formatCurrency(data.profitGiveback.profitGivebackAmount)}</span></article>
        <article><TrendingDown /><small>当前 Drawdown</small><strong>{formatPercent(data.currentDrawdownPct)}</strong><span>权益 {formatCurrency(data.account.equity)}</span></article>
        <article><AlertTriangle /><small>亏损补仓事件</small><strong>{data.losingAddEvents}</strong><span>全部进入审计</span></article>
        <article><ShieldAlert /><small>Stop Compliance</small><strong>{data.stopCompliance.ratePct === null ? "未知" : formatPercent(data.stopCompliance.ratePct)}</strong><span>{data.stopCompliance.compliant}/{data.stopCompliance.total}</span></article>
        <article><Moon /><small>隔夜杠杆持仓</small><strong>{data.overnightLeveragedExposure.length}</strong><span>{data.overnightLeveragedExposure.some((item) => item.allowOvernight !== true) ? "存在未授权/未知" : "均已预授权"}</span></article>
        <article><ShieldAlert /><small>Kill Switch</small><strong>{data.killSwitch.level}</strong><span>{data.killSwitch.safetyState}</span></article>
      </section>
      <div className="discipline-grid">
        <Panel title="交易纪律分析" description="用可复算指标识别小赚快跑、大亏死扛与亏损补仓">
          <dl className="discipline-metrics">
            <div><dt>平均盈利 / 平均亏损</dt><dd>{formatCurrency(analytics.averageWin)} / {formatCurrency(analytics.averageLoss)}</dd></div>
            <div><dt>最大单笔亏损</dt><dd>{formatCurrency(analytics.maxSingleLoss)}</dd></div>
            <div><dt>Profit Factor</dt><dd>{ratio(analytics.profitFactor)}</dd></div>
            <div><dt>Winner / Loser 持仓小时</dt><dd>{analytics.averageWinnerHoldingHours?.toFixed(1) ?? "未核实"} / {analytics.averageLoserHoldingHours?.toFixed(1) ?? "未核实"}</dd></div>
            <div><dt>MAE / MFE</dt><dd>{formatCurrency(-analytics.mae)} / {formatCurrency(analytics.mfe)}</dd></div>
            <div><dt>MFE Capture / MAE-to-Loss</dt><dd>{ratio(analytics.mfeCaptureRatio)} / {ratio(analytics.maeToRealizedLoss)}</dd></div>
            <div><dt>无止损 / Stop 违规</dt><dd>{analytics.noStopEntryCount} / {analytics.stopAmendmentViolationCount}</dd></div>
            <div><dt>杠杆隔夜 / 策略外</dt><dd>{analytics.leveragedOvernightCount} / {analytics.strategyOutsideTradeCount}</dd></div>
          </dl>
          <div className={analytics.dispositionEffect.detected ? "discipline-disposition is-danger" : "discipline-disposition"}>
            <b>Disposition Effect</b>
            <span>{analytics.coverage === "BROKER_LEDGER_NOT_VERIFIED" ? "券商成交账本未核实" : analytics.dispositionEffect.detected ? analytics.dispositionEffect.flags.join(" · ") : "未检出"}</span>
          </div>
        </Panel>
        <Panel title="Position Incident Replay" description="IBKR Import + OHLCV；Daily 数据只给近似 MAE/MFE">
          <div className="discipline-incidents">
            {data.incidents.map((incident) => (
              <Link href={`/risk-discipline/incidents/${incident.id}`} key={incident.id}>
                <span><b>{incident.title}</b><small>{incident.symbols.join(" / ")} · {incident.riskTheme ?? "未分类"}</small></span>
                <em>{incident.dataGranularity}</em>
              </Link>
            ))}
            {!data.incidents.length ? <p>暂无可复盘事故。</p> : null}
          </div>
        </Panel>
      </div>
      <Panel title="完整 Risk Discipline Audit Trail" description="拒绝理由、操作者、时间、旧值、新值和审批链均以追加事件保存">
        <div className="table-wrap"><table className="data-table"><thead><tr><th>时间</th><th>规则</th><th>决定</th><th>原因</th><th>旧值 → 新值</th><th>操作者 / 审批链</th></tr></thead><tbody>
          {data.auditEvents.map((event) => <tr key={event.id}><td>{new Date(event.occurredAt).toLocaleString("zh-CN", { hour12: false })}</td><td><b>{event.ruleCode}</b><br /><small>{event.eventType}</small></td><td>{event.decision}</td><td>{event.reason}</td><td className="discipline-audit-json"><small>{event.oldValueJson ?? "—"}<br />→ {event.newValueJson ?? "—"}</small></td><td>{event.actorId}<br /><small>{event.approvalChainJson ?? "无审批链"}</small></td></tr>)}
        </tbody></table></div>
      </Panel>
    </>
  );
}
