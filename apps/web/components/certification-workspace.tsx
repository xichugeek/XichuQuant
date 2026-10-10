"use client";

import {
  Activity,
  AlertTriangle,
  Database,
  FileCheck2,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ServerCrash,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { getJson, postJson } from "@/lib/api-client";
import type { CertificationDashboard } from "@/lib/certification-types";

export type CertificationView =
  | "evidence"
  | "external"
  | "faults"
  | "integrity"
  | "linux"
  | "paper"
  | "soak";

const pageCopy: Record<CertificationView, { description: string; title: string }> = {
  evidence: {
    description: "汇总外部环境、Linux、Soak、故障和账本证据；任一缺失都不会宣称 V1.9 完成",
    title: "发布证据",
  },
  external: {
    description: "核验真实外部 IBKR Paper 前提、环境身份与脱敏证据；Fixture 永远不算外部认证",
    title: "外部认证",
  },
  faults: {
    description: "18 项故障注入逐项保留预期、实际恢复、重复订单和账本污染证据",
    title: "故障注入",
  },
  integrity: {
    description: "对成交、佣金、持仓、现金、撤单后成交、幂等和账本隔离执行十项不变量检查",
    title: "账本完整性",
  },
  linux: {
    description: "只接受真实 Linux Docker 构建、启动、容器/主机重启、持久化和备份恢复证据",
    title: "Linux 认证",
  },
  paper: {
    description: "外部 Paper 订单必须具备非 Fixture 订单、成交、佣金和已解决对账差异的完整闭环",
    title: "IBKR Paper 认证",
  },
  soak: {
    description: "连续采集服务、延迟、任务、资源和对账指标；未实际运行满 72 小时绝不通过",
    title: "长时间稳定性",
  },
};

function dateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
}

function statusTone(status: string) {
  const value = status.toUpperCase();
  if (["COMPLETED", "ENVIRONMENT_VERIFIED", "PASSED", "TECHNICALLY_READY"].includes(value)) return "is-success";
  if (["FAILED", "LOCKDOWN", "NOT_READY"].some((item) => value.includes(item))) return "is-danger";
  if (["BLOCKED", "INTERRUPTED", "NOT_RUN", "NOT_STARTED"].some((item) => value.includes(item))) return "is-warning";
  return "";
}

function Status({ value }: Readonly<{ value: string }>) {
  return <span className={["v19-status", statusTone(value)].join(" ")}>{value}</span>;
}

export function CertificationWorkspace({ view }: Readonly<{ view: CertificationView }>) {
  const [dashboard, setDashboard] = useState<CertificationDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDashboard(await getJson<CertificationDashboard>("/certification/dashboard"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "V1.9 认证 API 不可用");
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
      setError(reason instanceof Error ? reason.message : "认证操作失败");
    } finally {
      setBusy(false);
    }
  }

  const copy = pageCopy[view];
  return (
    <div className="v19-workspace" data-testid={`certification-page-${view}`}>
      <PageHeader
        action={<button className="v19-button v19-button--quiet" disabled={loading || busy} onClick={() => void refresh()} type="button"><RefreshCw className={loading ? "spin" : ""} size={16} />刷新真实证据</button>}
        description={copy.description}
        title={copy.title}
      />
      <div className="v19-boundary">
        <LockKeyhole size={19} />
        <span><b>EXTERNAL CERTIFICATION · PAPER ONLY</b><small>系统不接收券商密码或令牌，不提供 IBKR Live 写接口，不会把内部 Fixture 当作外部证据。</small></span>
        <em>LIVE 写能力：0</em>
      </div>
      {error ? <div className="service-error" data-testid="certification-error" role="alert"><ServerCrash size={18} /><span>{error}。页面不会用 Mock 数据伪装成功。</span><button onClick={() => void refresh()} type="button">重试</button></div> : null}
      {message ? <p className="quant-message">{message}</p> : null}
      {loading && !dashboard ? <div className="detail-loading" data-testid="certification-loading"><LoaderCircle className="spin" size={22} />正在读取认证证据与 SQL Server…</div> : null}
      {dashboard ? <CertificationSummary dashboard={dashboard} /> : null}
      {view === "external" && dashboard ? <External dashboard={dashboard} busy={busy} mutate={mutate} /> : null}
      {view === "paper" && dashboard ? <Paper dashboard={dashboard} /> : null}
      {view === "linux" && dashboard ? <Linux dashboard={dashboard} /> : null}
      {view === "soak" && dashboard ? <Soak dashboard={dashboard} busy={busy} mutate={mutate} /> : null}
      {view === "faults" && dashboard ? <Faults dashboard={dashboard} /> : null}
      {view === "integrity" && dashboard ? <Integrity dashboard={dashboard} busy={busy} mutate={mutate} /> : null}
      {view === "evidence" && dashboard ? <Evidence dashboard={dashboard} busy={busy} mutate={mutate} /> : null}
    </div>
  );
}

function CertificationSummary({ dashboard }: Readonly<{ dashboard: CertificationDashboard }>) {
  return (
    <>
      <div className="v19-summary">
        <article><ShieldCheck size={18} /><span>V1.9 认证状态</span><strong>{dashboard.releaseStatus}</strong><small>只反映真实证据</small></article>
        <article><Activity size={18} /><span>系统准备度</span><strong>{dashboard.readinessStatus}</strong><small>永不自动升级 Live</small></article>
        <article><FileCheck2 size={18} /><span>外部证据</span><strong>{dashboard.evidences.filter((item) => item.isExternal).length}</strong><small>脱敏并带 SHA-256</small></article>
        <article><Timer size={18} /><span>Soak 实际时长</span><strong>{dashboard.soak ? `${dashboard.soak.actualDurationMinutes}m` : "0m"}</strong><small>目标至少 72h</small></article>
      </div>
      {dashboard.blockingMessages.length ? <div className="v19-blockers" data-testid="certification-blockers">{dashboard.blockingMessages.map((item) => <p key={item}><AlertTriangle size={16} />{item}</p>)}</div> : null}
    </>
  );
}

function External({ busy, dashboard, mutate }: Readonly<{ busy: boolean; dashboard: CertificationDashboard; mutate: (action: () => Promise<unknown>, success: string) => Promise<void> }>) {
  function probe() {
    if (!window.confirm("只执行不含订单授权的外部环境前提检测，并把真实结果写入认证证据。确认继续？")) return;
    void mutate(() => postJson("/certification/external/verify", { confirmationText: "VERIFY EXTERNAL IBKR PAPER", explicitOrderAuthorization: false, operatorId: "local-operator" }), "已记录只读前提检测；这不构成外部订单授权或 V1.9 通过。 ");
  }
  return (
    <div className="v19-grid v19-grid--two">
      <Panel description="由后端读取 Connector、环境模式、账户白名单与 Kill Switch" title="外部环境认证">
        <dl className="v19-definition"><div><dt>状态</dt><dd><Status value={dashboard.external.status} /></dd></div><div><dt>环境</dt><dd>{dashboard.external.environment}</dd></div><div><dt>账户</dt><dd>{dashboard.external.maskedAccount ?? "未确认"}</dd></div><div><dt>检测时间</dt><dd>{dateTime(dashboard.external.completedAt)}</dd></div></dl>
        <p className="v19-reason">{dashboard.external.blockedReason ?? "外部环境身份已确认；仍需订单端到端证据。"}</p>
        <button className="v19-button" disabled={busy} onClick={probe} type="button">执行无订单授权的前提检测</button>
      </Panel>
      <Panel description="任一项不满足均默认拒绝" title="安全检查清单">
        <div className="v19-checks">{dashboard.securityChecklist.map((item) => <p key={item.code}><Status value={item.status} /><span><b>{item.code}</b><small>{item.description}</small></span></p>)}</div>
      </Panel>
    </div>
  );
}

function Paper({ dashboard }: Readonly<{ dashboard: CertificationDashboard }>) {
  const evidence = dashboard.externalOrderEvidence;
  return (
    <div className="v19-grid v19-grid--two">
      <Panel description="只接受非 Fixture 的外部 IBKR Paper 数据" title="订单闭环">
        <div className="v19-hero-status"><Status value={evidence.status} /><strong>{evidence.reason}</strong><small>订单 {evidence.orderId ?? "—"} · 成交 {evidence.executionCount}</small></div>
      </Panel>
      <Panel description="以下四项必须来自同一真实外部 Paper 闭环" title="证据要求">
        <ol className="v19-requirements"><li>券商返回的 Paper Order ID</li><li>至少一条外部 Execution</li><li>每笔成交对应的 Commission Report</li><li>订单、成交、佣金差异已完成对账</li></ol>
      </Panel>
    </div>
  );
}

function Linux({ dashboard }: Readonly<{ dashboard: CertificationDashboard }>) {
  return (
    <div className="v19-grid v19-grid--two">
      <Panel description="当前记录来自真实运行证据，不依据 Compose 静态文件推断" title="Linux Docker 运行时">
        <div className="v19-hero-status"><Status value={dashboard.linux.status} /><strong>{dashboard.linux.blockedReason ?? "Linux 运行证据齐全"}</strong><small>{dashboard.linux.environment} · {dateTime(dashboard.linux.completedAt)}</small></div>
      </Panel>
      <Panel description="必须在目标 Linux 主机实际执行" title="验收步骤">
        <ol className="v19-requirements"><li>运行 deploy/linux/certify-v1.9.sh</li><li>验证六个容器健康与迁移状态</li><li>验证容器重启后数据持久化</li><li>验证主机重启恢复</li><li>完成独立恢复库的备份恢复检查</li></ol>
      </Panel>
    </div>
  );
}

function Soak({ busy, dashboard, mutate }: Readonly<{ busy: boolean; dashboard: CertificationDashboard; mutate: (action: () => Promise<unknown>, success: string) => Promise<void> }>) {
  function start() {
    const confirmationText = window.prompt("输入“START 72H SOAK TEST”启动真实 72 小时采样：");
    if (confirmationText !== "START 72H SOAK TEST") return;
    void mutate(() => postJson("/certification/soak/start", { confirmationText, environment: "windows-local-v1.9", operatorId: "local-operator", targetHours: 72 }), "真实 Soak Test 已启动；未满 72 小时将持续显示 RUNNING。 ");
  }
  const soak = dashboard.soak;
  return (
    <>
      <div className="v19-soak-head">
        <div><span>当前状态</span><strong>{soak?.effectiveStatus ?? "NOT_STARTED"}</strong><small>{soak ? `${soak.actualDurationMinutes} / ${soak.targetHours * 60} 分钟` : "尚无实际采样"}</small></div>
        <div><span>真实进度</span><strong>{soak ? `${soak.progressPercent.toFixed(2)}%` : "0.00%"}</strong><small>预计结束 {dateTime(soak?.expectedEndAt)}</small></div>
        <div><span>样本 / 连续性</span><strong>{soak?.sampleCount ?? 0} / {soak?.continuous ? "OK" : "NO"}</strong><small>最大间隔 {soak ? `${soak.maximumObservedGapMinutes.toFixed(2)}m` : "—"}</small></div>
        <button className="v19-button" disabled={busy || soak?.status === "RUNNING"} onClick={start} type="button">启动 72h 实测</button>
      </div>
      <Panel description="服务与资源指标来自后端实时采样" title="最近 Soak 样本">
        {soak?.samples.length ? <div className="table-wrap"><table className="data-table v19-table"><thead><tr><th>时间</th><th>API / Broker / Quant / DB</th><th>延迟 P95 / P99</th><th>任务成功率</th><th>内存</th><th>异常</th></tr></thead><tbody>{soak.samples.map((sample) => <tr key={sample.sampledAt}><td>{dateTime(sample.sampledAt)}</td><td>{[sample.apiAvailable, sample.brokerAvailable, sample.quantAvailable, sample.databaseAvailable].map((value) => value ? "OK" : "DOWN").join(" / ")}</td><td>{sample.p95LatencyMs.toFixed(1)} / {sample.p99LatencyMs.toFixed(1)} ms</td><td>{sample.taskSuccessRate.toFixed(1)}%</td><td>{sample.memoryMb.toFixed(1)} MB</td><td>重复 {sample.duplicateOrderCount} · 未恢复 {sample.unrecoveredTaskCount} · 对账 {sample.reconciliationDifference}</td></tr>)}</tbody></table></div> : <div className="v19-empty">尚无真实 Soak 指标样本</div>}
      </Panel>
    </>
  );
}

function Faults({ dashboard }: Readonly<{ dashboard: CertificationDashboard }>) {
  return (
    <Panel description="页面只展示实际演练记录；未执行或缺少外部条件时明确显示 NOT_RUN/BLOCKED" title="故障演练矩阵">
      {dashboard.faults.length ? <div className="table-wrap"><table className="data-table v19-table"><thead><tr><th>场景</th><th>状态</th><th>预期</th><th>实际 / 阻塞原因</th><th>重复 / 污染</th><th>恢复</th></tr></thead><tbody>{dashboard.faults.map((fault) => <tr key={fault.scenario}><td><b>{fault.scenario}</b><br /><small>{dateTime(fault.completedAt)}</small></td><td><Status value={fault.status} /></td><td>{fault.expectedBehavior}</td><td>{fault.actualBehavior ?? fault.blockedReason ?? "尚无运行证据"}</td><td>{fault.duplicateOrders} / {fault.ledgerPolluted ? "是" : "否"}</td><td>{fault.recovered ? "已恢复" : "未确认"}</td></tr>)}</tbody></table></div> : <div className="v19-empty">尚无故障演练场景</div>}
    </Panel>
  );
}

function Integrity({ busy, dashboard, mutate }: Readonly<{ busy: boolean; dashboard: CertificationDashboard; mutate: (action: () => Promise<unknown>, success: string) => Promise<void> }>) {
  const integrity = dashboard.integrity;
  return (
    <>
      <div className="v19-action-bar"><span><Database size={18} /><b>最新检查：{integrity?.status ?? "NOT_RUN"}</b><small>{dateTime(integrity?.completedAt)} · 通过 {integrity?.passedCount ?? 0} / {integrity?.checkCount ?? 10}</small></span><button className="v19-button" disabled={busy} onClick={() => void mutate(() => postJson("/certification/ledger-integrity", { operatorId: "local-operator", source: "MANUAL" }), "十项账本不变量已按当前数据库真实状态复核。") } type="button">立即复核十项不变量</button></div>
      <Panel description="关键失败会创建通知并阻止后续执行" title="检查结果">
        {integrity?.checks.length ? <div className="table-wrap"><table className="data-table v19-table"><thead><tr><th>检查</th><th>状态</th><th>级别</th><th>结论</th><th>观察 / 期望</th></tr></thead><tbody>{integrity.checks.map((check) => <tr key={check.code}><td><b>{check.code}</b></td><td><Status value={check.status} /></td><td>{check.severity}</td><td>{check.message}</td><td>{check.observed ?? "—"} / {check.expected ?? "—"}</td></tr>)}</tbody></table></div> : <div className="v19-empty">尚未运行账本完整性检查</div>}
      </Panel>
    </>
  );
}

function Evidence({ busy, dashboard, mutate }: Readonly<{ busy: boolean; dashboard: CertificationDashboard; mutate: (action: () => Promise<unknown>, success: string) => Promise<void> }>) {
  return (
    <>
      <div className="v19-action-bar"><span><FileCheck2 size={18} /><b>证据只追加，不覆盖</b><small>所有 payload 均脱敏并保存 SHA-256 校验和</small></span><button className="v19-button" disabled={busy} onClick={() => void mutate(() => postJson("/certification/release-bundle"), "已按当前真实状态生成发布证据包；阻塞项不会被改写为通过。") } type="button">生成当前证据包</button></div>
      <div className="v19-grid v19-grid--two">
        <Panel description="最近 100 条认证证据" title="原始证据索引">
          {dashboard.evidences.length ? <div className="v19-evidence-list">{dashboard.evidences.map((item) => <article key={item.id}><header><Status value={item.status} /><b>{item.category} · {item.evidenceType}</b></header><p>{item.summary}</p><footer><span>{dateTime(item.occurredAt)} · {item.source}</span><code>{item.checksum.slice(0, 16)}…</code></footer></article>)}</div> : <div className="v19-empty">尚无认证证据</div>}
        </Panel>
        <Panel description="每次生成都保留当时的五项门禁结论" title="发布证据包">
          {dashboard.bundles.length ? <div className="v19-evidence-list">{dashboard.bundles.map((bundle) => <article key={bundle.id}><header><Status value={bundle.status} /><b>V{bundle.version} · {bundle.readinessStatus}</b></header><p>外部 {bundle.externalStatus} · Linux {bundle.linuxStatus} · Soak {bundle.soakStatus} · 故障 {bundle.faultStatus} · 账本 {bundle.ledgerStatus}</p><footer><span>{dateTime(bundle.createdAt)}</span><code>{bundle.checksum.slice(0, 16)}…</code></footer></article>)}</div> : <div className="v19-empty">尚无发布证据包</div>}
        </Panel>
      </div>
    </>
  );
}
