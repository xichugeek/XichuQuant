import { createHash } from "node:crypto";

export const READINESS_STATUSES = [
  "NOT_READY",
  "OBSERVING",
  "TECHNICALLY_READY",
  "RISK_REVIEW_REQUIRED",
] as const;

export const FAULT_SCENARIOS = [
  "QUANT_ENGINE_STOPPED",
  "BROKER_CONNECTOR_STOPPED",
  "API_STOPPED",
  "SQL_SERVER_INTERRUPTED",
  "MARKET_DATA_PROVIDER_INTERRUPTED",
  "BROKER_REQUEST_TIMEOUT",
  "DUPLICATE_TASK",
  "DUPLICATE_APPROVAL",
  "RESTART_DURING_SUBMITTING",
  "RESTART_DURING_ORDER_SYNC",
  "ACCOUNT_SNAPSHOT_STALE",
  "MARKET_DATA_STALE",
  "DISK_SPACE_WARNING",
  "KILL_SWITCH_LEVEL_1",
  "KILL_SWITCH_LEVEL_2",
  "LOCKDOWN",
  "BACKUP_FAILURE",
  "DATABASE_TRANSACTION_FAILURE",
] as const;

export type ExternalPrerequisites = {
  accountAllowlisted: boolean;
  accountTypePaper: boolean;
  apiEnabled: boolean;
  explicitOrderAuthorization: boolean;
  gatewayRunning: boolean;
  killSwitchNormal: boolean;
  paperSessionAuthenticated: boolean;
  runModePaper: boolean;
};

export function externalCertificationStatus(input: ExternalPrerequisites) {
  const missing = Object.entries(input)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  return {
    blockedReason: missing.length ? `缺少外部 IBKR Paper 前提：${missing.join(", ")}` : null,
    missing,
    status: missing.length ? "BLOCKED" : "READY_FOR_MANUAL_TEST",
  };
}

export function linuxCertificationStatus(runtime: {
  composeAvailable: boolean;
  dockerAvailable: boolean;
  isLinux: boolean;
}) {
  const missing = [
    ...(!runtime.isLinux ? ["LINUX_HOST"] : []),
    ...(!runtime.dockerAvailable ? ["DOCKER_ENGINE"] : []),
    ...(!runtime.composeAvailable ? ["COMPOSE_PLUGIN"] : []),
  ];
  return {
    blockedReason: missing.length ? `缺少 Linux Docker 运行环境：${missing.join(", ")}` : null,
    missing,
    status: missing.length ? "BLOCKED" : "READY_FOR_RUNTIME_CERTIFICATION",
  };
}

export function fixtureCanBeExternal(source: string, externalOrderId?: string | null) {
  return !/FIXTURE|NOT_EXTERNAL/i.test(source) && !/FIXTURE/i.test(externalOrderId ?? "");
}

export function percentile(values: number[], quantile: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1));
  return sorted[index]!;
}

export function soakProgress(startedAt: Date, targetHours: number, now = new Date()) {
  const durationMs = Math.max(0, now.getTime() - startedAt.getTime());
  const actualDurationMinutes = Math.floor(durationMs / 60_000);
  const targetMinutes = targetHours * 60;
  return {
    actualDurationMinutes,
    complete: actualDurationMinutes >= targetMinutes,
    progressPercent: Math.min(100, (actualDurationMinutes / targetMinutes) * 100),
    status: actualDurationMinutes >= targetMinutes ? "ELIGIBLE_FOR_REVIEW" : "RUNNING",
  };
}

export function soakContinuity(
  startedAt: Date,
  sampledAt: Date[],
  now = new Date(),
  maximumGapMinutes = 12,
) {
  const ordered = [...sampledAt].sort((left, right) => left.getTime() - right.getTime());
  const checkpoints = [startedAt, ...ordered, now];
  const gaps = checkpoints.slice(1).map((value, index) =>
    Math.max(0, (value.getTime() - checkpoints[index]!.getTime()) / 60_000),
  );
  const maximumObservedGapMinutes = gaps.length ? Math.max(...gaps) : Number.POSITIVE_INFINITY;
  return {
    continuous: ordered.length > 0 && maximumObservedGapMinutes <= maximumGapMinutes,
    maximumObservedGapMinutes,
  };
}

type IntegrityInput = {
  cashEquityDifference: number;
  criticalReconciliationDifferences: number;
  duplicateExecutionIds: number;
  isolationViolations: number;
  orphanCommissions: number;
  orphanExecutions: number;
  overfilledOrders: number;
  positionQuantityDifferences: number;
  postCancelExecutions: number;
  submissionUnknownRetries: number;
};

export type IntegrityCheck = {
  code: string;
  expected: string;
  message: string;
  observed: string;
  severity: "CRITICAL" | "WARNING";
  status: "FAILED" | "PASSED" | "WARNING";
};

export function evaluateLedgerIntegrity(input: IntegrityInput): IntegrityCheck[] {
  const countCheck = (
    code: string,
    value: number,
    message: string,
    severity: "CRITICAL" | "WARNING" = "CRITICAL",
  ): IntegrityCheck => ({
    code,
    expected: "0",
    message,
    observed: String(value),
    severity,
    status: value === 0 ? "PASSED" : severity === "CRITICAL" ? "FAILED" : "WARNING",
  });
  return [
    countCheck("EXECUTION_HAS_ORDER", input.orphanExecutions, "每笔 Paper 成交必须对应订单"),
    countCheck("COMMISSION_HAS_EXECUTION", input.orphanCommissions, "每笔佣金必须关联成交"),
    countCheck("POSITION_EQUALS_NET_EXECUTION", input.positionQuantityDifferences, "持仓变化必须等于成交净数量"),
    {
      code: "CASH_EQUITY_BALANCED",
      expected: "absolute difference <= 0.01",
      message: "账户权益必须等于现金加持仓市值",
      observed: String(input.cashEquityDifference),
      severity: "CRITICAL",
      status: Math.abs(input.cashEquityDifference) <= 0.01 ? "PASSED" : "FAILED",
    },
    countCheck("EXECUTION_ID_UNIQUE", input.duplicateExecutionIds, "重复 Execution ID 不得重复入账"),
    countCheck("SUBMISSION_UNKNOWN_NO_RETRY", input.submissionUnknownRetries, "SUBMISSION_UNKNOWN 不得自动重提"),
    countCheck("ORDER_NOT_OVERFILLED", input.overfilledOrders, "订单累计成交不得超过订单数量"),
    countCheck("CANCEL_NO_NEW_EXECUTION", input.postCancelExecutions, "撤单后不得产生非在途新成交", "WARNING"),
    countCheck("CRITICAL_RECONCILIATION_BLOCKS", input.criticalReconciliationDifferences, "重大对账差异必须阻止新订单"),
    countCheck("LEDGER_ISOLATION", input.isolationViolations, "真实、内部模拟、Shadow 与 Broker Paper 账本不得交叉污染"),
  ];
}

export function sanitizeEvidence(input: unknown): unknown {
  const secretKey = /password|secret|token|cookie|authorization|mfa/i;
  const visit = (value: unknown, key = ""): unknown => {
    if (secretKey.test(key)) return "[REDACTED]";
    if (Array.isArray(value)) return value.map((item) => visit(item));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([itemKey, item]) => [itemKey, visit(item, itemKey)]));
    }
    if (typeof value === "string") {
      return value
        .replace(/\bDU\d{5,}\b/gi, (account) => `${account.slice(0, 2)}****${account.slice(-3)}`)
        .replace(/(authorization\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]");
    }
    return value;
  };
  return visit(input);
}

export function evidenceChecksum(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(sanitizeEvidence(payload))).digest("hex");
}

export function releaseCertificationStatus(statuses: {
  external: string;
  faults: string;
  ledger: string;
  linux: string;
  soak: string;
}) {
  const complete = Object.values(statuses).every((value) => value === "PASSED");
  return {
    readinessStatus: complete ? "RISK_REVIEW_REQUIRED" : "NOT_READY",
    status: complete ? "COMPLETED" : "PARTIALLY_COMPLETED",
  };
}
