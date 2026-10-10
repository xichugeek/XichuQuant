import { createHash } from "node:crypto";

import type {
  AmendmentDecision,
  ExposureBucket,
  ExposurePositionInput,
  ExposureSummary,
  GapStressResult,
  OrderDisciplineDecision,
  OrderDisciplineInput,
  ProfitGivebackResult,
  ProfitGivebackState,
  RiskDisciplineLimits,
  ScalePlanSnapshot,
  TradeRiskBudget,
} from "./risk-discipline.types";

export const DEFAULT_DISCIPLINE_LIMITS: RiskDisciplineLimits = {
  leveragedEtfMaxRiskPerTradePct: 0.25,
  leveragedEtfSingleMaxPct: 5,
  leveragedEtfTotalMaxPct: 10,
  maxRiskPerTradePct: 0.5,
  overnightGapStressMaxLossPct: 2,
  riskThemeEffectiveGrossMaxPct: 30,
  singleStockMaxPct: 15,
};

export const HARD_DISCIPLINE_RULES = new Set([
  "GIVEBACK_KILL_SWITCH",
  "KILL_SWITCH",
  "LEVERAGED_ETF_LOSS_ADD_BLOCK",
  "LEVERAGED_ETF_SINGLE_PRINCIPAL_MAX",
  "LEVERAGED_ETF_TOTAL_PRINCIPAL_MAX",
  "MISSING_EXIT_CONDITION",
  "MISSING_RISK_CONTEXT",
  "MISSING_STOP_PRICE",
  "OVERNIGHT_GAP_STRESS_FAILED",
  "OVERNIGHT_PERMISSION_REQUIRED",
  "RISK_INCREASING_AMENDMENT",
  "RISK_THEME_EFFECTIVE_GROSS_MAX",
  "SINGLE_STOCK_PRINCIPAL_MAX",
  "TRADE_RISK_BUDGET_EXCEEDED",
]);

function pct(value: number, equity: number) {
  return equity > 0 ? (value / equity) * 100 : Number.POSITIVE_INFINITY;
}

function directionSign(direction: string) {
  return new Set(["SHORT", "INVERSE", "BEAR"]).has(direction.trim().toUpperCase()) ? -1 : 1;
}

// Negative market value already carries the holding's SHORT sign. INVERSE describes
// the product, so a short inverse product correctly restores positive exposure.
function signedEffectiveExposure(position: ExposurePositionInput) {
  const direction = position.direction.trim().toUpperCase();
  const sign = position.marketValue < 0
    ? (new Set(["INVERSE", "BEAR"]).has(direction) ? 1 : -1)
    : directionSign(direction);
  return Math.abs(position.marketValue) * Math.max(0, position.leverageMultiplier) * sign;
}

function aggregate(
  equity: number,
  positions: ExposurePositionInput[],
  keyFor: (position: ExposurePositionInput) => string,
): ExposureBucket[] {
  const buckets = new Map<string, { gross: number; net: number; principal: number; symbols: Set<string> }>();
  for (const position of positions) {
    const key = keyFor(position) || "UNCLASSIFIED";
    const principal = Math.abs(position.marketValue);
    const signedEffective = signedEffectiveExposure(position);
    const bucket = buckets.get(key) ?? { gross: 0, net: 0, principal: 0, symbols: new Set<string>() };
    bucket.gross += Math.abs(signedEffective);
    bucket.net += signedEffective;
    bucket.principal += principal;
    bucket.symbols.add(position.symbol);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .map(([key, value]) => ({
      grossEffectiveExposure: value.gross,
      grossEffectiveExposurePct: pct(value.gross, equity),
      key,
      netDirectionalExposure: Math.abs(value.net),
      netDirectionalExposurePct: pct(Math.abs(value.net), equity),
      principal: value.principal,
      principalPct: pct(value.principal, equity),
      symbols: [...value.symbols].sort(),
    }))
    .sort((left, right) => right.grossEffectiveExposure - left.grossEffectiveExposure);
}

export function calculateEffectiveExposure(
  accountEquity: number,
  positions: ExposurePositionInput[],
): ExposureSummary {
  const grossEffectiveExposure = positions.reduce(
    (total, position) =>
      total + Math.abs(position.marketValue * Math.max(0, position.leverageMultiplier)),
    0,
  );
  const signedExposure = positions.reduce(
    (total, position) =>
      total +
      signedEffectiveExposure(position),
    0,
  );
  const leveragedEtfPrincipal = positions
    .filter((position) => position.leveragedETF)
    .reduce((total, position) => total + Math.abs(position.marketValue), 0);
  return {
    accountEquity,
    grossEffectiveExposure,
    grossEffectiveExposurePct: pct(grossEffectiveExposure, accountEquity),
    leveragedEtfPrincipal,
    leveragedEtfPrincipalPct: pct(leveragedEtfPrincipal, accountEquity),
    netDirectionalExposure: Math.abs(signedExposure),
    netDirectionalExposurePct: pct(Math.abs(signedExposure), accountEquity),
    byIndustry: aggregate(accountEquity, positions, (position) => position.industry ?? "UNCLASSIFIED"),
    byRiskTheme: aggregate(accountEquity, positions, (position) => position.riskTheme ?? "UNCLASSIFIED"),
    bySector: aggregate(accountEquity, positions, (position) => position.sector ?? "UNCLASSIFIED"),
    bySymbol: aggregate(accountEquity, positions, (position) => position.symbol),
    byUnderlying: aggregate(
      accountEquity,
      positions,
      (position) => position.underlyingSymbol ?? position.symbol,
    ),
  };
}

export function evaluateTradeRiskBudget(input: {
  accountEquity: number;
  entryPrice: number;
  estimatedFees: number;
  estimatedSlippage: number;
  exitCondition: string | null | undefined;
  increasesExposure: boolean;
  leveragedETF: boolean;
  limits: RiskDisciplineLimits;
  quantity: number;
  stopPrice: number | null | undefined;
}): TradeRiskBudget {
  if (!input.increasesExposure) {
    return { allowed: true, limitPct: input.limits.maxRiskPerTradePct, plannedLoss: 0, plannedLossPct: 0, reasons: [] };
  }
  const reasons: string[] = [];
  if (![input.accountEquity, input.entryPrice, input.quantity, input.estimatedFees, input.estimatedSlippage,
    ...Object.values(input.limits)].every(Number.isFinite) || input.accountEquity <= 0 || input.entryPrice <= 0 ||
    input.quantity <= 0 || input.estimatedFees < 0 || input.estimatedSlippage < 0 ||
    Object.values(input.limits).some((limit) => limit < 0)) reasons.push("MISSING_RISK_CONTEXT");
  if (!(Number(input.stopPrice) > 0)) reasons.push("MISSING_STOP_PRICE");
  if (!input.exitCondition?.trim()) reasons.push("MISSING_EXIT_CONDITION");
  const plannedLoss =
    Number(input.stopPrice) > 0
      ? Math.abs(input.entryPrice - Number(input.stopPrice)) * input.quantity +
        input.estimatedFees +
        input.estimatedSlippage
      : Number.POSITIVE_INFINITY;
  const plannedLossPct = pct(plannedLoss, input.accountEquity);
  const limitPct = input.leveragedETF
    ? input.limits.leveragedEtfMaxRiskPerTradePct
    : input.limits.maxRiskPerTradePct;
  if (plannedLossPct > limitPct) reasons.push("TRADE_RISK_BUDGET_EXCEEDED");
  return { allowed: reasons.length === 0, limitPct, plannedLoss, plannedLossPct, reasons };
}

export function runLeveragedOvernightGapStress(input: {
  accountEquity: number;
  notional: number;
  maxAccountLossPct: number;
}): GapStressResult {
  const scenarios = [-10, -20, -25, -35].map((gapPct) => {
    const projectedLoss = Math.abs(input.notional) * (Math.abs(gapPct) / 100);
    return { accountLossPct: pct(projectedLoss, input.accountEquity), gapPct, projectedLoss };
  });
  const maxAccountLossPct = Math.max(...scenarios.map((scenario) => scenario.accountLossPct));
  return {
    allowed: maxAccountLossPct <= input.maxAccountLossPct,
    maxAccountLossPct,
    scenarios,
    warning: "Stop 在隔夜跳空时不保证按止损价成交；本结果只按指定跳空场景估算。",
  };
}

function validScalePlan(
  plan: ScalePlanSnapshot | null,
  input: Pick<
    OrderDisciplineInput,
    | "accountEquity"
    | "allowOvernight"
    | "entryPrice"
    | "firstFillAt"
    | "projectedPositionQuantity"
    | "quantity"
    | "stopPrice"
  >,
) {
  if (!plan || plan.status !== "APPROVED") return false;
  if (plan.expiresAt && plan.expiresAt <= new Date()) return false;
  const firstFillAt = input.firstFillAt ?? plan.firstFilledAt;
  if (!firstFillAt || plan.createdAt >= firstFillAt || plan.approvedAt >= firstFillAt) return false;
  if (input.projectedPositionQuantity > plan.maxTotalQuantity) return false;
  if (input.allowOvernight !== plan.allowOvernight) return false;
  if (!(Number(input.stopPrice) > 0) || Number(input.stopPrice) < plan.finalStopPrice) return false;
  const principalPct = pct(input.projectedPositionQuantity * input.entryPrice, input.accountEquity);
  if (principalPct > plan.maxPrincipalPercent) return false;
  const plannedRiskPct = pct(
    Math.abs(input.entryPrice - Number(input.stopPrice)) * input.projectedPositionQuantity,
    input.accountEquity,
  );
  if (plannedRiskPct > plan.maxAccountRiskPct) return false;
  return plan.tranches.some(
    (tranche) => input.entryPrice <= tranche.price && input.quantity <= tranche.quantity,
  );
}

const REASON_MESSAGES: Record<string, string> = {
  GIVEBACK_KILL_SWITCH: "年度利润回吐已进入 KILL_SWITCH，禁止新增风险。",
  KILL_SWITCH: "Kill Switch 当前禁止所有新增风险订单。",
  LEVERAGED_ETF_LOSS_ADD_BLOCK: "杠杆 ETF 处于亏损时禁止临时补仓；只有首次开仓前批准并版本锁定的 Scale Plan 可例外。",
  LEVERAGED_ETF_SINGLE_PRINCIPAL_MAX: "单只杠杆 ETF 本金占账户权益超过配置上限。",
  LEVERAGED_ETF_TOTAL_PRINCIPAL_MAX: "全部杠杆 ETF 本金占账户权益超过配置上限。",
  MISSING_EXIT_CONDITION: "新增风险订单缺少明确退出条件。",
  MISSING_STOP_PRICE: "新增风险订单缺少 Stop Price。",
  OVERNIGHT_GAP_STRESS_FAILED: "杠杆 ETF 隔夜 Gap Stress 超过账户损失上限。",
  OVERNIGHT_PERMISSION_REQUIRED: "杠杆 ETF 建仓前必须明确 allowOvernight=true/false。",
  RISK_INCREASING_AMENDMENT: "成交后禁止增加亏损仓数量或扩大既有风险。",
  RISK_THEME_EFFECTIVE_GROSS_MAX: "同一 Risk Theme 的 Effective Gross Exposure 超过配置上限。",
  SINGLE_STOCK_PRINCIPAL_MAX: "单只普通股票本金占账户权益超过配置上限。",
  TRADE_RISK_BUDGET_EXCEEDED: "Planned Loss 超过本次交易 Risk Budget。",
};

export function evaluateOrderDiscipline(input: OrderDisciplineInput): OrderDisciplineDecision {
  const riskBudgetMultiplier =
    input.profitGivebackState === "REDUCED_RISK"
      ? 0.5
      : input.profitGivebackState === "DEFENSIVE"
        ? 0.25
        : input.profitGivebackState === "KILL_SWITCH"
          ? 0
          : 1;
  const effectiveLimits = {
    ...input.limits,
    leveragedEtfMaxRiskPerTradePct:
      input.limits.leveragedEtfMaxRiskPerTradePct * riskBudgetMultiplier,
    maxRiskPerTradePct: input.limits.maxRiskPerTradePct * riskBudgetMultiplier,
  };
  const budget = evaluateTradeRiskBudget({
    accountEquity: input.accountEquity,
    entryPrice: input.entryPrice,
    estimatedFees: input.estimatedFees,
    estimatedSlippage: input.estimatedSlippage,
    exitCondition: input.exitCondition,
    increasesExposure: input.increasesExposure,
    leveragedETF: input.instrument.leveragedETF,
    limits: effectiveLimits,
    quantity: input.quantity,
    stopPrice: input.stopPrice,
  });
  const codes = new Set(budget.reasons);
  const validPredefinedScalePlan = validScalePlan(input.scalePlan, input);
  if (input.increasesExposure && input.killSwitchLevel !== "LEVEL_0_NORMAL") codes.add("KILL_SWITCH");
  if (input.increasesExposure && input.profitGivebackState === "KILL_SWITCH") {
    codes.add("GIVEBACK_KILL_SWITCH");
  }
  if (input.increasesExposure && input.instrument.leveragedETF) {
    if (input.allowOvernight === undefined) codes.add("OVERNIGHT_PERMISSION_REQUIRED");
    const symbol = input.exposureAfter.bySymbol.find((bucket) => bucket.key === input.instrument.symbol);
    if (symbol && symbol.principalPct > input.limits.leveragedEtfSingleMaxPct) {
      codes.add("LEVERAGED_ETF_SINGLE_PRINCIPAL_MAX");
    }
    if (input.exposureAfter.leveragedEtfPrincipalPct > input.limits.leveragedEtfTotalMaxPct) {
      codes.add("LEVERAGED_ETF_TOTAL_PRINCIPAL_MAX");
    }
    if (
      input.positionUnrealizedPnl < 0 &&
      !validPredefinedScalePlan
    ) {
      codes.add("LEVERAGED_ETF_LOSS_ADD_BLOCK");
    }
  }
  if (
    input.increasesExposure &&
    input.currentPositionQuantity > 0 &&
    input.positionUnrealizedPnl < 0 &&
    !validPredefinedScalePlan
  ) {
    codes.add("RISK_INCREASING_AMENDMENT");
  }
  if (input.increasesExposure && !input.instrument.leveragedETF) {
    const symbol = input.exposureAfter.bySymbol.find((bucket) => bucket.key === input.instrument.symbol);
    if (symbol && symbol.principalPct > input.limits.singleStockMaxPct) {
      codes.add("SINGLE_STOCK_PRINCIPAL_MAX");
    }
  }
  const theme = input.instrument.riskTheme;
  if (input.increasesExposure && theme) {
    const themeExposure = input.exposureAfter.byRiskTheme.find((bucket) => bucket.key === theme);
    if (themeExposure && themeExposure.grossEffectiveExposurePct > input.limits.riskThemeEffectiveGrossMaxPct) {
      codes.add("RISK_THEME_EFFECTIVE_GROSS_MAX");
    }
  }
  const gapStress =
    input.increasesExposure && input.instrument.leveragedETF && input.allowOvernight === true
      ? runLeveragedOvernightGapStress({
          accountEquity: input.accountEquity,
          maxAccountLossPct: input.limits.overnightGapStressMaxLossPct,
          notional: input.projectedPositionQuantity * input.entryPrice,
        })
      : null;
  if (gapStress && !gapStress.allowed) codes.add("OVERNIGHT_GAP_STRESS_FAILED");
  const hardBlockReasons = [...codes].map((code) => ({
    code,
    message: REASON_MESSAGES[code] ?? code,
  }));
  return { allowed: hardBlockReasons.length === 0, budget, gapStress, hardBlockReasons };
}

export function evaluateRiskAmendment(input: {
  cancelStop: boolean;
  currentQuantity: number;
  currentStopPrice: number | null;
  increasesExposure: boolean;
  newQuantity: number;
  newStopPrice: number | null | undefined;
  positionDirection: string;
  protectiveStop: boolean;
  unrealizedPnl: number;
}): AmendmentDecision {
  const reasons: string[] = [];
  if (input.protectiveStop && input.cancelStop && input.currentStopPrice !== null) {
    reasons.push("禁止成交后取消 Stop");
  }
  if (
    input.protectiveStop &&
    input.currentStopPrice !== null &&
    input.newStopPrice !== undefined &&
    input.newStopPrice !== null
  ) {
    const longPosition = directionSign(input.positionDirection) > 0;
    if (longPosition && input.newStopPrice < input.currentStopPrice) reasons.push("多头 Stop 只能保持或上移");
    if (!longPosition && input.newStopPrice > input.currentStopPrice) reasons.push("空头 Stop 只能保持或下移");
  }
  if (
    input.increasesExposure &&
    input.unrealizedPnl < 0 &&
    input.newQuantity > input.currentQuantity
  ) {
    reasons.push("禁止增加亏损仓数量");
  }
  return reasons.length
    ? { allowed: false, code: "RISK_INCREASING_AMENDMENT", reasons }
    : { allowed: true, code: "ALLOWED", reasons: [] };
}

export function calculateProfitGiveback(input: {
  currentYtdPnl: number;
  defensivePct: number;
  killSwitchPct: number;
  peakYtdPnl: number;
  reducedRiskPct: number;
}): ProfitGivebackResult {
  const profitGivebackAmount = Math.max(0, input.peakYtdPnl - input.currentYtdPnl);
  const profitGivebackPct = input.peakYtdPnl > 0 ? pct(profitGivebackAmount, input.peakYtdPnl) : 0;
  let state: ProfitGivebackState = "NORMAL";
  if (profitGivebackPct >= input.killSwitchPct) state = "KILL_SWITCH";
  else if (profitGivebackPct >= input.defensivePct) state = "DEFENSIVE";
  else if (profitGivebackPct >= input.reducedRiskPct) state = "REDUCED_RISK";
  return {
    currentYtdPnl: input.currentYtdPnl,
    peakYtdPnl: input.peakYtdPnl,
    profitGivebackAmount,
    profitGivebackPct,
    state,
  };
}

export function disciplineLimits(rules: Array<{ code: string; enabled: boolean; limitValue: number }>) {
  const values = new Map(rules.filter((rule) => rule.enabled).map((rule) => [rule.code, rule.limitValue]));
  return {
    leveragedEtfMaxRiskPerTradePct:
      values.get("LEVERAGED_ETF_MAX_RISK_PER_TRADE_PCT") ??
      DEFAULT_DISCIPLINE_LIMITS.leveragedEtfMaxRiskPerTradePct,
    leveragedEtfSingleMaxPct:
      values.get("LEVERAGED_ETF_SINGLE_MAX") ?? DEFAULT_DISCIPLINE_LIMITS.leveragedEtfSingleMaxPct,
    leveragedEtfTotalMaxPct:
      values.get("LEVERAGED_ETF_TOTAL_MAX") ?? DEFAULT_DISCIPLINE_LIMITS.leveragedEtfTotalMaxPct,
    maxRiskPerTradePct:
      values.get("MAX_RISK_PER_TRADE_PCT") ?? DEFAULT_DISCIPLINE_LIMITS.maxRiskPerTradePct,
    overnightGapStressMaxLossPct:
      values.get("OVERNIGHT_GAP_STRESS_MAX_LOSS_PCT") ??
      DEFAULT_DISCIPLINE_LIMITS.overnightGapStressMaxLossPct,
    riskThemeEffectiveGrossMaxPct:
      values.get("RISK_THEME_EFFECTIVE_GROSS_MAX_PCT") ??
      DEFAULT_DISCIPLINE_LIMITS.riskThemeEffectiveGrossMaxPct,
    singleStockMaxPct:
      values.get("SINGLE_STOCK_MAX") ?? DEFAULT_DISCIPLINE_LIMITS.singleStockMaxPct,
  } satisfies RiskDisciplineLimits;
}

export function riskDisciplineEventKey(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
