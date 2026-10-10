"use client";

import {
  Activity,
  Ban,
  Cable,
  CheckCircle2,
  CircleAlert,
  Database,
  Eye,
  FileClock,
  Gauge,
  History,
  LoaderCircle,
  Play,
  RefreshCw,
  Scale,
  Server,
  ServerCrash,
  ShieldAlert,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { getJson, postJson } from "@/lib/api-client";
import type {
  BrokerDashboard,
  BrokerSyncJobView,
  ReconciliationDifferenceView,
  ServiceStatusView,
} from "@/lib/broker-types";
import { formatCurrency, formatPercent } from "@/lib/formatters";

export type BrokerWorkspaceView =
  "accounts" | "connections" | "readiness" | "reconciliation" | "services" | "shadow" | "sync";

const pageCopy: Record<BrokerWorkspaceView, { description: string; title: string }> = {
  accounts: {
    description: "只读券商快照与本地真实账户双向隔离；账户号码仅显示不可逆映射后的掩码",
    title: "IBKR 账户",
  },
  connections: {
    description: "独立 Broker Connector 仅开放读取能力，不包含下单、改单或撤单接口",
    title: "券商连接",
  },
  readiness: {
    description: "依据策略验证、模拟观察、影子记录、任务稳定性、对账和审计数据计算",
    title: "实盘准备度",
  },
  reconciliation: {
    description: "券商只读快照与本地账户逐项比对；未经人工确认不会覆盖本地真实数据",
    title: "账户对账",
  },
  services: {
    description: "Web、API、Quant Engine、Broker Connector、数据库与关键数据链路统一监控",
    title: "服务状态",
  },
  shadow: {
    description: "使用真实账户快照生成理论订单；独立影子账本不会发送任何券商请求",
    title: "影子交易",
  },
  sync: {
    description: "只读拉取账户、现金、持仓、成交、订单快照和公司行动，保留完整历史",
    title: "账户同步",
  },
};

function dateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
}

function tone(status: string) {
  const normalized = status.toUpperCase();
  if (["COMPLETED", "CONNECTED", "CURRENT", "MATCHED", "OK"].includes(normalized)) {
    return "is-success";
  }
  if (
    ["CRITICAL", "DANGER", "FAILED", "LOCKDOWN", "OFFLINE", "RISK_REJECTED"].includes(normalized)
  ) {
    return "is-danger";
  }
  if (["STALE", "WARNING", "DIFFERENCES_FOUND", "OBSERVING"].includes(normalized)) {
    return "is-warning";
  }
  return "";
}

export function BrokerWorkspace({ view }: Readonly<{ view: BrokerWorkspaceView }>) {
  const [dashboard, setDashboard] = useState<BrokerDashboard | null>(null);
  const [services, setServices] = useState<ServiceStatusView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (view === "services") {
        setServices(await getJson<ServiceStatusView>("/broker/services?refresh=true"));
      } else {
        setDashboard(await getJson<BrokerDashboard>("/broker/dashboard"));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "V1.7 Broker API 不可用");
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
      setError(reason instanceof Error ? reason.message : "Broker 操作失败");
    } finally {
      setBusy(false);
    }
  }

  const staleAccounts = useMemo(
    () => dashboard?.accounts.filter((account) => account.stale) ?? [],
    [dashboard],
  );
  const copy = pageCopy[view];

  return (
    <div className="v17-workspace" data-testid={`broker-page-${view}`}>
      <PageHeader description={copy.description} title={copy.title} />
      <div className="v17-disclaimer">
        <ShieldCheck size={18} />
        <b>只读安全边界</b>
        <span>本系统当前不具备实盘自动下单能力。</span>
        <em>券商写请求：0</em>
      </div>
      {error ? (
        <div className="service-error" role="alert">
          <ServerCrash size={18} />
          <span>{error}</span>
          <button onClick={() => void refresh()} type="button">
            重试
          </button>
        </div>
      ) : null}
      {message ? <p className="quant-message">{message}</p> : null}
      {loading && !dashboard && !services ? (
        <div className="detail-loading" data-testid="broker-loading">
          <LoaderCircle className="spin" size={22} />
          正在读取 SQL Server 与只读连接状态…
        </div>
      ) : null}
      {view !== "services" && staleAccounts.length > 0 ? (
        <div className="v17-stale-banner">
          <CircleAlert size={18} />
          <span>
            {staleAccounts.length} 个账户快照已过期；最后数据时间为{" "}
            {dateTime(staleAccounts[0]?.lastSyncedAt)}。 影子任务将安全跳过，不会伪造最新数据。
          </span>
        </div>
      ) : null}

      {view === "connections" && dashboard ? (
        <ConnectionsView
          busy={busy}
          dashboard={dashboard}
          onRefresh={() =>
            void mutate(() => getJson("/broker/status"), "连接状态已刷新；只读能力声明已重新校验。")
          }
        />
      ) : null}
      {view === "accounts" && dashboard ? <AccountsView dashboard={dashboard} /> : null}
      {view === "sync" && dashboard ? (
        <SyncView
          busy={busy}
          dashboard={dashboard}
          onCancel={(job) =>
            void mutate(
              () => postJson(`/broker/sync/${job.id}/cancel`),
              "尚未开始的只读同步任务已取消。",
            )
          }
          onRetry={(job) =>
            void mutate(
              () => postJson(`/broker/sync/${job.id}/retry`),
              "失败任务已使用原记录安全重试。",
            )
          }
          onSync={() =>
            void mutate(
              () => postJson("/broker/sync", {}),
              "只读同步已执行；OFFLINE 模式会记录为安全跳过。",
            )
          }
        />
      ) : null}
      {view === "reconciliation" && dashboard ? (
        <ReconciliationView
          busy={busy}
          dashboard={dashboard}
          onDecision={(difference, decision) => {
            if (
              decision === "CONFIRMED_BROKER" &&
              !window.confirm("接受券商值会创建有审计的本地调整。确认继续？")
            ) {
              return;
            }
            void mutate(
              () =>
                postJson(`/broker/reconciliation/differences/${difference.id}/decision`, {
                  decision,
                  operatorId: "local-admin",
                  reason:
                    decision === "CONFIRMED_BROKER"
                      ? "用户在 V1.7 对账页人工确认接受券商值"
                      : "用户在 V1.7 对账页人工确认保留本地值",
                }),
              "差异决定、原值、新值、操作人和原因已写入同一事务并重算 RiskEngine。",
            );
          }}
          onRun={(accountId) =>
            void mutate(
              () => postJson("/broker/reconciliation", { brokerAccountId: accountId }),
              "账户对账已完成；任何差异都保持 OPEN，等待人工确认。",
            )
          }
        />
      ) : null}
      {view === "shadow" && dashboard ? (
        <ShadowView
          busy={busy}
          dashboard={dashboard}
          onProcess={() =>
            void mutate(
              () => postJson("/broker/shadow/fills/process"),
              "影子撮合已检查；未创建任何券商请求。",
            )
          }
          onVerifyMuu={(accountId) =>
            void mutate(
              () =>
                postJson("/broker/shadow/intents", {
                  brokerAccountId: accountId,
                  quantity: 10,
                  side: "BUY",
                  signalDate: new Date().toISOString(),
                  symbol: "MUU",
                  theoreticalPrice: 150,
                }),
              "MUU 影子信号已检查；离线、过期或风险超限时会安全跳过/拒绝。",
            )
          }
        />
      ) : null}
      {view === "readiness" && dashboard ? <ReadinessView dashboard={dashboard} /> : null}
      {view === "services" && services ? (
        <ServicesView busy={busy} data={services} onRefresh={() => void refresh()} />
      ) : null}
      {!loading && view !== "services" && !dashboard && !error ? (
        <div className="empty-state">没有可展示的券商数据</div>
      ) : null}
    </div>
  );
}

function ConnectionsView({
  busy,
  dashboard,
  onRefresh,
}: Readonly<{ busy: boolean; dashboard: BrokerDashboard; onRefresh: () => void }>) {
  const connection = dashboard.connection;
  return (
    <>
      <div className="v17-actions">
        <button disabled={busy} onClick={onRefresh} type="button">
          {busy ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
          刷新连接状态
        </button>
        <small>默认 OFFLINE / READ_ONLY；运行模式只能在系统设置中由用户手动切换。</small>
      </div>
      <div className="v17-kpis">
        <article>
          <Cable size={18} />
          <span>连接状态</span>
          <strong className={tone(connection.status)}>{connection.status}</strong>
          <small>{connection.provider}</small>
        </article>
        <article>
          <ShieldCheck size={18} />
          <span>安全状态</span>
          <strong className={tone(connection.safetyState)}>{connection.safetyState}</strong>
          <small>{connection.runMode}</small>
        </article>
        <article>
          <Activity size={18} />
          <span>最后心跳</span>
          <strong>{dateTime(connection.lastHeartbeatAt)}</strong>
          <small>Connector 5092</small>
        </article>
        <article>
          <Database size={18} />
          <span>最后同步</span>
          <strong>{dateTime(connection.lastSyncAt)}</strong>
          <small>旧快照始终保留</small>
        </article>
      </div>
      <section className="v17-grid v17-grid--two">
        <Panel description={connection.connectorUrl} title={connection.displayName}>
          <dl className="v17-definition-list">
            <div>
              <dt>环境</dt>
              <dd>{connection.environment}</dd>
            </div>
            <div>
              <dt>自动对账</dt>
              <dd>{connection.autoReconciliation ? "启用" : "停用"}</dd>
            </div>
            <div>
              <dt>影子交易</dt>
              <dd>{connection.shadowTradingEnabled ? "启用" : "停用"}</dd>
            </div>
            <div>
              <dt>数据过期阈值</dt>
              <dd>{connection.staleAfterSeconds} 秒</dd>
            </div>
            <div>
              <dt>最近错误</dt>
              <dd className="is-danger">{connection.lastErrorMessage ?? "无"}</dd>
            </div>
          </dl>
        </Panel>
        <Panel
          description="三项写能力在类型、运行时与源码扫描中均强制为 false"
          title="Provider 能力"
        >
          <div className="v17-capabilities">
            {Object.entries(connection.capabilities).map(([key, enabled]) => (
              <span className={enabled ? "is-enabled" : "is-disabled"} key={key}>
                {enabled ? <CheckCircle2 size={15} /> : <Ban size={15} />}
                <b>{key}</b>
                <em>{enabled ? "允许" : "禁止"}</em>
              </span>
            ))}
          </div>
        </Panel>
      </section>
      <AuditPanel dashboard={dashboard} />
    </>
  );
}

function AccountsView({ dashboard }: Readonly<{ dashboard: BrokerDashboard }>) {
  if (dashboard.accounts.length === 0) {
    return (
      <div className="empty-state">
        <WalletCards size={20} />
        尚未同步任何只读券商账户
      </div>
    );
  }
  return (
    <>
      {dashboard.accounts.map((account) => (
        <section className="v17-account" key={account.id}>
          <header>
            <span>
              <WalletCards size={20} />
              <b>{account.maskedAccountNumber}</b>
              <small>
                {account.accountType} · {account.baseCurrency}
              </small>
            </span>
            <em className={tone(account.status)}>{account.status}</em>
          </header>
          <div className="v17-kpis">
            <article>
              <span>总权益</span>
              <strong>{formatCurrency(account.snapshot?.netLiquidation ?? 0)}</strong>
              <small>快照 {dateTime(account.snapshot?.snapshotTime)}</small>
            </article>
            <article>
              <span>现金</span>
              <strong>{formatCurrency(account.snapshot?.totalCash ?? 0)}</strong>
              <small>已结算 {formatCurrency(account.snapshot?.settledCash ?? 0)}</small>
            </article>
            <article>
              <span>持仓市值</span>
              <strong>{formatCurrency(account.snapshot?.grossPositionValue ?? 0)}</strong>
              <small>{account.positionSnapshots.length} 条持仓快照</small>
            </article>
            <article>
              <span>未实现盈亏</span>
              <strong
                className={(account.snapshot?.unrealizedPnl ?? 0) < 0 ? "is-danger" : "is-success"}
              >
                {formatCurrency(account.snapshot?.unrealizedPnl ?? 0)}
              </strong>
              <small>只读券商值</small>
            </article>
          </div>
          <Panel
            description="每次同步按账户、标的和快照时间保留历史，不覆盖本地 Position"
            title="最新持仓快照"
          >
            <div className="table-scroll">
              <table className="data-table v17-table">
                <thead>
                  <tr>
                    <th>标的</th>
                    <th>数量</th>
                    <th>平均成本</th>
                    <th>市场价</th>
                    <th>市值</th>
                    <th>未实现盈亏</th>
                    <th>映射</th>
                    <th>快照时间</th>
                  </tr>
                </thead>
                <tbody>
                  {account.positionSnapshots.map((position) => (
                    <tr key={position.id}>
                      <td>
                        <b>{position.symbol}</b>
                      </td>
                      <td>{position.quantity}</td>
                      <td>{formatCurrency(position.averageCost)}</td>
                      <td>{formatCurrency(position.marketPrice)}</td>
                      <td>{formatCurrency(position.marketValue)}</td>
                      <td className={position.unrealizedPnl < 0 ? "is-danger" : "is-success"}>
                        {formatCurrency(position.unrealizedPnl)}
                      </td>
                      <td>{position.mappingStatus}</td>
                      <td>{dateTime(position.snapshotTime)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {account.positionSnapshots.length === 0 ? (
              <div className="empty-state">当前快照没有持仓</div>
            ) : null}
          </Panel>
        </section>
      ))}
    </>
  );
}

function SyncView({
  busy,
  dashboard,
  onCancel,
  onRetry,
  onSync,
}: Readonly<{
  busy: boolean;
  dashboard: BrokerDashboard;
  onCancel: (job: BrokerSyncJobView) => void;
  onRetry: (job: BrokerSyncJobView) => void;
  onSync: () => void;
}>) {
  return (
    <>
      <div className="v17-actions">
        <button className="primary-button" disabled={busy} onClick={onSync} type="button">
          {busy ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}手动只读同步
        </button>
        <small>支持指定范围、失败重试和稳定幂等；同步失败不会删除上次成功数据。</small>
      </div>
      <Panel
        description="PENDING → CONNECTING → FETCHING → VALIDATING → PERSISTING → RECONCILING"
        title="同步任务"
      >
        <div className="table-scroll">
          <table className="data-table v17-table">
            <thead>
              <tr>
                <th>创建时间</th>
                <th>状态</th>
                <th>范围</th>
                <th>账户/快照</th>
                <th>持仓/成交/订单</th>
                <th>重试</th>
                <th>错误</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.syncJobs.map((job) => (
                <tr key={job.id}>
                  <td>{dateTime(job.createdAt)}</td>
                  <td>
                    <em className={`v17-status ${tone(job.status)}`}>{job.status}</em>
                  </td>
                  <td>
                    {dateTime(job.requestedFrom)}
                    <small className="v15-cell-note">至 {dateTime(job.requestedTo)}</small>
                  </td>
                  <td>
                    {job.accountCount} / {job.snapshotCount}
                  </td>
                  <td>
                    {job.positionCount} / {job.executionCount} / {job.orderCount}
                  </td>
                  <td>{job.retryCount}</td>
                  <td className="is-danger">{job.errorMessage ?? "—"}</td>
                  <td>
                    <span className="v17-row-actions">
                      {job.status === "FAILED" ? (
                        <button disabled={busy} onClick={() => onRetry(job)} type="button">
                          重试
                        </button>
                      ) : null}
                      {job.status === "PENDING" ? (
                        <button disabled={busy} onClick={() => onCancel(job)} type="button">
                          取消
                        </button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {dashboard.syncJobs.length === 0 ? (
          <div className="empty-state">
            <History size={18} />
            尚无同步任务
          </div>
        ) : null}
      </Panel>
      <AuditPanel dashboard={dashboard} />
    </>
  );
}

function ReconciliationView({
  busy,
  dashboard,
  onDecision,
  onRun,
}: Readonly<{
  busy: boolean;
  dashboard: BrokerDashboard;
  onDecision: (
    difference: ReconciliationDifferenceView,
    decision: "CONFIRMED_BROKER" | "CONFIRMED_LOCAL",
  ) => void;
  onRun: (accountId: string) => void;
}>) {
  return (
    <>
      <div className="v17-actions">
        <button
          className="primary-button"
          disabled={busy || dashboard.accounts.length === 0}
          onClick={() => dashboard.accounts[0] && onRun(dashboard.accounts[0].id)}
          type="button"
        >
          <Scale size={15} />
          运行账户对账
        </button>
        <small>默认容差：金额 $1、价格 $0.01、数量 0.0001；不能用过大容差隐藏问题。</small>
      </div>
      {dashboard.reconciliationRuns.map((run) => (
        <Panel
          description={`${dateTime(run.completedAt)} · 券商快照 ${dateTime(run.brokerSnapshotTime)}`}
          key={run.id}
          title={`对账 ${run.status} · ${run.differenceCount} 项差异`}
        >
          <div className="table-scroll">
            <table className="data-table v17-table">
              <thead>
                <tr>
                  <th>类型/标的</th>
                  <th>字段</th>
                  <th>IBKR</th>
                  <th>本地</th>
                  <th>绝对差异</th>
                  <th>差异 %</th>
                  <th>严重度</th>
                  <th>状态</th>
                  <th>建议与人工处理</th>
                </tr>
              </thead>
              <tbody>
                {run.differences.map((difference) => (
                  <tr key={difference.id}>
                    <td>
                      <b>{difference.differenceType}</b>
                      <small className="v15-cell-note">{difference.symbol ?? "账户级"}</small>
                    </td>
                    <td>{difference.fieldName}</td>
                    <td>{difference.brokerValue ?? "—"}</td>
                    <td>{difference.localValue ?? "—"}</td>
                    <td>{difference.absoluteDifference ?? "—"}</td>
                    <td>
                      {difference.percentageDifference === null
                        ? "—"
                        : formatPercent(difference.percentageDifference)}
                    </td>
                    <td>
                      <em className={`v17-status ${tone(difference.severity)}`}>
                        {difference.severity}
                      </em>
                    </td>
                    <td>{difference.status}</td>
                    <td>
                      <p className="v17-suggestion">{difference.suggestedAction}</p>
                      {difference.status === "OPEN" ? (
                        <span className="v17-row-actions">
                          <button
                            disabled={busy}
                            onClick={() => onDecision(difference, "CONFIRMED_LOCAL")}
                            type="button"
                          >
                            保留本地
                          </button>
                          <button
                            className="is-danger-button"
                            disabled={busy}
                            onClick={() => onDecision(difference, "CONFIRMED_BROKER")}
                            type="button"
                          >
                            接受券商值
                          </button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {run.differences.length === 0 ? (
            <div className="empty-state">
              <CheckCircle2 size={18} />
              该次对账没有超出容差的差异
            </div>
          ) : null}
        </Panel>
      ))}
      {dashboard.reconciliationRuns.length === 0 ? (
        <div className="empty-state">
          <Scale size={18} />
          尚无账户对账记录
        </div>
      ) : null}
      <AuditPanel dashboard={dashboard} />
    </>
  );
}

function ShadowView({
  busy,
  dashboard,
  onProcess,
  onVerifyMuu,
}: Readonly<{
  busy: boolean;
  dashboard: BrokerDashboard;
  onProcess: () => void;
  onVerifyMuu: (accountId: string) => void;
}>) {
  return (
    <>
      <div className="v17-actions">
        <button
          disabled={busy || dashboard.accounts.length === 0}
          onClick={() => dashboard.accounts[0] && onVerifyMuu(dashboard.accounts[0].id)}
          type="button"
        >
          <ShieldAlert size={15} />
          验证 MUU 风控拒绝
        </button>
        <button className="primary-button" disabled={busy} onClick={onProcess} type="button">
          <Play size={15} />
          处理理论成交
        </button>
        <small>机会损益仅为历史模拟结果，不代表真实可获得收益。</small>
      </div>
      <div className="v17-kpis">
        <article>
          <Eye size={18} />
          <span>影子会话</span>
          <strong>{dashboard.shadowSessions.length}</strong>
          <small>独立 Shadow* 账本</small>
        </article>
        <article>
          <FileClock size={18} />
          <span>理论订单</span>
          <strong>
            {dashboard.shadowSessions.reduce((sum, item) => sum + item.orderIntents.length, 0)}
          </strong>
          <small>券商请求 0</small>
        </article>
        <article>
          <ShieldAlert size={18} />
          <span>风控拒绝</span>
          <strong className="is-danger">
            {
              dashboard.shadowSessions
                .flatMap((item) => item.orderIntents)
                .filter((item) => item.status === "RISK_REJECTED").length
            }
          </strong>
          <small>RiskEngine + PortfolioRiskEngine</small>
        </article>
        <article>
          <Activity size={18} />
          <span>影子成交</span>
          <strong>
            {dashboard.shadowSessions.reduce((sum, item) => sum + item.fills.length, 0)}
          </strong>
          <small>只使用后续真实行情</small>
        </article>
      </div>
      <Panel description="真实账户、Paper 账户和影子账户三套账本严格隔离" title="影子订单意图">
        <div className="table-scroll">
          <table className="data-table v17-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>标的</th>
                <th>方向</th>
                <th>数量</th>
                <th>理论价格</th>
                <th>状态</th>
                <th>风控结论</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.shadowSessions
                .flatMap((session) => session.orderIntents)
                .map((intent) => (
                  <tr key={intent.id}>
                    <td>{dateTime(intent.theoreticalOrderAt)}</td>
                    <td>
                      <b>{intent.symbol}</b>
                    </td>
                    <td>{intent.side}</td>
                    <td>{intent.quantity}</td>
                    <td>{formatCurrency(intent.theoreticalPrice)}</td>
                    <td>
                      <em className={`v17-status ${tone(intent.status)}`}>{intent.status}</em>
                    </td>
                    <td className="is-danger">
                      {intent.rejectionReason ?? "通过，只允许理论撮合"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {dashboard.shadowSessions.every((session) => session.orderIntents.length === 0) ? (
          <div className="empty-state">
            <Eye size={18} />
            尚无影子订单意图
          </div>
        ) : null}
      </Panel>
      <AuditPanel dashboard={dashboard} />
    </>
  );
}

function ReadinessView({ dashboard }: Readonly<{ dashboard: BrokerDashboard }>) {
  const readiness = dashboard.readiness;
  const cards = [
    ["单策略", readiness.strategy],
    ["策略组合", readiness.portfolio],
    ["系统基础设施", readiness.infrastructure],
  ] as const;
  return (
    <>
      <div className="v17-readiness-warning">
        <ShieldAlert size={22} />
        <span>
          <b>{readiness.statement}</b>
          <small>评分仅用于识别缺口，不会解锁 LIVE_READY 或 AUTO_TRADING_READY。</small>
        </span>
      </div>
      <div className="v17-readiness-cards">
        {cards.map(([label, value]) => (
          <article key={label}>
            <header>
              <Gauge size={20} />
              <span>{label}</span>
              <em className={tone(value.status)}>{value.status}</em>
            </header>
            <strong>
              {value.score}
              <small>/ 100</small>
            </strong>
            <div>
              <i style={{ width: `${Math.max(0, Math.min(100, value.score))}%` }} />
            </div>
          </article>
        ))}
      </div>
      <Panel
        description="使用 SQL Server 中真实的验证、模拟、任务、对账、影子和审计记录"
        title="评分维度"
      >
        <div className="v17-dimensions">
          {Object.entries(readiness.dimensions).map(([key, value]) => (
            <span key={key}>
              <small>{key}</small>
              <b>{String(value)}</b>
            </span>
          ))}
        </div>
        {Object.keys(readiness.dimensions).length === 0 ? (
          <div className="empty-state">当前没有足够的准备度评分数据</div>
        ) : null}
      </Panel>
    </>
  );
}

function ServicesView({
  busy,
  data,
  onRefresh,
}: Readonly<{ busy: boolean; data: ServiceStatusView; onRefresh: () => void }>) {
  return (
    <>
      <div className="v17-actions">
        <button disabled={busy} onClick={onRefresh} type="button">
          <RefreshCw size={15} />
          刷新全部健康检查
        </button>
        <small>错误信息经过脱敏；不会在页面展示认证信息或完整账户号码。</small>
      </div>
      <div className="v17-service-grid">
        {data.services.map((service) => (
          <article key={service.name}>
            <header>
              <Server size={18} />
              <b>{service.name}</b>
              <em className={tone(service.status)}>{service.status}</em>
            </header>
            <dl>
              <div>
                <dt>版本</dt>
                <dd>{service.version}</dd>
              </div>
              <div>
                <dt>响应耗时</dt>
                <dd>{service.latencyMs} ms</dd>
              </div>
              <div>
                <dt>数据更新时间</dt>
                <dd>{dateTime(service.dataUpdatedAt)}</dd>
              </div>
              <div>
                <dt>最近错误</dt>
                <dd className="is-danger">{service.lastError ?? "无"}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
      {data.services.length === 0 ? (
        <div className="empty-state">
          <Server size={18} />
          没有服务状态记录
        </div>
      ) : null}
      <section className="v17-grid v17-grid--three">
        <Panel description={dateTime(data.latestSync?.completedAt)} title="最新账户同步">
          <b className={tone(data.latestSync?.status ?? "")}>{data.latestSync?.status ?? "暂无"}</b>
        </Panel>
        <Panel description={dateTime(data.latestReconciliation?.completedAt)} title="最新账户对账">
          <b className={tone(data.latestReconciliation?.status ?? "")}>
            {data.latestReconciliation?.status ?? "暂无"}
          </b>
        </Panel>
        <Panel description={dateTime(data.latestShadow?.startedAt)} title="最新影子任务">
          <b className={tone(data.latestShadow?.status ?? "")}>
            {data.latestShadow?.status ?? "暂无"}
          </b>
        </Panel>
      </section>
    </>
  );
}

function AuditPanel({ dashboard }: Readonly<{ dashboard: BrokerDashboard }>) {
  return (
    <Panel
      description="同步、连接、对账人工决定、影子订单与安全状态变更均写入 SQL Server"
      title="Broker 审计日志"
    >
      <div className="v17-audit-list">
        {dashboard.auditLogs.slice(0, 20).map((log) => (
          <article key={log.id}>
            <span className={tone(log.severity)}>{log.severity}</span>
            <div>
              <b>{log.eventType}</b>
              <p>{log.message}</p>
              <small>
                {dateTime(log.createdAt)}
                {log.actorId ? ` · ${log.actorId}` : ""}
              </small>
            </div>
          </article>
        ))}
      </div>
      {dashboard.auditLogs.length === 0 ? (
        <div className="empty-state">尚无 Broker 审计记录</div>
      ) : null}
    </Panel>
  );
}
