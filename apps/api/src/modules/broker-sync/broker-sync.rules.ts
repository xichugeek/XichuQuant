import { createHash, createHmac } from "node:crypto";

export type ReconciliationTolerance = {
  amountAbsolute: number;
  percentage: number;
  priceAbsolute: number;
  quantityAbsolute: number;
};

export const DEFAULT_RECONCILIATION_TOLERANCE: ReconciliationTolerance = {
  amountAbsolute: 1,
  percentage: 0.05,
  priceAbsolute: 0.01,
  quantityAbsolute: 0.0001,
};

export type ReconciliationInput = {
  broker: number;
  fieldName: string;
  local: number;
  symbol?: string;
  type: string;
  toleranceKind: "AMOUNT" | "PERCENTAGE" | "PRICE" | "QUANTITY";
};

export type ReconciliationDifferenceInput = {
  absoluteDifference: number;
  brokerValue: string;
  differenceType: string;
  fieldName: string;
  localValue: string;
  percentageDifference: number;
  severity: "CRITICAL" | "DANGER" | "INFO" | "WARNING";
  suggestedAction: string;
  symbol?: string;
};

export function hashExternalAccountId(value: string, pepper: string) {
  if (!pepper || pepper.includes("INVALID_EXAMPLE")) {
    throw new Error("BROKER_ACCOUNT_HASH_PEPPER 未配置，拒绝保存券商账户标识");
  }
  return createHmac("sha256", pepper).update(value).digest("hex");
}

export function maskBrokerAccount(value: string) {
  const normalized = value.trim();
  if (normalized.length <= 6) return "******";
  return `${normalized.slice(0, 3)}****${normalized.slice(-3)}`;
}

export function businessHash(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function brokerExecutionKey(record: {
  externalExecutionId?: string;
  executionTime: string;
  price: number;
  quantity: number;
  side: string;
  symbol: string;
}) {
  return record.externalExecutionId
    ? businessHash({ externalExecutionId: record.externalExecutionId })
    : `HASH:${businessHash(record)}`;
}

export function brokerOrderSnapshotKey(record: {
  externalOrderId: string;
  filledQuantity: number;
  snapshotTime: string;
  status: string;
}) {
  return businessHash({
    externalOrderId: record.externalOrderId,
    filledQuantity: record.filledQuantity,
    snapshotTime: record.snapshotTime,
    status: record.status,
  });
}

export function brokerSyncKey(connectionId: string, from: string, to: string) {
  return `BROKER_SYNC:${connectionId}:${from}:${to}`;
}

export function shadowIntentKey(input: {
  brokerAccountId: string;
  marketDate: string;
  side: string;
  strategyId?: string;
  symbol: string;
}) {
  return [
    "SHADOW_INTENT",
    input.brokerAccountId,
    input.strategyId ?? "MANUAL",
    input.symbol,
    input.side,
    input.marketDate,
  ].join(":");
}

export function validateCurrency(currency: string) {
  return /^[A-Z]{3}$/.test(currency);
}

export function validateFiniteNumbers(record: Record<string, unknown>, fields: string[]) {
  return fields.filter((field) => !Number.isFinite(Number(record[field])));
}

export function reconciliationDifference(
  input: ReconciliationInput,
  tolerance = DEFAULT_RECONCILIATION_TOLERANCE,
): ReconciliationDifferenceInput | null {
  const absoluteDifference = Math.abs(input.broker - input.local);
  const percentageDifference =
    Math.abs(input.local) > Number.EPSILON ? (absoluteDifference / Math.abs(input.local)) * 100 : 0;
  const threshold = {
    AMOUNT: tolerance.amountAbsolute,
    PERCENTAGE: tolerance.percentage,
    PRICE: tolerance.priceAbsolute,
    QUANTITY: tolerance.quantityAbsolute,
  }[input.toleranceKind];
  if (absoluteDifference <= threshold) return null;
  const severity = reconciliationSeverity(absoluteDifference, percentageDifference, input.type);
  return {
    absoluteDifference,
    brokerValue: String(input.broker),
    differenceType: input.type,
    fieldName: input.fieldName,
    localValue: String(input.local),
    percentageDifference,
    severity,
    suggestedAction:
      severity === "CRITICAL"
        ? "停止影子交易并人工核对券商流水、公司行动和本地调整记录。"
        : "人工核对后选择保留本地数据、接受券商数据或创建调整流水。",
    symbol: input.symbol,
  };
}

export function reconciliationSeverity(
  absoluteDifference: number,
  percentageDifference: number,
  type: string,
): ReconciliationDifferenceInput["severity"] {
  if (type.includes("MISSING") || absoluteDifference >= 1_000 || percentageDifference >= 10) {
    return "CRITICAL";
  }
  if (absoluteDifference >= 100 || percentageDifference >= 5) return "DANGER";
  if (absoluteDifference >= 1 || percentageDifference >= 0.5) return "WARNING";
  return "INFO";
}

export function shadowTaskAllowed(input: {
  brokerDataIsFresh: boolean;
  connectorAvailable: boolean;
  killSwitchEnabled: boolean;
  safetyState: string;
  shadowTradingEnabled: boolean;
}) {
  if (input.safetyState === "LOCKDOWN") return { allowed: false, reason: "LOCKDOWN" };
  if (input.killSwitchEnabled) return { allowed: false, reason: "KILL_SWITCH" };
  if (!input.connectorAvailable) return { allowed: false, reason: "CONNECTOR_UNAVAILABLE" };
  if (!input.brokerDataIsFresh) return { allowed: false, reason: "BROKER_DATA_STALE" };
  if (!input.shadowTradingEnabled || input.safetyState !== "SHADOW_ONLY") {
    return { allowed: false, reason: "SHADOW_MODE_DISABLED" };
  }
  return { allowed: true, reason: null };
}

export function shadowRiskDecision(input: {
  assetType: string;
  existingLeveragedPercent: number;
  overallRiskLevel: string;
  portfolioAllows: boolean;
  side: string;
}) {
  if (input.side !== "BUY") return { approved: true, reason: null };
  if (input.overallRiskLevel === "VIOLATION") {
    return { approved: false, reason: "真实账户当前处于 VIOLATION，影子买入被 RiskEngine 拒绝" };
  }
  if (input.assetType === "LEVERAGED_ETF" && input.existingLeveragedPercent >= 10) {
    return { approved: false, reason: "杠杆 ETF 总仓位已超限，影子买入被 RiskEngine 拒绝" };
  }
  if (!input.portfolioAllows) {
    return { approved: false, reason: "PortfolioRiskEngine 拒绝组合超限影子订单" };
  }
  return { approved: true, reason: null };
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
