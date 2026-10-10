"use client";

import {
  Activity,
  AlertTriangle,
  ArchiveRestore,
  Ban,
  CheckCircle2,
  ClipboardCheck,
  DatabaseBackup,
  FileClock,
  History,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Send,
  ServerCrash,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { getJson, patchJson, postJson } from "@/lib/api-client";
import type {
  BrokerExecutionMonitor,
  BrokerOrderProposalView,
  BrokerPaperDashboard,
  BrokerPaperOrderView,
} from "@/lib/paper-execution-types";

export type PaperExecutionView =
  | "approvals"
  | "backups"
  | "executions"
  | "incidents"
  | "monitor"
  | "orders"
  | "overview"
  | "reconciliation"
  | "security";

const pageCopy: Record<PaperExecutionView, { description: string; title: string }> = {
  approvals: {
    description: "逐标的核对快照、风控结论与有效期；批准与发送必须分别二次确认",
    title: "订单审批",
  },
  backups: {
    description: "展示数据库备份、恢复演练与校验记录；记录来自真实运维脚本和 SQL Server",
    title: "备份恢复",
  },
  executions: {
    description: "按外部 Execution ID 或完整业务哈希去重，保留分批成交、佣金与已实现盈亏",
    title: "Paper 成交",
  },
  incidents: {
    description: "环境不匹配、提交结果未知、对账异常与执行故障均形成可追踪事故",
    title: "执行事故",
  },
  monitor: {
    description: "统一观察 API、Quant Engine、数据库、Broker Connector 和执行安全指标",
    title: "执行监控",
  },
  orders: {
    description: "IBKR Paper 订单全生命周期；禁止任何 Live 下单、改单和撤单能力",
    title: "Paper 订单",
  },
  overview: {
    description: "人工审批建议 → ExecutionGuard → IBKR Paper → 成交回写 → 对账与事故闭环",
    title: "券商模拟执行",
  },
  reconciliation: {
    description: "订单、状态、成交与佣金逐项核对；重大差异默认阻止后续提交",
    title: "Paper 对账",
  },
  security: {
    description: "双重 Paper 环境校验、账户白名单、五级 Kill Switch 与数据隔离状态",
    title: "安全中心",
  },
};

function dateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
}

function money(value: number | null | undefined, currency = "USD") {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-US", {
    currency,
    maximumFractionDigits: 2,
    style: "currency",
  }).format(Number(value));
}

function statusTone(status: string) {
  const value = status.toUpperCase();
  if (["APPROVED", "CONNECTED", "FILLED", "MATCHED", "NORMAL", "OK", "SUCCEEDED", "VERIFIED"].some((item) => value.includes(item))) return "is-success";
  if (["CRITICAL", "ERROR", "FAILED", "LOCKDOWN", "MISMATCH", "REJECTED", "UNKNOWN"].some((item) => value.includes(item))) return "is-danger";
  if (["CONFIRMATION", "OPEN", "PARTIAL", "PENDING", "STALE", "WARNING"].some((item) => value.includes(item))) return "is-warning";
  return "";
}

function brokerReplyMessages(order: BrokerPaperOrderView) {
  if (!order.brokerReplyMessage) return [];
  try {
    const payload = JSON.parse(order.brokerReplyMessage) as { messages?: unknown };
    return Array.isArray(payload.messages)
      ? payload.messages.map((message) => String(message)).filter(Boolean)
      : [];
  } catch {
    return ["IBKR 警告内容无法解析；禁止确认，请先查看服务日志。"];
  }
}

function proposalSnapshot(proposal: BrokerOrderProposalView) {
  try {
    const parsed = JSON.parse(proposal.proposalSnapshotJson) as {
      accountSnapshotTime?: string;
      dataQualityPassed?: boolean;
      marketDataTime?: string;
      portfolioRiskApproved?: boolean;
      riskApproved?: boolean;
      snapshot?: {
        accountSnapshotTime?: string;
        dataQualityPassed?: boolean;
        estimatedCashAfter?: number;
        marketDataTime?: string;
        portfolioRiskApproved?: boolean;
        riskApproved?: boolean;
        riskResult?: { alerts?: Array<{ code?: string; level?: string }> };
      };
    };
    return {
      snapshot:
        parsed.snapshot ?? {
          accountSnapshotTime: parsed.accountSnapshotTime,
          dataQualityPassed: parsed.dataQualityPassed,
          marketDataTime: parsed.marketDataTime,
          portfolioRiskApproved: parsed.portfolioRiskApproved,
          riskApproved: parsed.riskApproved,
        },
    };
  } catch {
    return {};
  }
}

function EmptyState({ text }: Readonly<{ text: string }>) {
  return (
    <div className="v18-empty" data-testid="paper-execution-empty">
      <FileClock size={22} />
      <strong>暂无记录</strong>
      <span>{text}</span>
    </div>
  );
}

export function PaperExecutionWorkspace({ view }: Readonly<{ view: PaperExecutionView }>) {
  const [dashboard, setDashboard] = useState<BrokerPaperDashboard | null>(null);
  const [monitor, setMonitor] = useState<BrokerExecutionMonitor | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [staleAccountCount, setStaleAccountCount] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (view === "monitor") {
        setMonitor(await getJson<BrokerExecutionMonitor>("/paper-execution/monitor"));
      } else {
        const nextDashboard = await getJson<BrokerPaperDashboard>("/paper-execution/dashboard");
        const loadedAt = Date.now();
        setDashboard(nextDashboard);
        setStaleAccountCount(
          nextDashboard.accounts.filter(
            (account) =>
              !account.lastSyncedAt ||
              loadedAt - new Date(account.lastSyncedAt).getTime() > 15 * 60 * 1_000,
          ).length,
        );
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "V1.8 Paper 执行 API 不可用");
    } finally {
      setLoading(false);
    }
  }, [view]);

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
      setError(reason instanceof Error ? reason.message : "Paper 操作失败");
    } finally {
      setBusy(false);
    }
  }

  const copy = pageCopy[view];

  return (
    <div className="v18-workspace" data-testid={`paper-execution-page-${view}`}>
      <PageHeader
        action={
          <button className="v18-refresh" disabled={loading} onClick={() => void refresh()} type="button">
            <RefreshCw className={loading ? "spin" : ""} size={16} /> 刷新真实数据
          </button>
        }
        description={copy.description}
        title={copy.title}
      />
      <div className="v18-paper-boundary">
        <ShieldCheck size={19} />
        <span>
          <b>IBKR PAPER ONLY</b>
          <small>只有人工审批且通过全部门禁的 Paper 订单可发送；Live 写能力固定为 false。</small>
        </span>
        <em>LIVE 写请求：0</em>
      </div>
      {error ? (
        <div className="service-error" data-testid="paper-execution-error" role="alert">
          <ServerCrash size={18} />
          <span>{error}。页面不会用 Mock 数据伪装成功。</span>
          <button onClick={() => void refresh()} type="button">重试</button>
        </div>
      ) : null}
      {message ? <p className="quant-message">{message}</p> : null}
      {loading && !dashboard && !monitor ? (
        <div className="detail-loading" data-testid="paper-execution-loading">
          <LoaderCircle className="spin" size={22} /> 正在读取 SQL Server 与 Paper Connector…
        </div>
      ) : null}
      {dashboard && staleAccountCount > 0 ? (
        <div className="v18-stale" data-testid="paper-execution-stale">
          <AlertTriangle size={18} />
          <span>{staleAccountCount} 个 Paper 账户快照超过 15 分钟；ExecutionGuard 将默认拒绝新订单。</span>
        </div>
      ) : null}

      {view === "overview" && dashboard ? <Overview dashboard={dashboard} /> : null}
      {view === "approvals" && dashboard ? (
        <Approvals busy={busy} dashboard={dashboard} mutate={mutate} />
      ) : null}
      {view === "orders" && dashboard ? (
        <Orders busy={busy} dashboard={dashboard} mutate={mutate} />
      ) : null}
      {view === "executions" && dashboard ? <Executions dashboard={dashboard} /> : null}
      {view === "reconciliation" && dashboard ? (
        <Reconciliation busy={busy} dashboard={dashboard} mutate={mutate} />
      ) : null}
      {view === "monitor" && monitor ? <Monitor monitor={monitor} /> : null}
      {view === "incidents" && dashboard ? <Incidents dashboard={dashboard} /> : null}
      {view === "security" && dashboard ? (
        <Security busy={busy} dashboard={dashboard} mutate={mutate} />
      ) : null}
      {view === "backups" && dashboard ? <Backups dashboard={dashboard} /> : null}
    </div>
  );
}

function Overview({ dashboard }: Readonly<{ dashboard: BrokerPaperDashboard }>) {
  const openOrders = dashboard.orders.filter((order) => !["CANCELLED", "FILLED", "REJECTED"].includes(order.status));
  const fills = dashboard.orders.flatMap((order) => order.executions);
  return (
    <>
      <div className="v17-kpis">
        <article><ClipboardCheck size={19} /><span>待审批建议</span><strong>{dashboard.proposals.filter((item) => item.status === "PENDING_APPROVAL").length}</strong><small>逐标的审批，不支持批量批准</small></article>
        <article><WalletCards size={19} /><span>未完成 Paper 订单</span><strong>{openOrders.length}</strong><small>含提交未知与部分成交</small></article>
        <article><History size={19} /><span>Broker Paper 成交</span><strong>{fills.length}</strong><small>独立账本，不写内部模拟账户</small></article>
        <article><AlertTriangle size={19} /><span>开放事故</span><strong>{dashboard.incidents.filter((item) => item.status === "OPEN").length}</strong><small>异常默认拒绝，保留 correlation ID</small></article>
      </div>
      <div className="v17-grid v17-grid--two">
        <Panel title="当前安全状态" description="服务端真实 BrokerExecutionControl">
          <dl className="v17-definition-list">
            <div><dt>运行状态</dt><dd className={statusTone(dashboard.control.safetyState)}>{dashboard.control.safetyState}</dd></div>
            <div><dt>Kill Switch</dt><dd className={statusTone(dashboard.control.killSwitchLevel)}>{dashboard.control.killSwitchLevel}</dd></div>
            <div><dt>Connector</dt><dd className={statusTone(dashboard.connector.health.status)}>{dashboard.connector.health.status}</dd></div>
            <div><dt>支持订单</dt><dd>{dashboard.supportedOrderTypes.join(" / ")}</dd></div>
          </dl>
        </Panel>
        <Panel title="账本隔离证明" description="由后端固定安全断言生成">
          <div className="v18-isolation">
            <span><CheckCircle2 size={17} /> Broker Paper 专用表：{dashboard.isolation.brokerPaperTablesOnly ? "是" : "否"}</span>
            <span><CheckCircle2 size={17} /> 内部 Paper 不变：{dashboard.isolation.internalPaperUnchanged ? "是" : "否"}</span>
            <span><CheckCircle2 size={17} /> Shadow 不变：{dashboard.isolation.shadowUnchanged ? "是" : "否"}</span>
            <span className={dashboard.isolation.liveAccountWrites ? "is-danger" : "is-success"}><Ban size={17} /> Live 写入：{dashboard.isolation.liveAccountWrites ? "检测到" : "禁止"}</span>
          </div>
        </Panel>
      </div>
    </>
  );
}

function Approvals({ busy, dashboard, mutate }: Readonly<{ busy: boolean; dashboard: BrokerPaperDashboard; mutate: (action: () => Promise<unknown>, success: string) => Promise<void> }>) {
  if (!dashboard.proposals.length) return <EmptyState text="尚未生成任何 Broker Paper 订单建议。" />;

  function decide(proposal: BrokerOrderProposalView, decision: "APPROVE" | "REJECT") {
    const expected = `${decision} IBKR PAPER ${proposal.symbol}`;
    const confirmationText = window.prompt(`请输入“${expected}”以确认此标的：`);
    if (confirmationText !== expected) return;
    void mutate(
      () => postJson(`/paper-execution/proposals/${proposal.id}/decision`, { actorId: "local-operator", confirmationText, decision, reason: decision === "APPROVE" ? "人工核对建议快照、风险结果与有效期后批准" : "人工审查后拒绝此建议" }),
      `${proposal.symbol} 建议已${decision === "APPROVE" ? "批准" : "拒绝"}并写入审计。`,
    );
  }

  function submit(proposal: BrokerOrderProposalView) {
    const expected = `SEND IBKR PAPER ${proposal.symbol}`;
    const confirmationText = window.prompt(`发送前请再次输入“${expected}”：`);
    if (confirmationText !== expected) return;
    void mutate(
      () => postJson(`/paper-execution/proposals/${proposal.id}/submit`, { actorId: "local-operator", confirmationText, isClosing: proposal.side === "SELL" }),
      `${proposal.symbol} 已通过 Paper 提交门禁。`,
    );
  }

  return (
    <Panel title="订单建议与人工决定" description="原始建议、风控快照和审批历史均不可覆盖">
      <div className="table-wrap">
        <table className="data-table v17-table">
          <thead><tr><th>标的 / 方向</th><th>订单</th><th>预计金额 / 费用</th><th>Risk Budget / 隔夜</th><th>状态</th><th>风控</th><th>审批</th><th>操作</th></tr></thead>
          <tbody>{dashboard.proposals.map((proposal) => {
            const latestApproval = proposal.approvals[0];
            const guard = proposal.guardDecisions[0];
            const snapshot = proposalSnapshot(proposal).snapshot;
            const annualProfitProtection = snapshot?.riskResult?.alerts?.some((alert) => alert.code === "ANNUAL_PROFIT_PROTECTION") ?? false;
            return <tr key={proposal.id}>
              <td><b>{proposal.symbol}</b><br /><small>{proposal.side} · 策略 {proposal.strategyId ?? "—"}</small><br /><small>部署 {proposal.strategyDeploymentId ?? "—"} · v{proposal.strategyVersion}</small></td>
              <td>{proposal.orderType} · {proposal.quantity}<br /><small>{proposal.limitPrice ? money(proposal.limitPrice) : "无指定限价"} · {proposal.timeInForce}</small><br /><small>盘外 {proposal.outsideRth ? "是" : "否"} · 部分成交 {proposal.allowPartialFill ? "允许" : "禁止"} · 最大滑点 {proposal.maxSlippage}</small></td>
              <td>{money(proposal.estimatedValue)}<br /><small>估算费用 {money(proposal.estimatedCommission)}</small></td>
              <td>{proposal.plannedLoss === null ? "BLOCK / 未计算" : money(proposal.plannedLoss)}<br /><small>{proposal.plannedLossPct === null ? "无风险百分比" : `${proposal.plannedLossPct.toFixed(3)}%`} · 计划 Stop {proposal.plannedStopPrice ? money(proposal.plannedStopPrice) : "缺失"}</small><br /><small>隔夜 {proposal.allowOvernight === true ? "预先允许且需 Gap Stress" : proposal.allowOvernight === false ? "禁止" : "未声明"}</small></td>
              <td><span className={`v17-status ${statusTone(proposal.status)}`}>{proposal.status}</span><br /><small>过期 {dateTime(proposal.expirationTime)}</small></td>
              <td className={statusTone(guard?.decision ?? "PENDING")}><b>{guard?.decision ?? "待运行"}</b><br /><small>单策略 {snapshot?.riskApproved ? "通过" : "拒绝/未知"} · 组合 {snapshot?.portfolioRiskApproved ? "通过" : proposal.portfolioId ? "拒绝/未知" : "不适用"}</small><br /><small>年度利润保护 {annualProfitProtection ? "已触发" : "未触发"} · 数据质量 {snapshot?.dataQualityPassed ? "通过" : "拒绝/未知"}</small><br /><small>行情 {dateTime(guard?.marketDataTime ?? snapshot?.marketDataTime)} · 账户 {dateTime(guard?.accountSnapshotTime ?? snapshot?.accountSnapshotTime)}</small></td>
              <td>{latestApproval?.decision ?? "待决定"}<br /><small>{latestApproval ? `${latestApproval.actorId} · ${dateTime(latestApproval.createdAt)}` : "—"}</small></td>
              <td><div className="v17-row-actions">
                <button disabled={busy || proposal.status !== "WAITING_APPROVAL"} onClick={() => decide(proposal, "APPROVE")} type="button">批准</button>
                <button className="is-danger-button" disabled={busy || proposal.status !== "WAITING_APPROVAL"} onClick={() => decide(proposal, "REJECT")} type="button">拒绝</button>
                <button disabled={busy || proposal.status !== "APPROVED"} onClick={() => submit(proposal)} type="button"><Send size={13} />发送 Paper</button>
              </div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </Panel>
  );
}

function Orders({ busy, dashboard, mutate }: Readonly<{ busy: boolean; dashboard: BrokerPaperDashboard; mutate: (action: () => Promise<unknown>, success: string) => Promise<void> }>) {
  if (!dashboard.orders.length) return <EmptyState text="尚无真实 Broker Paper 订单。" />;
  function confirmBrokerReply(order: BrokerPaperOrderView) {
    const messages = brokerReplyMessages(order);
    if (!order.brokerReplyId || !messages.length) return;
    const expected = `CONFIRM IBKR WARNING ${order.symbol}`;
    const warningText = messages.map((message, index) => `${index + 1}. ${message}`).join("\n");
    const confirmationText = window.prompt(
      `IBKR 返回以下警告，只有理解并接受后才能继续：\n\n${warningText}\n\n请输入“${expected}”确认：`,
    );
    if (confirmationText !== expected) return;
    void mutate(
      () => postJson(`/paper-execution/orders/${order.id}/confirm-broker-reply`, { actorId: "local-operator", confirmationText }),
      `${order.symbol} 的 IBKR 警告已人工确认，已重新读取券商返回状态。`,
    );
  }
  function cancel(order: BrokerPaperOrderView) {
    const expected = `CANCEL IBKR PAPER ${order.symbol}`;
    const confirmationText = window.prompt(`请输入“${expected}”撤销此 Paper 订单：`);
    if (confirmationText !== expected) return;
    void mutate(() => postJson(`/paper-execution/orders/${order.id}/cancel`, { actorId: "local-operator", confirmationText, reason: "人工审查后撤销未完成 Paper 订单" }), `${order.symbol} 撤单请求已审计。`);
  }
  return (
    <>
      <div className="v17-actions">
        <button disabled={busy} onClick={() => void mutate(() => postJson("/paper-execution/sync"), "Paper 订单、成交与佣金已按外部 ID 幂等同步。") } type="button"><RefreshCw size={15} />同步订单</button>
        <button disabled={busy} onClick={() => void mutate(() => postJson("/paper-execution/recover"), "恢复流程已先查询与对账；不会盲目重提失败订单。") } type="button"><ArchiveRestore size={15} />安全恢复</button>
        <small>SUBMISSION_UNKNOWN 必须查询券商状态后人工处置，绝不直接重试。</small>
      </div>
      <Panel title="Paper 订单生命周期">
        <div className="table-wrap"><table className="data-table v17-table">
          <thead><tr><th>订单</th><th>券商 ID</th><th>数量</th><th>成交</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead>
          <tbody>{dashboard.orders.map((order) => <tr key={order.id}>
            <td><b>{order.symbol} · {order.side}</b><br /><small>{order.orderType} {order.limitPrice ? `@ ${money(order.limitPrice)}` : ""}</small></td>
            <td>{order.externalOrderId ?? "尚未取得"}<br /><small>{order.correlationId.slice(0, 14)}</small></td>
            <td>{order.quantity}<br /><small>剩余 {order.remainingQuantity}</small></td>
            <td>{order.filledQuantity}<br /><small>均价 {money(order.averageFillPrice)}</small></td>
            <td><span className={`v17-status ${statusTone(order.status)}`}>{order.status}</span><br /><small>{order.errorMessage ?? "—"}</small>{order.status === "BROKER_CONFIRMATION_REQUIRED" ? <><br /><small>{brokerReplyMessages(order).join("；")}</small></> : null}</td>
            <td>{dateTime(order.updatedAt)}<br /><small>{order.events.length} 个状态事件</small></td>
            <td><div className="v17-row-actions">
              {order.status === "BROKER_CONFIRMATION_REQUIRED" ? <button disabled={busy || !order.brokerReplyId || !brokerReplyMessages(order).length} onClick={() => confirmBrokerReply(order)} type="button"><AlertTriangle size={13} />阅读并确认 IBKR 警告</button> : null}
              <button className="is-danger-button" disabled={busy || !order.externalOrderId || ["BROKER_CONFIRMATION_REQUIRED", "CANCELLED", "FILLED", "REJECTED"].includes(order.status)} onClick={() => cancel(order)} type="button">撤销 Paper</button>
            </div></td>
          </tr>)}</tbody>
        </table></div>
      </Panel>
    </>
  );
}

function Executions({ dashboard }: Readonly<{ dashboard: BrokerPaperDashboard }>) {
  const rows = dashboard.orders.flatMap((order) => order.executions.map((execution) => ({ execution, order })));
  if (!rows.length) return <EmptyState text="尚无从 IBKR Paper 回写的成交。" />;
  return <Panel title="成交与佣金明细" description="部分成交与多次成交不会被合并丢失">
    <div className="table-wrap"><table className="data-table v17-table">
      <thead><tr><th>标的</th><th>Execution ID</th><th>数量 / 价格</th><th>时间 / 交易所</th><th>佣金</th><th>已实现盈亏</th></tr></thead>
      <tbody>{rows.map(({ execution, order }) => {
        const commission = execution.commissions.reduce((sum, item) => sum + Number(item.amount), 0);
        const realized = execution.commissions.reduce((sum, item) => sum + Number(item.realizedPnl ?? 0), 0);
        return <tr key={execution.id}><td><b>{execution.symbol}</b><br /><small>{execution.side} · 订单 {order.externalOrderId ?? "—"}</small></td><td>{execution.externalExecutionId ?? "业务哈希去重"}</td><td>{execution.quantity} @ {money(execution.price, execution.currency)}</td><td>{dateTime(execution.executionTime)}<br /><small>{execution.exchange}</small></td><td>{money(commission, execution.currency)}</td><td className={realized < 0 ? "is-danger" : "is-success"}>{money(realized, execution.currency)}</td></tr>;
      })}</tbody>
    </table></div>
  </Panel>;
}

function Reconciliation({ busy, dashboard, mutate }: Readonly<{ busy: boolean; dashboard: BrokerPaperDashboard; mutate: (action: () => Promise<unknown>, success: string) => Promise<void> }>) {
  if (!dashboard.reconciliations.length) return <EmptyState text="尚无 Paper 订单对账运行。" />;
  return <>
    <div className="v17-actions"><button disabled={busy} onClick={() => void mutate(() => postJson("/paper-execution/sync"), "同步和订单级对账已完成。") } type="button"><RefreshCw size={15} />执行同步与对账</button></div>
    {dashboard.reconciliations.map((run) => <Panel key={run.id} title={`${run.status} · ${dateTime(run.startedAt)}`} description={`差异 ${run.differenceCount} · 严重差异 ${run.criticalDifferenceCount}`}>
      {run.differences.length ? <div className="table-wrap"><table className="data-table v17-table"><thead><tr><th>级别</th><th>类型 / 字段</th><th>券商值</th><th>本地值</th><th>原因</th><th>建议</th></tr></thead><tbody>{run.differences.map((difference) => <tr key={difference.id}><td className={statusTone(difference.severity)}>{difference.severity}</td><td>{difference.differenceType}<br /><small>{difference.fieldName}</small></td><td>{difference.brokerValue ?? "—"}</td><td>{difference.localValue ?? "—"}</td><td>{difference.reason}</td><td>{difference.suggestedAction}<br /><small>{difference.status}</small></td></tr>)}</tbody></table></div> : <p className="v18-matched"><CheckCircle2 size={17} />券商状态、成交与本地 Broker Paper 专用账本一致。</p>}
    </Panel>)}
  </>;
}

function Monitor({ monitor }: Readonly<{ monitor: BrokerExecutionMonitor }>) {
  const cards: Array<[string, string, string]> = [
    ["Broker Connector", monitor.brokerConnector.health.status, monitor.brokerConnector.health.message ?? "Paper 能力实时校验"],
    ["SQL Server", monitor.database.status, `${monitor.database.latencyMs} ms`],
    ["Quant Engine", monitor.quantEngine.status, "策略与组合计算依赖"],
    ["API 延迟", `${monitor.apiLatencyMs} ms`, "本次监控聚合请求"],
    ["Connector 延迟", `${monitor.brokerConnector.health.latencyMs ?? "—"} ms`, `心跳 ${dateTime(monitor.ibkrHeartbeatAt)}`],
    ["订单提交耗时", monitor.averageSubmissionLatencyMs === null ? "—" : `${monitor.averageSubmissionLatencyMs} ms`, `最近状态 ${dateTime(monitor.latestOrderStatusAt)}`],
    ["行情延迟", monitor.marketDataLatencyHours === null ? "—" : `${monitor.marketDataLatencyHours.toFixed(1)} h`, "最新 MarketDataDaily"],
    ["任务失败率", `${(monitor.taskFailureRate * 100).toFixed(1)}%`, "最近 24 小时 SystemTask"],
    ["请求错误率", `${(monitor.requestErrorRate * 100).toFixed(1)}%`, "最近 24 小时审计与事故"],
    ["安全模式", monitor.safetyState, monitor.killSwitchLevel],
    ["提交结果未知", String(monitor.submissionUnknown), "大于 0 时阻止重复提交"],
    ["开放对账差异", String(monitor.openReconciliationDifferences), "重大差异触发默认拒绝"],
    ["开放执行事故", String(monitor.executionIncidents), "按 correlation ID 追踪"],
  ];
  return <><div className="v17-service-grid">{cards.map(([label, value, note]) => <article key={label}><header><Activity size={17} /><b>{label}</b><em className={statusTone(value)}>{value}</em></header><dl><div><dt>说明</dt><dd>{note}</dd></div><div><dt>状态来源</dt><dd>实时 API</dd></div></dl></article>)}</div>{monitor.recentIncidents.length ? <Panel title="最近执行事故">{monitor.recentIncidents.map((incident) => <p className="v18-monitor-incident" key={`${incident.correlationId}-${incident.occurredAt}`}><b className={statusTone(incident.severity)}>{incident.severity} · {incident.incidentType}</b><span>{incident.impact}</span><small>{dateTime(incident.occurredAt)} · {incident.correlationId}</small></p>)}</Panel> : null}</>;
}

function Incidents({ dashboard }: Readonly<{ dashboard: BrokerPaperDashboard }>) {
  if (!dashboard.incidents.length) return <EmptyState text="当前没有执行事故。" />;
  return <Panel title="执行事故台账" description="事故记录不能从展示层隐藏">
    <div className="table-wrap"><table className="data-table v17-table"><thead><tr><th>级别 / 状态</th><th>事故类型</th><th>影响</th><th>处置</th><th>Correlation ID</th><th>发生时间</th></tr></thead><tbody>{dashboard.incidents.map((incident) => <tr key={`${incident.correlationId}-${incident.occurredAt}`}><td className={statusTone(incident.severity)}>{incident.severity}<br /><small>{incident.status}</small></td><td>{incident.incidentType}</td><td>{incident.impact}</td><td>{incident.actionTaken ?? "等待人工调查"}</td><td><small>{incident.correlationId}</small></td><td>{dateTime(incident.occurredAt)}</td></tr>)}</tbody></table></div>
  </Panel>;
}

function Security({ busy, dashboard, mutate }: Readonly<{ busy: boolean; dashboard: BrokerPaperDashboard; mutate: (action: () => Promise<unknown>, success: string) => Promise<void> }>) {
  function configure(enabled: boolean) {
    const expected = enabled ? "ENABLE IBKR PAPER" : "DISABLE IBKR PAPER";
    const confirmationText = window.prompt(`请输入“${expected}”：`);
    if (confirmationText !== expected) return;
    void mutate(
      () => patchJson("/paper-execution/configuration", { actorId: "local-operator", confirmationText, enabled, reason: enabled ? "人工确认 Paper Gateway、账户类型与哈希白名单后启用" : "人工停止 Broker Paper 执行" }),
      enabled ? "IBKR Paper 专用执行已启用；Live 写能力仍为 false。" : "Broker Paper 执行已恢复为 OFFLINE。",
    );
  }
  function changeLevel(level: string) {
    const expected = `SET ${level}`;
    const confirmationText = window.prompt(`安全操作将写入审计。请输入“${expected}”：`);
    if (confirmationText !== expected) return;
    void mutate(() => patchJson("/paper-execution/kill-switch", { actorId: "local-operator", confirmationText, level, reason: "人工执行 V1.8 Paper Kill Switch 安全操作" }), `Kill Switch 已更新为 ${level}。`);
  }
  const capabilities = Object.entries(dashboard.connector.capabilities);
  return <>
    <div className="v17-grid v17-grid--two">
      <Panel title="双重环境与账户门禁" description="API 与 Broker Connector 必须同时确认 Paper">
        <dl className="v17-definition-list">
          <div><dt>安全状态</dt><dd>{dashboard.control.safetyState}</dd></div>
          <div><dt>运行模式</dt><dd>{dashboard.configuration?.runMode ?? "UNKNOWN"}</dd></div>
          <div><dt>Connector 环境</dt><dd>{dashboard.configuration?.environment ?? "UNKNOWN"}</dd></div>
          <div><dt>Kill Switch</dt><dd className={statusTone(dashboard.control.killSwitchLevel)}>{dashboard.control.killSwitchLevel}</dd></div>
          <div><dt>Paper 账户</dt><dd>{dashboard.accounts.map((item) => item.maskedAccountNumber).join(" / ") || "未配置"}</dd></div>
          <div><dt>最近变更</dt><dd>{dateTime(dashboard.control.updatedAt)}</dd></div>
        </dl>
      </Panel>
      <Panel title="Connector 能力白名单" description="Live 能力必须始终为 false">
        <div className="v17-capabilities">{capabilities.map(([name, enabled]) => <span className={enabled ? "is-enabled" : "is-disabled"} key={name}>{enabled ? <CheckCircle2 size={15} /> : <Ban size={15} />}<b>{name}</b><em>{enabled ? "允许" : "禁止"}</em></span>)}</div>
      </Panel>
    </div>
    <Panel title="Paper 执行显式启停" description="启用时后端会再次验证 Connector 能力、健康、唯一 Paper 账户及哈希白名单">
      <div className="v17-actions">
        <button disabled={busy || dashboard.configuration?.runMode === "IBKR_PAPER"} onClick={() => configure(true)} type="button">启用 IBKR PAPER</button>
        <button className="is-danger-button" disabled={busy || dashboard.configuration?.runMode !== "IBKR_PAPER"} onClick={() => configure(false)} type="button">恢复 OFFLINE</button>
        <small>环境变量必须先由操作者在本机安全配置；页面不接收或保存券商凭证。</small>
      </div>
    </Panel>
    <Panel title="五级 Paper Kill Switch" description="LEVEL 2 会撤销未成交 Paper 订单；LEVEL 3 只生成平仓建议，仍需人工审批">
      <div className="v18-kill-grid">
        {["LEVEL_0_NORMAL", "LEVEL_1_NO_NEW_ENTRY", "LEVEL_2_CANCEL_OPEN_ORDERS", "LEVEL_3_CLOSE_PAPER_POSITIONS", "LEVEL_4_LOCKDOWN"].map((level) => <button className={dashboard.control.killSwitchLevel === level ? "is-current" : ""} disabled={busy} key={level} onClick={() => changeLevel(level)} type="button"><LockKeyhole size={15} />{level}</button>)}
      </div>
    </Panel>
  </>;
}

function Backups({ dashboard }: Readonly<{ dashboard: BrokerPaperDashboard }>) {
  if (!dashboard.backups.length) return <EmptyState text="尚无数据库备份或恢复演练记录；请运行受控运维脚本。" />;
  return <>
    <div className="v18-backup-notice"><DatabaseBackup size={19} /><span><b>页面不触发数据库恢复</b><small>备份和恢复只能由本机或服务器受控脚本执行，成功后才写入此审计表。</small></span></div>
    <Panel title="备份与恢复演练历史">
      <div className="table-wrap"><table className="data-table v17-table"><thead><tr><th>操作</th><th>目标数据库</th><th>状态</th><th>操作者</th><th>开始 / 完成</th><th>校验 / 错误</th></tr></thead><tbody>{dashboard.backups.map((run) => <tr key={run.id}><td>{run.operation}</td><td>{run.targetDatabase}</td><td className={statusTone(run.status)}>{run.status}</td><td>{run.actorId}</td><td>{dateTime(run.startedAt)}<br /><small>{dateTime(run.completedAt)}</small></td><td><small>{run.errorMessage ?? run.verificationJson ?? "—"}</small></td></tr>)}</tbody></table></div>
    </Panel>
  </>;
}
