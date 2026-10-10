export type AllocationMode =
  "FIXED_PERCENT" | "EQUAL_WEIGHT" | "INVERSE_VOLATILITY" | "RISK_BUDGET" | "MANUAL_AMOUNT";

export type ConflictPolicy = "NETTING" | "PRIORITY" | "REJECT_CONFLICT" | "MANUAL_REVIEW";

export type AllocationCandidate = {
  id: string;
  isLeveraged: boolean;
  manualAmount?: number | null;
  maxCapitalPercent: number;
  riskBudget?: number | null;
  targetAllocationPercent?: number | null;
  volatility?: number | null;
};

export type CapitalAllocation = {
  amount: number;
  candidateId: string;
  percentOfCapital: number;
};

export type AllocationResult = {
  allocations: CapitalAllocation[];
  availableCapital: number;
  cashReserve: number;
  errors: string[];
  valid: boolean;
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const roundRatio = (value: number) => Math.round((value + Number.EPSILON) * 1e8) / 1e8;

export function portfolioRunKey(portfolioId: string, tradeDate: string, runType: string) {
  return `PORTFOLIO_REBALANCE:${portfolioId}:${tradeDate}:${runType}`;
}

export function portfolioOrderKey(runId: string, symbol: string, side: string) {
  return `${runId}:${symbol.toUpperCase()}:${side}`;
}

export function portfolioCanCreateOrder(input: {
  globalKillSwitch: boolean;
  noNewPositions: boolean;
  readOnlyMode: boolean;
  side: "BUY" | "SELL";
  status: string;
}) {
  if (input.globalKillSwitch || input.readOnlyMode || input.status !== "PAPER_RUNNING")
    return false;
  return !(input.noNewPositions && input.side === "BUY");
}

export function applyPortfolioFill(input: {
  avgCost: number;
  cash: number;
  commission: number;
  price: number;
  quantity: number;
  side: "BUY" | "SELL";
  tradeQuantity: number;
}) {
  if (input.tradeQuantity <= 0 || input.price <= 0) throw new Error("成交数量和价格必须大于 0");
  const notional = input.price * input.tradeQuantity;
  if (input.side === "BUY") {
    const cash = input.cash - notional - input.commission;
    if (cash < -0.01) throw new Error("组合现金不足，禁止负现金");
    const quantity = input.quantity + input.tradeQuantity;
    return {
      avgCost: (input.avgCost * input.quantity + notional + input.commission) / quantity,
      cash: roundMoney(cash),
      quantity: roundRatio(quantity),
      realizedPnl: 0,
    };
  }
  if (input.tradeQuantity > input.quantity + 1e-8) throw new Error("组合持仓不足，禁止裸空");
  return {
    avgCost: input.avgCost,
    cash: roundMoney(input.cash + notional - input.commission),
    quantity: roundRatio(input.quantity - input.tradeQuantity),
    realizedPnl: roundMoney((input.price - input.avgCost) * input.tradeQuantity - input.commission),
  };
}

export function allocatePortfolioCapital(input: {
  candidates: AllocationCandidate[];
  cashReservePercent: number;
  initialCapital: number;
  leveragedStrategyMaxPercent: number;
  mode: AllocationMode;
}): AllocationResult {
  const errors: string[] = [];
  const { candidates, cashReservePercent, initialCapital, leveragedStrategyMaxPercent, mode } =
    input;
  if (!Number.isFinite(initialCapital) || initialCapital <= 0)
    errors.push("组合初始资金必须大于 0");
  if (cashReservePercent < 0 || cashReservePercent >= 100)
    errors.push("现金储备比例必须在 0% 到 100% 之间");
  if (candidates.length === 0) errors.push("组合至少需要一个已审批策略");
  const cashReserve = roundMoney(initialCapital * (cashReservePercent / 100));
  const availableCapital = roundMoney(initialCapital - cashReserve);
  const rawWeights = new Map<string, number>();
  if (mode === "EQUAL_WEIGHT") {
    for (const candidate of candidates) rawWeights.set(candidate.id, 1);
  } else if (mode === "INVERSE_VOLATILITY") {
    for (const candidate of candidates) {
      const volatility = candidate.volatility ?? 0;
      if (volatility <= 0) errors.push(`策略 ${candidate.id} 缺少有效波动率`);
      rawWeights.set(candidate.id, volatility > 0 ? 1 / volatility : 0);
    }
  } else if (mode === "RISK_BUDGET") {
    for (const candidate of candidates) {
      const volatility = candidate.volatility ?? 0;
      const budget = candidate.riskBudget ?? 0;
      if (volatility <= 0 || budget <= 0)
        errors.push(`策略 ${candidate.id} 缺少有效风险预算或波动率`);
      rawWeights.set(candidate.id, volatility > 0 ? budget / volatility : 0);
    }
  } else if (mode === "FIXED_PERCENT") {
    for (const candidate of candidates) {
      rawWeights.set(candidate.id, Math.max(0, candidate.targetAllocationPercent ?? 0));
    }
  }

  const weightSum = [...rawWeights.values()].reduce((sum, value) => sum + value, 0);
  const allocations = candidates.map((candidate) => {
    let amount = 0;
    if (mode === "MANUAL_AMOUNT") {
      amount = candidate.manualAmount ?? 0;
    } else if (mode === "FIXED_PERCENT") {
      amount = initialCapital * ((candidate.targetAllocationPercent ?? 0) / 100);
    } else if (weightSum > 0) {
      amount = availableCapital * ((rawWeights.get(candidate.id) ?? 0) / weightSum);
    }
    const hardMaxPercent = Math.min(
      candidate.maxCapitalPercent,
      candidate.isLeveraged ? leveragedStrategyMaxPercent : candidate.maxCapitalPercent,
    );
    const hardMaxAmount = initialCapital * (hardMaxPercent / 100);
    if (amount > hardMaxAmount + 0.01) {
      errors.push(`策略 ${candidate.id} 的资金分配超过其 ${hardMaxPercent}% 上限`);
    }
    return {
      amount: roundMoney(amount),
      candidateId: candidate.id,
      percentOfCapital: roundRatio(initialCapital > 0 ? (amount / initialCapital) * 100 : 0),
    };
  });
  if (
    !["FIXED_PERCENT", "MANUAL_AMOUNT"].includes(mode) &&
    allocations.length > 0 &&
    errors.length === 0
  ) {
    const roundedTotal = allocations.reduce((sum, item) => sum + item.amount, 0);
    const last = allocations.at(-1)!;
    last.amount = roundMoney(last.amount + availableCapital - roundedTotal);
    last.percentOfCapital = roundRatio((last.amount / initialCapital) * 100);
  }
  const allocated = roundMoney(allocations.reduce((sum, item) => sum + item.amount, 0));
  if (allocated > availableCapital + 0.01) {
    errors.push("所有策略分配合计超过扣除现金储备后的可投资资金");
  }
  return { allocations, availableCapital, cashReserve, errors, valid: errors.length === 0 };
}

export type RawPortfolioSignal = {
  amount?: number | null;
  id: string;
  portfolioStrategyId: string;
  priority: number;
  quantity?: number | null;
  side: "BUY" | "SELL";
  symbol: string;
};

export type NetOrderIntent = {
  allocations: Array<{ portfolioStrategyId: string; quantity: number; signalId: string }>;
  amount: number | null;
  conflict: boolean;
  quantity: number | null;
  reason: string;
  side: "BUY" | "SELL";
  symbol: string;
};

export type ConflictResolution = {
  netOrders: NetOrderIntent[];
  signalDecisions: Array<{ signalId: string; status: string; reason: string }>;
};

export function resolveSignalConflicts(
  signals: RawPortfolioSignal[],
  policy: ConflictPolicy,
): ConflictResolution {
  const grouped = new Map<string, RawPortfolioSignal[]>();
  for (const signal of signals) {
    const symbol = signal.symbol.toUpperCase();
    grouped.set(symbol, [...(grouped.get(symbol) ?? []), { ...signal, symbol }]);
  }
  const netOrders: NetOrderIntent[] = [];
  const signalDecisions: ConflictResolution["signalDecisions"] = [];
  for (const [symbol, group] of grouped) {
    const hasBuy = group.some((item) => item.side === "BUY");
    const hasSell = group.some((item) => item.side === "SELL");
    const conflict = hasBuy && hasSell;
    if (conflict && (policy === "REJECT_CONFLICT" || policy === "MANUAL_REVIEW")) {
      const status = policy === "MANUAL_REVIEW" ? "MANUAL_REVIEW" : "REJECTED_CONFLICT";
      for (const signal of group) {
        signalDecisions.push({ signalId: signal.id, status, reason: "同一标的同时存在买卖信号" });
      }
      continue;
    }
    let selected = group;
    if (conflict && policy === "PRIORITY") {
      const winning = [...group].sort((a, b) => a.priority - b.priority)[0]!;
      selected = group.filter((item) => item.side === winning.side);
      for (const signal of group.filter((item) => item.side !== winning.side)) {
        signalDecisions.push({
          signalId: signal.id,
          status: "REJECTED_PRIORITY",
          reason: `优先级 ${winning.priority} 的 ${winning.side} 信号获胜`,
        });
      }
    }
    const signedQuantity = selected.reduce(
      (sum, item) => sum + (item.side === "BUY" ? 1 : -1) * (item.quantity ?? 0),
      0,
    );
    const signedAmount = selected.reduce(
      (sum, item) => sum + (item.side === "BUY" ? 1 : -1) * (item.amount ?? 0),
      0,
    );
    const quantityBasis = selected.some((item) => item.quantity != null);
    const signedBasis = quantityBasis ? signedQuantity : signedAmount;
    if (Math.abs(signedBasis) < 1e-8) {
      for (const signal of selected) {
        signalDecisions.push({
          signalId: signal.id,
          status: "NETTED_OUT",
          reason: "买卖信号完全抵消",
        });
      }
      continue;
    }
    const side = signedBasis > 0 ? "BUY" : "SELL";
    const contributors = selected.filter((item) => item.side === side);
    const gross = contributors.reduce(
      (sum, item) => sum + Math.abs(quantityBasis ? (item.quantity ?? 0) : (item.amount ?? 0)),
      0,
    );
    const netAbsolute = Math.abs(signedBasis);
    const allocations = contributors.map((item) => ({
      portfolioStrategyId: item.portfolioStrategyId,
      quantity: roundRatio(
        gross > 0 ? netAbsolute * (Math.abs(item.quantity ?? item.amount ?? 0) / gross) : 0,
      ),
      signalId: item.id,
    }));
    for (const signal of selected) {
      signalDecisions.push({
        signalId: signal.id,
        status: signal.side === side ? "AGGREGATED" : "NETTED_OUT",
        reason: conflict ? `${policy} 冲突处理已保留原始信号` : "同向信号已聚合",
      });
    }
    netOrders.push({
      allocations,
      amount: quantityBasis ? null : roundMoney(netAbsolute),
      conflict,
      quantity: quantityBasis ? roundRatio(netAbsolute) : null,
      reason: conflict
        ? `${policy}：${group.length} 条原始信号聚合`
        : `${group.length} 条同向信号聚合`,
      side,
      symbol,
    });
  }
  return { netOrders, signalDecisions };
}

export type PortfolioRiskViolation = {
  code: string;
  level: "WARNING" | "DANGER" | "VIOLATION";
  message: string;
};

export type PortfolioRiskInput = {
  cashAfterOrders: number;
  cashReservePercent: number;
  correlations: Array<{
    allocationPercent: number;
    correlation: number;
    left: string;
    right: string;
  }>;
  currentDrawdownPercent: number;
  dailyLossPercent: number;
  equity: number;
  leveragedExposure: number;
  losingStrategyCount: number;
  maxConcurrentPositions: number;
  positionsAfterOrders: Array<{
    assetType: string;
    marketValue: number;
    symbol: string;
    theme?: string | null;
  }>;
  proposedOrders: Array<{ side: "BUY" | "SELL"; strategyIds: string[]; symbol: string }>;
  rules: {
    correlatedStrategiesMaxPercent: number;
    correlationThreshold: number;
    leveragedEtfMaxPercent: number;
    maxDailyLossPercent: number;
    maxDrawdownPercent: number;
    maxLosingStrategies: number;
    maxStrategyDrawdownContributionPercent: number;
    minCashPercent: number;
    singleStrategyMaxPercent: number;
    singleSymbolMaxPercent: number;
    singleThemeMaxPercent: number;
  };
  strategyAllocations: Array<{ drawdownContributionPercent: number; id: string; percent: number }>;
};

export function evaluatePortfolioRisk(input: PortfolioRiskInput) {
  const violations: PortfolioRiskViolation[] = [];
  const percent = (value: number) => (input.equity > 0 ? (value / input.equity) * 100 : 100);
  for (const allocation of input.strategyAllocations) {
    if (allocation.percent > input.rules.singleStrategyMaxPercent) {
      violations.push({
        code: "SINGLE_STRATEGY_MAX",
        level: "VIOLATION",
        message: `策略 ${allocation.id} 资金占比超过上限`,
      });
    }
    if (
      allocation.drawdownContributionPercent > input.rules.maxStrategyDrawdownContributionPercent
    ) {
      violations.push({
        code: "STRATEGY_DRAWDOWN_CONTRIBUTION",
        level: "DANGER",
        message: `策略 ${allocation.id} 对组合回撤贡献过高`,
      });
    }
  }
  const symbolExposure = new Map<string, number>();
  const themeExposure = new Map<string, number>();
  for (const position of input.positionsAfterOrders) {
    symbolExposure.set(
      position.symbol,
      (symbolExposure.get(position.symbol) ?? 0) + position.marketValue,
    );
    const theme = position.theme ?? "UNCLASSIFIED";
    themeExposure.set(theme, (themeExposure.get(theme) ?? 0) + position.marketValue);
  }
  for (const [symbol, exposure] of symbolExposure) {
    if (percent(exposure) > input.rules.singleSymbolMaxPercent) {
      violations.push({
        code: "SINGLE_SYMBOL_MAX",
        level: "VIOLATION",
        message: `${symbol} 总暴露超过组合上限`,
      });
    }
  }
  for (const [theme, exposure] of themeExposure) {
    if (percent(exposure) > input.rules.singleThemeMaxPercent) {
      violations.push({
        code: "SINGLE_THEME_MAX",
        level: "DANGER",
        message: `${theme} 主题总暴露超过组合上限`,
      });
    }
  }
  if (percent(input.leveragedExposure) > input.rules.leveragedEtfMaxPercent) {
    violations.push({
      code: "LEVERAGED_ETF_TOTAL_MAX",
      level: "VIOLATION",
      message: "杠杆 ETF 总暴露超过组合上限",
    });
  }
  if (
    input.positionsAfterOrders.filter((item) => item.marketValue > 0).length >
    input.maxConcurrentPositions
  ) {
    violations.push({
      code: "MAX_CONCURRENT_POSITIONS",
      level: "VIOLATION",
      message: "组合同时持仓数量超过上限",
    });
  }
  if (
    percent(input.cashAfterOrders) < Math.max(input.rules.minCashPercent, input.cashReservePercent)
  ) {
    violations.push({
      code: "MIN_CASH",
      level: "VIOLATION",
      message: "预计现金低于组合现金储备下限",
    });
  }
  if (input.cashAfterOrders < -0.01) {
    violations.push({
      code: "NEGATIVE_CASH",
      level: "VIOLATION",
      message: "组合执行后现金将为负数",
    });
  }
  if (input.dailyLossPercent > input.rules.maxDailyLossPercent) {
    violations.push({
      code: "MAX_DAILY_LOSS",
      level: "VIOLATION",
      message: "组合单日亏损超过停止线",
    });
  }
  if (input.currentDrawdownPercent > input.rules.maxDrawdownPercent) {
    violations.push({
      code: "MAX_DRAWDOWN",
      level: "VIOLATION",
      message: "组合最大回撤超过停止线",
    });
  }
  if (input.losingStrategyCount > input.rules.maxLosingStrategies) {
    violations.push({
      code: "LOSING_STRATEGIES",
      level: "DANGER",
      message: "连续亏损策略数量超过上限",
    });
  }
  for (const row of input.correlations) {
    if (
      row.correlation >= input.rules.correlationThreshold &&
      row.allocationPercent > input.rules.correlatedStrategiesMaxPercent
    ) {
      violations.push({
        code: "HIGH_CORRELATION_CONCENTRATION",
        level: "DANGER",
        message: "当前多个策略的收益和回撤高度相关，表面分散并未形成真实风险分散。",
      });
      break;
    }
  }
  for (const order of input.proposedOrders) {
    if (order.side === "BUY" && order.strategyIds.length > 1) {
      violations.push({
        code: "MULTI_STRATEGY_SAME_SYMBOL",
        level: "WARNING",
        message: `多个策略同时买入 ${order.symbol}`,
      });
    }
  }
  return { allowed: !violations.some((item) => item.level === "VIOLATION"), violations };
}
