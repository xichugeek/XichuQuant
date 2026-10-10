import assert from "node:assert/strict";
import test from "node:test";

import {
  allocatePortfolioCapital,
  applyPortfolioFill,
  evaluatePortfolioRisk,
  portfolioCanCreateOrder,
  portfolioOrderKey,
  portfolioRunKey,
  resolveSignalConflicts,
} from "./portfolio.rules";

const baseCandidates = [
  {
    id: "A",
    isLeveraged: false,
    maxCapitalPercent: 40,
    targetAllocationPercent: 30,
    volatility: 0.2,
    riskBudget: 1,
  },
  {
    id: "B",
    isLeveraged: false,
    maxCapitalPercent: 40,
    targetAllocationPercent: 30,
    volatility: 0.1,
    riskBudget: 1,
  },
  {
    id: "DLA2",
    isLeveraged: true,
    maxCapitalPercent: 10,
    targetAllocationPercent: 10,
    volatility: 0.6,
    riskBudget: 0.5,
  },
];

test("固定比例分配保留 20% 现金且单策略不超过 40%", () => {
  const result = allocatePortfolioCapital({
    candidates: baseCandidates,
    cashReservePercent: 20,
    initialCapital: 100000,
    leveragedStrategyMaxPercent: 10,
    mode: "FIXED_PERCENT",
  });
  assert.equal(result.valid, true);
  assert.equal(result.cashReserve, 20000);
  assert.equal(
    result.allocations.reduce((sum, item) => sum + item.amount, 0),
    70000,
  );
});

test("资金分配超过可投资资金或杠杆策略上限会被拒绝", () => {
  const result = allocatePortfolioCapital({
    candidates: baseCandidates.map((item) => ({
      ...item,
      targetAllocationPercent: item.id === "DLA2" ? 20 : 40,
    })),
    cashReservePercent: 20,
    initialCapital: 100000,
    leveragedStrategyMaxPercent: 10,
    mode: "FIXED_PERCENT",
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((item) => item.includes("杠杆") || item.includes("超过")));
});

test("等权、波动率反比、风险预算和手动金额均产生可审计分配", () => {
  for (const mode of ["EQUAL_WEIGHT", "INVERSE_VOLATILITY", "RISK_BUDGET"] as const) {
    const result = allocatePortfolioCapital({
      candidates: baseCandidates.map((item) => ({
        ...item,
        maxCapitalPercent: 100,
        isLeveraged: false,
      })),
      cashReservePercent: 20,
      initialCapital: 100000,
      leveragedStrategyMaxPercent: 10,
      mode,
    });
    assert.equal(result.valid, true);
    assert.equal(
      result.allocations.reduce((sum, item) => sum + item.amount, 0),
      80000,
    );
  }
  const manual = allocatePortfolioCapital({
    candidates: baseCandidates.map((item) => ({
      ...item,
      manualAmount: item.id === "DLA2" ? 10000 : 30000,
    })),
    cashReservePercent: 20,
    initialCapital: 100000,
    leveragedStrategyMaxPercent: 10,
    mode: "MANUAL_AMOUNT",
  });
  assert.equal(manual.valid, true);
});

test("NETTING 保留三条原始信号并生成 AAPL 净买入 40 股", () => {
  const result = resolveSignalConflicts(
    [
      { id: "A", portfolioStrategyId: "A", priority: 1, quantity: 30, side: "BUY", symbol: "AAPL" },
      {
        id: "B",
        portfolioStrategyId: "B",
        priority: 2,
        quantity: 10,
        side: "SELL",
        symbol: "AAPL",
      },
      { id: "C", portfolioStrategyId: "C", priority: 3, quantity: 20, side: "BUY", symbol: "AAPL" },
    ],
    "NETTING",
  );
  assert.equal(result.signalDecisions.length, 3);
  assert.equal(result.netOrders[0]?.side, "BUY");
  assert.equal(result.netOrders[0]?.quantity, 40);
});

test("PRIORITY、REJECT_CONFLICT 和 MANUAL_REVIEW 冲突策略结论明确", () => {
  const signals = [
    {
      id: "BUY",
      portfolioStrategyId: "A",
      priority: 1,
      quantity: 10,
      side: "BUY" as const,
      symbol: "AAPL",
    },
    {
      id: "SELL",
      portfolioStrategyId: "B",
      priority: 2,
      quantity: 10,
      side: "SELL" as const,
      symbol: "AAPL",
    },
  ];
  assert.equal(resolveSignalConflicts(signals, "PRIORITY").netOrders[0]?.side, "BUY");
  assert.equal(resolveSignalConflicts(signals, "REJECT_CONFLICT").netOrders.length, 0);
  assert.equal(
    resolveSignalConflicts(signals, "MANUAL_REVIEW").signalDecisions[0]?.status,
    "MANUAL_REVIEW",
  );
});

test("组合风控拒绝负现金、DLA2 超限和单标的过度集中", () => {
  const result = evaluatePortfolioRisk({
    cashAfterOrders: -1,
    cashReservePercent: 20,
    correlations: [],
    currentDrawdownPercent: 0,
    dailyLossPercent: 0,
    equity: 100000,
    leveragedExposure: 12000,
    losingStrategyCount: 0,
    maxConcurrentPositions: 10,
    positionsAfterOrders: [
      { assetType: "LEVERAGED_ETF", marketValue: 31000, symbol: "DLA2", theme: "STORAGE" },
    ],
    proposedOrders: [{ side: "BUY", strategyIds: ["A"], symbol: "DLA2" }],
    rules: {
      correlatedStrategiesMaxPercent: 50,
      correlationThreshold: 0.8,
      leveragedEtfMaxPercent: 10,
      maxDailyLossPercent: 3,
      maxDrawdownPercent: 15,
      maxLosingStrategies: 2,
      maxStrategyDrawdownContributionPercent: 50,
      minCashPercent: 20,
      singleStrategyMaxPercent: 40,
      singleSymbolMaxPercent: 30,
      singleThemeMaxPercent: 40,
    },
    strategyAllocations: [{ drawdownContributionPercent: 0, id: "A", percent: 10 }],
  });
  assert.equal(result.allowed, false);
  assert.ok(result.violations.some((item) => item.code === "NEGATIVE_CASH"));
  assert.ok(result.violations.some((item) => item.code === "LEVERAGED_ETF_TOTAL_MAX"));
  assert.ok(result.violations.some((item) => item.code === "SINGLE_SYMBOL_MAX"));
});

test("高相关策略按合并资金暴露触发真实分散提醒", () => {
  const result = evaluatePortfolioRisk({
    cashAfterOrders: 30000,
    cashReservePercent: 20,
    correlations: [{ allocationPercent: 60, correlation: 0.92, left: "A", right: "B" }],
    currentDrawdownPercent: 0,
    dailyLossPercent: 0,
    equity: 100000,
    leveragedExposure: 0,
    losingStrategyCount: 0,
    maxConcurrentPositions: 10,
    positionsAfterOrders: [],
    proposedOrders: [],
    rules: {
      correlatedStrategiesMaxPercent: 50,
      correlationThreshold: 0.8,
      leveragedEtfMaxPercent: 10,
      maxDailyLossPercent: 3,
      maxDrawdownPercent: 15,
      maxLosingStrategies: 2,
      maxStrategyDrawdownContributionPercent: 50,
      minCashPercent: 20,
      singleStrategyMaxPercent: 40,
      singleSymbolMaxPercent: 30,
      singleThemeMaxPercent: 40,
    },
    strategyAllocations: [
      { drawdownContributionPercent: 0, id: "A", percent: 30 },
      { drawdownContributionPercent: 0, id: "B", percent: 30 },
    ],
  });
  assert.ok(result.violations.some((item) => item.message.includes("表面分散")));
});

test("组合成交账目平衡、资金不足不负现金且禁止裸空", () => {
  const buy = applyPortfolioFill({
    avgCost: 0,
    cash: 100000,
    commission: 10,
    price: 100,
    quantity: 0,
    side: "BUY",
    tradeQuantity: 300,
  });
  assert.equal(buy.cash + buy.quantity * 100 + 10, 100000);
  assert.throws(
    () =>
      applyPortfolioFill({
        avgCost: 0,
        cash: 100,
        commission: 1,
        price: 100,
        quantity: 0,
        side: "BUY",
        tradeQuantity: 2,
      }),
    /负现金/,
  );
  assert.throws(
    () =>
      applyPortfolioFill({
        avgCost: 100,
        cash: 0,
        commission: 1,
        price: 110,
        quantity: 1,
        side: "SELL",
        tradeQuantity: 2,
      }),
    /裸空/,
  );
});

test("组合运行和订单幂等键稳定，暂停、只读和 Kill Switch 禁止新订单", () => {
  assert.equal(
    portfolioRunKey("P", "2026-07-17", "MANUAL"),
    portfolioRunKey("P", "2026-07-17", "MANUAL"),
  );
  assert.equal(portfolioOrderKey("R", "aapl", "BUY"), "R:AAPL:BUY");
  assert.equal(
    portfolioCanCreateOrder({
      globalKillSwitch: false,
      noNewPositions: false,
      readOnlyMode: false,
      side: "BUY",
      status: "PAPER_RUNNING",
    }),
    true,
  );
  assert.equal(
    portfolioCanCreateOrder({
      globalKillSwitch: false,
      noNewPositions: false,
      readOnlyMode: false,
      side: "BUY",
      status: "PAUSED",
    }),
    false,
  );
  assert.equal(
    portfolioCanCreateOrder({
      globalKillSwitch: true,
      noNewPositions: false,
      readOnlyMode: false,
      side: "SELL",
      status: "PAPER_RUNNING",
    }),
    false,
  );
  assert.equal(
    portfolioCanCreateOrder({
      globalKillSwitch: false,
      noNewPositions: true,
      readOnlyMode: false,
      side: "SELL",
      status: "PAPER_RUNNING",
    }),
    true,
  );
});
