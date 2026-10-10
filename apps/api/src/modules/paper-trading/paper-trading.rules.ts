import { createHash } from "node:crypto";

export type PaperDeploymentAction = "START" | "PAUSE" | "STOP";

const ALLOWED_TRANSITIONS: Record<PaperDeploymentAction, string[]> = {
  START: ["PAPER_APPROVED", "PAPER_PAUSED"],
  PAUSE: ["PAPER_RUNNING"],
  STOP: ["PAPER_APPROVED", "PAPER_RUNNING", "PAPER_PAUSED"],
};

export function paperExecutionKey(
  deploymentId: string,
  symbol: string,
  signalTradeDate: string,
  strategyVersion: number,
) {
  return createHash("sha256")
    .update(`${deploymentId}|${symbol}|${signalTradeDate.slice(0, 10)}|${strategyVersion}`)
    .digest("hex");
}

export function canTransitionPaperDeployment(
  currentStatus: string,
  action: PaperDeploymentAction,
  killSwitchEnabled: boolean,
) {
  if (killSwitchEnabled && action === "START") return false;
  return ALLOWED_TRANSITIONS[action].includes(currentStatus);
}

export function canResumePaperExecution(
  status: string,
  hasStrategySignal: boolean,
  orderCount: number,
) {
  return status === "FAILED" && !hasStrategySignal && orderCount === 0;
}

export function calculatePaperFill(input: {
  side: "BUY" | "SELL";
  signalTradeDate: string;
  marketTradeDate: string;
  open: number;
  commissionRate: number;
  slippageRate: number;
  requestedAmount?: number;
  requestedQuantity?: number;
  cashBalance: number;
  positionQuantity: number;
  positionAvgCost: number;
}) {
  if (input.marketTradeDate.slice(0, 10) <= input.signalTradeDate.slice(0, 10)) {
    throw new Error("收盘信号最早只能在下一交易日开盘成交");
  }
  if (input.open <= 0) throw new Error("缺少有效开盘价格");
  const price =
    input.open * (input.side === "BUY" ? 1 + input.slippageRate : 1 - input.slippageRate);
  let quantity =
    input.side === "BUY"
      ? Math.floor((input.requestedAmount ?? 0) / (price * (1 + input.commissionRate)))
      : Math.min(input.requestedQuantity ?? 0, input.positionQuantity);
  if (input.side === "BUY") {
    const affordable = Math.floor(input.cashBalance / (price * (1 + input.commissionRate)));
    quantity = Math.min(quantity, affordable);
  }
  if (quantity <= 0) throw new Error("现金不足或没有可卖持仓");
  const notional = quantity * price;
  const commission = notional * input.commissionRate;
  const slippage = quantity * input.open * input.slippageRate;
  const realizedPnl =
    input.side === "SELL" ? notional - commission - quantity * input.positionAvgCost : 0;
  const cashAfter =
    input.cashBalance + (input.side === "BUY" ? -(notional + commission) : notional - commission);
  if (cashAfter < -1e-8) throw new Error("模拟账户现金不得为负数");
  return { cashAfter, commission, notional, price, quantity, realizedPnl, slippage };
}

export function paperGuardrailViolations(input: {
  killSwitchEnabled: boolean;
  dataAvailable: boolean;
  stopLossCondition?: string | null;
  exitCondition?: string | null;
  dailyLossPercent: number;
  maxDrawdownPercent: number;
  consecutiveLosses: number;
  positionCount: number;
  orderCountToday: number;
}) {
  const violations: string[] = [];
  if (input.killSwitchEnabled) violations.push("PAPER_KILL_SWITCH");
  if (!input.dataAvailable) violations.push("PAPER_DATA_INTEGRITY");
  if (!input.stopLossCondition?.trim() || !input.exitCondition?.trim()) {
    violations.push("ENTRY_EXIT_REQUIRED");
  }
  if (input.dailyLossPercent <= -5) violations.push("PAPER_DAILY_LOSS_MAX");
  if (input.maxDrawdownPercent <= -20) violations.push("PAPER_ACCOUNT_DRAWDOWN_MAX");
  if (input.consecutiveLosses >= 5) violations.push("PAPER_CONSECUTIVE_LOSSES_MAX");
  if (input.positionCount >= 10) violations.push("PAPER_MAX_POSITIONS");
  if (input.orderCountToday >= 10) violations.push("PAPER_MAX_ORDERS_PER_DAY");
  return violations;
}
