import { createHash } from "node:crypto";

export const BROKER_RUN_MODES = [
  "OFFLINE",
  "MOCK",
  "INTERNAL_PAPER",
  "SHADOW",
  "IBKR_PAPER",
  "READ_ONLY_LIVE",
  "LOCKDOWN",
] as const;

export const BROKER_PAPER_ORDER_TYPES = ["LIMIT", "MARKET", "STOP", "STOP_LIMIT"] as const;
export const EXECUTION_KILL_SWITCH_LEVELS = [
  "LEVEL_0_NORMAL",
  "LEVEL_1_NO_NEW_ENTRY",
  "LEVEL_2_CANCEL_OPEN_ORDERS",
  "LEVEL_3_CLOSE_PAPER_POSITIONS",
  "LEVEL_4_LOCKDOWN",
] as const;

export type ExecutionGuardCheck = {
  code: string;
  message: string;
  passed: boolean;
  severity: "CRITICAL" | "DANGER" | "INFO" | "WARNING";
};

export type PaperSubmissionGateInput = {
  accountAllowlisted: boolean;
  accountType: string;
  approvalSnapshotMatches: boolean;
  approvalValid: boolean;
  connectorEnvironment: string;
  executionGuardApproved: boolean;
  killSwitchLevel: string;
  portfolioRiskApproved: boolean;
  readinessApproved: boolean;
  riskApproved: boolean;
  runMode: string;
  safetyState: string;
};

export type ExecutionGuardInput = {
  annualProfitContextKnown?: boolean;
  accountSnapshotFresh: boolean;
  approvalValid: boolean;
  brokerHealthy: boolean;
  criticalReconciliationDifference: boolean;
  dailyLossExceeded: boolean;
  dailyNotionalExceeded: boolean;
  dailyOrderCountExceeded: boolean;
  dataQualityPassed: boolean;
  databaseHealthy: boolean;
  duplicateOrder: boolean;
  estimatedSlippageExceeded: boolean;
  killSwitchLevel: string;
  losingStreakExceeded: boolean;
  marketDataFresh: boolean;
  marketDataRealtime: boolean;
  orderNotionalExceeded: boolean;
  paperEnvironmentPassed: boolean;
  quantEngineHealthy: boolean;
  spreadExceeded: boolean;
  submissionUnknownExists: boolean;
  systemLockdown: boolean;
};

export type BrokerPaperDeploymentEligibilityInput = {
  deploymentRiskConfigJson: string;
  deploymentSymbolUniverseJson: string;
  strategySymbolUniverseJson: string;
  symbol: string;
};

export function evaluateBrokerPaperDeploymentEligibility(
  input: BrokerPaperDeploymentEligibilityInput,
) {
  const symbol = input.symbol.trim().toUpperCase();
  const strategyUniverse = parseSymbolUniverse(input.strategySymbolUniverseJson);
  const deploymentUniverse = parseSymbolUniverse(input.deploymentSymbolUniverseJson);
  const deploymentRiskConfig = parseObject(input.deploymentRiskConfigJson);
  const checks: ExecutionGuardCheck[] = [
    check("DEPLOYMENT_CONFIG_VALID", Object.keys(deploymentRiskConfig).length > 0 &&
      typeof deploymentRiskConfig.noBrokerOrder === "boolean" && typeof deploymentRiskConfig.portfolioOnly === "boolean",
      "部署风险配置必须完整且可解析，损坏或未知配置默认拒绝"),
    check(
      "STRATEGY_SYMBOL_UNIVERSE",
      strategyUniverse.includes(symbol),
      "订单标的必须属于策略标的范围",
    ),
    check(
      "DEPLOYMENT_SYMBOL_UNIVERSE",
      deploymentUniverse.includes(symbol),
      "订单标的必须属于部署标的范围",
    ),
    check(
      "DEPLOYMENT_BROKER_ORDER",
      deploymentRiskConfig.noBrokerOrder !== true,
      "策略部署明确禁止创建券商订单",
    ),
    check(
      "DEPLOYMENT_PORTFOLIO_ONLY",
      deploymentRiskConfig.portfolioOnly !== true,
      "仅组合验证的策略部署不得创建券商订单",
    ),
  ];
  return { allowed: checks.every((item) => item.passed), checks };
}

export function verifiedRealtimeQuote(input: {
  accepted?: boolean; marketDataSource?: string; marketDataTime?: string;
  marketDataType?: string; marketDataQuality?: string; referencePrice?: number;
}, now = Date.now()) {
  const age = now - Date.parse(input.marketDataTime ?? "");
  return input.accepted === true && input.marketDataType === "REALTIME" &&
    new Set(["IBKR_TWS_SOCKET", "IBKR_CLIENT_PORTAL"]).has(input.marketDataSource ?? "") &&
    input.marketDataQuality === "VERIFIED_TOP_OF_BOOK" && Number.isFinite(age) &&
    age >= -5000 && age <= 60000 && Number.isFinite(input.referencePrice) && Number(input.referencePrice) > 0;
}

export function protectiveStopCompliant(input: {
  filledQuantity: number; closedQuantity: number; stopQuantity: number | null;
  stopStatus: string | null; stopPrice: number | null; stopObservedAt: Date | null;
}, now = Date.now()) {
  if (![input.filledQuantity, input.closedQuantity].every(Number.isFinite) || input.filledQuantity < 0 || input.closedQuantity < 0 || input.closedQuantity > input.filledQuantity) return false;
  const remaining = Math.max(0, input.filledQuantity - input.closedQuantity);
  if (remaining === 0) return true;
  const age = now - (input.stopObservedAt?.getTime() ?? Number.NaN);
  return Number.isFinite(age) && age >= -5000 && age <= 90000 &&
    new Set(["SUBMITTED", "PRE_SUBMITTED", "OPEN"]).has(input.stopStatus ?? "") &&
    Number.isFinite(input.stopPrice) && Number(input.stopPrice) > 0 && input.stopQuantity === remaining;
}

function parseSymbolUniverse(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const rows = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${rows.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function stableHash(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function paperReadinessAllowsObservation(status: string) {
  return new Set(["OBSERVING", "TECHNICALLY_READY", "RISK_REVIEW_REQUIRED"]).has(status);
}

export function paperProposalKey(input: {
  brokerAccountId: string;
  proposalVersion: number;
  side: string;
  signalTradeDate: string;
  strategyDeploymentId: string;
  strategyVersion: string;
  symbol: string;
}) {
  return [
    "BROKER_PAPER_PROPOSAL",
    input.brokerAccountId,
    input.strategyDeploymentId,
    input.symbol.toUpperCase(),
    input.side.toUpperCase(),
    input.signalTradeDate.slice(0, 10),
    input.strategyVersion,
    input.proposalVersion,
  ].join(":");
}

export function paperOrderKey(proposalKey: string) {
  return `BROKER_PAPER_ORDER:${stableHash(proposalKey)}`;
}

export function executionKey(input: {
  externalExecutionId?: string | null;
  externalOrderId?: string | null;
  price: number;
  quantity: number;
  side: string;
  symbol: string;
  time: string;
}) {
  return stableHash(
    input.externalExecutionId
      ? { externalExecutionId: input.externalExecutionId }
      : {
          externalOrderId: input.externalOrderId,
          price: input.price,
          quantity: input.quantity,
          side: input.side,
          symbol: input.symbol,
          time: input.time,
        },
  );
}

export function commissionKey(input: {
  amount: number;
  executionKey: string;
  externalReportId?: string | null;
  reportTime: string;
}) {
  return stableHash(
    input.externalReportId
      ? { externalReportId: input.externalReportId }
      : {
          amount: input.amount,
          executionKey: input.executionKey,
          reportTime: input.reportTime,
        },
  );
}

export function evaluateSubmissionGate(input: PaperSubmissionGateInput) {
  const checks: ExecutionGuardCheck[] = [
    check("RUN_MODE", input.runMode === "IBKR_PAPER", "系统运行模式必须为 IBKR_PAPER"),
    check(
      "CONNECTOR_ENVIRONMENT",
      input.connectorEnvironment === "PAPER",
      "Broker Connector 环境必须明确为 PAPER",
    ),
    check("ACCOUNT_TYPE", input.accountType === "PAPER", "账户元数据必须明确标记为 PAPER"),
    check("ACCOUNT_ALLOWLIST", input.accountAllowlisted, "Paper Account 必须位于哈希白名单"),
    check("SAFETY_STATE", input.safetyState !== "LOCKDOWN", "安全状态不得为 LOCKDOWN"),
    check(
      "KILL_SWITCH",
      !new Set(["LEVEL_1_NO_NEW_ENTRY", "LEVEL_2_CANCEL_OPEN_ORDERS", "LEVEL_4_LOCKDOWN"]).has(
        input.killSwitchLevel,
      ),
      "Kill Switch 当前禁止新开仓",
    ),
    check("RISK_ENGINE", input.riskApproved, "单策略 RiskEngine 必须通过"),
    check("PORTFOLIO_RISK", input.portfolioRiskApproved, "PortfolioRiskEngine 必须通过"),
    check("READINESS", input.readinessApproved, "实盘准备度必须达到本阶段要求"),
    check("APPROVAL", input.approvalValid, "必须存在未过期人工审批"),
    check("APPROVAL_SNAPSHOT", input.approvalSnapshotMatches, "订单内容必须与审批快照一致"),
    check("EXECUTION_GUARD", input.executionGuardApproved, "ExecutionGuard 必须通过"),
  ];
  return { allowed: checks.every((item) => item.passed), checks };
}

export function evaluateExecutionGuard(input: ExecutionGuardInput) {
  const checks: ExecutionGuardCheck[] = [
    check("ANNUAL_PNL_VERIFIED", input.annualProfitContextKnown === true, "年度利润保护上下文必须有已核对的年度账本证据"),
    check("MARKET_DATA_FRESH", input.marketDataFresh, "当前行情不得过期"),
    check("MARKET_DATA_REALTIME", input.marketDataRealtime, "新增风险订单必须使用 REALTIME 行情"),
    check("ACCOUNT_SNAPSHOT_FRESH", input.accountSnapshotFresh, "账户快照不得过期"),
    check("DATA_QUALITY", input.dataQualityPassed, "行情数据质量必须通过"),
    check("SPREAD", !input.spreadExceeded, "买卖价差不得超过限制"),
    check("SLIPPAGE", !input.estimatedSlippageExceeded, "预计滑点不得超过限制"),
    check("ORDER_NOTIONAL", !input.orderNotionalExceeded, "单笔下单金额不得超过限制"),
    check("DAILY_ORDER_COUNT", !input.dailyOrderCountExceeded, "单日订单数量不得超过限制"),
    check("DAILY_NOTIONAL", !input.dailyNotionalExceeded, "单日成交金额不得超过限制"),
    check("DAILY_LOSS", !input.dailyLossExceeded, "当日亏损不得超过限制"),
    check("LOSING_STREAK", !input.losingStreakExceeded, "连续亏损次数不得超过限制"),
    check(
      "RECONCILIATION",
      !input.criticalReconciliationDifference,
      "重大 Paper 对账差异必须先处理",
    ),
    check("DUPLICATE_ORDER", !input.duplicateOrder, "不得存在重复有效订单"),
    check("SUBMISSION_UNKNOWN", !input.submissionUnknownExists, "必须先确认未知提交状态"),
    check("BROKER_HEALTH", input.brokerHealthy, "Broker Connector 必须健康"),
    check("QUANT_HEALTH", input.quantEngineHealthy, "Quant Engine 必须健康"),
    check("DATABASE_HEALTH", input.databaseHealthy, "SQL Server 必须健康"),
    check("KILL_SWITCH", input.killSwitchLevel === "LEVEL_0_NORMAL", "Kill Switch 必须为正常"),
    check("LOCKDOWN", !input.systemLockdown, "系统不得处于 LOCKDOWN"),
    check("APPROVAL", input.approvalValid, "人工审批必须有效"),
    check("PAPER_ENVIRONMENT", input.paperEnvironmentPassed, "Paper 双重环境验证必须通过"),
  ];
  return { allowed: checks.every((item) => item.passed), checks };
}

export function orderLifecycleStatus(input: {
  current: string;
  externalStatus: string;
  filledQuantity: number;
  quantity: number;
}) {
  const normalized = input.externalStatus.toUpperCase().replaceAll(" ", "_");
  const allowed = new Set([
    "API_CANCELLED",
    "BROKER_CONFIRMATION_REQUIRED",
    "CANCELLED",
    "EXPIRED",
    "FAILED",
    "FILLED",
    "INACTIVE",
    "PENDING_CANCEL",
    "PARTIALLY_FILLED",
    "PRE_SUBMITTED",
    "REJECTED",
    "SUBMITTED",
    "SUBMISSION_UNKNOWN",
    "UNKNOWN",
  ]);
  if (!allowed.has(normalized) || normalized === "UNKNOWN") return "UNKNOWN";
  if (!Number.isFinite(input.filledQuantity) || !Number.isFinite(input.quantity) || input.filledQuantity < 0 || input.quantity <= 0 || input.filledQuantity > input.quantity) return "UNKNOWN";
  if (new Set(["API_CANCELLED", "CANCELLED", "EXPIRED", "FAILED", "INACTIVE", "REJECTED", "SUBMISSION_UNKNOWN"]).has(normalized)) return normalized;
  if (normalized === "FILLED" && input.filledQuantity !== input.quantity) return "UNKNOWN";
  if (input.filledQuantity === input.quantity) return "FILLED";
  if (input.filledQuantity > 0) return "PARTIALLY_FILLED";
  return normalized;
}

export function matchBrokerOrderIdentity(rows: Array<Record<string, unknown>>, identity: { socketId: string | null; permanentId: string | null; orderRef: string }) {
  const socket = (row: Record<string, unknown>) => String(row.externalOrderId ?? row.orderId ?? "");
  const permanent = (row: Record<string, unknown>) => String(row.externalPermanentId ?? row.permanentId ?? "");
  const reference = (row: Record<string, unknown>) => String(row.orderReference ?? row.orderRef ?? "");
  const candidates = rows.filter((row) =>
    (identity.socketId && socket(row) === identity.socketId) ||
    (identity.permanentId && permanent(row) === identity.permanentId) || reference(row) === identity.orderRef);
  // Open/completed endpoints may both return an identical observation.
  const unique = [...new Map(candidates.map((row) => [stableHash(row), row])).values()];
  if (unique.length > 1) throw new Error("Ambiguous broker order identity; reconciliation required");
  const row = unique[0];
  if (!row) return undefined;
  if ((permanent(row) && identity.permanentId && permanent(row) !== identity.permanentId) ||
      (reference(row) && reference(row) !== identity.orderRef)) throw new Error("Conflicting broker order identity; reconciliation required");
  return row;
}

export function weightedAverageFills(
  fills: Array<{ price: number; quantity: number }>,
): { averagePrice: number; filledQuantity: number } {
  const filledQuantity = fills.reduce((sum, fill) => sum + fill.quantity, 0);
  const notional = fills.reduce((sum, fill) => sum + fill.quantity * fill.price, 0);
  return {
    averagePrice: filledQuantity > 0 ? notional / filledQuantity : 0,
    filledQuantity,
  };
}

export function killSwitchAllowsOrder(input: {
  isClosing: boolean;
  isNewEntry: boolean;
  level: string;
}) {
  if (input.level === "LEVEL_0_NORMAL") return true;
  if (input.level === "LEVEL_1_NO_NEW_ENTRY") return !input.isNewEntry || input.isClosing;
  return false;
}

function check(code: string, passed: boolean, message: string): ExecutionGuardCheck {
  return { code, message, passed, severity: passed ? "INFO" : "CRITICAL" };
}
