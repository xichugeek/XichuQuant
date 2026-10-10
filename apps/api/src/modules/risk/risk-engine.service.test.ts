import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { RiskEngineService } from "./risk-engine.service";
import type { RiskAccountInput, RiskPositionInput, RiskRuleInput } from "./risk.types";
import {
  calculateEffectiveExposure,
  calculateProfitGiveback,
  DEFAULT_DISCIPLINE_LIMITS,
  evaluateOrderDiscipline,
  evaluateRiskAmendment,
  HARD_DISCIPLINE_RULES,
  riskDisciplineEventKey,
} from "../risk-discipline/risk-discipline.rules";
import type { OrderDisciplineInput } from "../risk-discipline/risk-discipline.types";

const account: RiskAccountInput = {
  id: "account-demo",
  name: "虚构演示账户 DEMO",
  totalEquity: 120000,
  cashBalance: 81400,
  realizedPnlYtd: 18000,
};

const positions: RiskPositionInput[] = [
  ["DLA2", "Fictional Lab Alpha 2x ETF", "LEVERAGED_ETF", "STORAGE", 60, 200, 150],
  ["DLB2", "Fictional Lab Beta 2x ETF", "LEVERAGED_ETF", "STORAGE", 100, 90, 60],
  ["QQQM", "Invesco NASDAQ 100 ETF", "ETF", "CORE_INDEX", 40, 320, 320],
  ["VOO", "Vanguard S&P 500 ETF", "ETF", "CORE_INDEX", 12, 500, 500],
  ["AAPL", "Apple", "STOCK", "BIG_TECH", 30, 160, 160],
].map(([symbol, name, assetType, theme, quantity, avgCost, currentPrice]) => ({
  id: `position-${String(symbol).toLowerCase()}`,
  symbol: String(symbol),
  name: String(name),
  assetType: String(assetType),
  category: null,
  theme: String(theme),
  quantity: Number(quantity),
  avgCost: Number(avgCost),
  currentPrice: Number(currentPrice),
}));

const rules: RiskRuleInput[] = [
  ["LEVERAGED_ETF_SINGLE_MAX", 5],
  ["LEVERAGED_ETF_TOTAL_MAX", 10],
  ["SINGLE_STOCK_MAX", 15],
  ["STORAGE_THEME_MAX", 15],
  ["LEVERAGED_ETF_LOSS_DANGER", -15],
  ["ANNUAL_PROFIT_PROTECTION", 50],
].map(([code, limitValue]) => ({
  code: String(code),
  enabled: true,
  level: "DANGER",
  limitValue: Number(limitValue),
}));

const engine = new RiskEngineService();

test("后端计算 DLA2 单只仓位与浮亏", () => {
  const summary = engine.evaluate(account, positions, rules);
  const dla2 = summary.positions.find((position) => position.symbol === "DLA2");
  assert.ok(dla2);
  assert.equal(dla2.costAmount, 12000);
  assert.equal(dla2.marketValue, 9000);
  assert.equal(dla2.unrealizedPnl, -3000);
  assert.equal(Number(dla2.positionPercent.toFixed(5)), 7.5);
});

test("后端计算杠杆 ETF、存储主题和年度利润保护", () => {
  const summary = engine.evaluate(account, positions, rules);
  assert.equal(summary.leveragedEtfValue, 15000);
  assert.equal(Number(summary.leveragedEtfPercent.toFixed(5)), 12.5);
  assert.equal(summary.storageThemeValue, 15000);
  assert.equal(summary.unrealizedPnlTotal, -6000);
  assert.equal(summary.annualNetPnl, 12000);
  assert.equal(Number(summary.floatingLossToRealizedProfitPercent.toFixed(2)), 33.33);
});

test("后端生成杠杆 ETF 严重违纪报警", () => {
  const summary = engine.evaluate(account, positions, rules);
  assert.equal(summary.overallRiskLevel, "VIOLATION");
  const alert = summary.alerts.find((item) => item.code === "LEVERAGED_ETF_TOTAL_MAX");
  assert.equal(alert?.title, "严重违纪：杠杆 ETF 总仓位超过 10%");
  assert.match(alert?.suggestedAction ?? "", /降低.*杠杆 ETF/);
});

test("修改持仓价格后风险结果会重新计算", () => {
  const repriced = positions.map((position) =>
    position.symbol === "DLA2" ? { ...position, currentPrice: 10 } : position,
  );
  const original = engine.evaluate(account, positions, rules);
  const updated = engine.evaluate(account, repriced, rules);
  assert.notEqual(updated.unrealizedPnlTotal, original.unrealizedPnlTotal);
  assert.notEqual(updated.leveragedEtfPercent, original.leveragedEtfPercent);
});

const memoryExposure = calculateEffectiveExposure(120_000, [
  {
    direction: "LONG",
    industry: "SEMICONDUCTOR_MEMORY",
    leveragedETF: true,
    leverageMultiplier: 2,
    marketValue: 18_000,
    riskTheme: "MEMORY",
    sector: "TECHNOLOGY",
    symbol: "DLA2",
    underlyingSymbol: "MU",
  },
  {
    direction: "LONG",
    industry: "SEMICONDUCTOR_MEMORY",
    leveragedETF: true,
    leverageMultiplier: 2,
    marketValue: 12_000,
    riskTheme: "MEMORY",
    sector: "TECHNOLOGY",
    symbol: "DLB2",
    underlyingSymbol: "SNDK",
  },
]);

const disciplineBase: OrderDisciplineInput = {
  accountEquity: 120_000,
  allowOvernight: false,
  currentPositionQuantity: 0,
  entryPrice: 20,
  estimatedFees: 1,
  estimatedSlippage: 1,
  exitCondition: "价格触及 19.8 时退出",
  exposureAfter: calculateEffectiveExposure(120_000, [
    {
      direction: "LONG",
      industry: "SEMICONDUCTOR_MEMORY",
      leveragedETF: true,
      leverageMultiplier: 2,
      marketValue: 600,
      riskTheme: "MEMORY",
      sector: "TECHNOLOGY",
      symbol: "DLA2",
      underlyingSymbol: "MU",
    },
  ]),
  firstFillAt: null,
  increasesExposure: true,
  instrument: {
    direction: "LONG",
    industry: "SEMICONDUCTOR_MEMORY",
    leveragedETF: true,
    leverageMultiplier: 2,
    riskTheme: "MEMORY",
    sector: "TECHNOLOGY",
    symbol: "DLA2",
    underlyingSymbol: "MU",
  },
  killSwitchLevel: "LEVEL_0_NORMAL",
  limits: DEFAULT_DISCIPLINE_LIMITS,
  positionUnrealizedPnl: 0,
  profitGivebackState: "NORMAL",
  projectedPositionQuantity: 30,
  quantity: 10,
  scalePlan: null,
  stopPrice: 19.8,
};

test("合成事故 Fixture 合并 Memory 主题的两个 2x ETF 并阻断", () => {
  assert.equal(memoryExposure.leveragedEtfPrincipal, 30_000);
  assert.equal(Number(memoryExposure.leveragedEtfPrincipalPct.toFixed(2)), 25);
  assert.equal(Number(memoryExposure.grossEffectiveExposurePct.toFixed(2)), 50);
  const decision = evaluateOrderDiscipline({
    ...disciplineBase,
    exposureAfter: memoryExposure,
    projectedPositionQuantity: 171.45,
  });
  assert.equal(decision.allowed, false);
  assert.ok(
    decision.hardBlockReasons.some((reason) => reason.code === "RISK_THEME_EFFECTIVE_GROSS_MAX"),
  );
  assert.ok(
    decision.hardBlockReasons.some(
      (reason) => reason.code === "LEVERAGED_ETF_TOTAL_PRINCIPAL_MAX",
    ),
  );
});

test("无 Stop Price 的新增风险订单直接 BLOCK", () => {
  const decision = evaluateOrderDiscipline({ ...disciplineBase, stopPrice: undefined });
  assert.equal(decision.allowed, false);
  assert.ok(decision.hardBlockReasons.some((reason) => reason.code === "MISSING_STOP_PRICE"));
});

test("杠杆亏损仓补仓仅允许首次成交前批准且在最大风险内的 Scale Plan", () => {
  const firstFillAt = new Date("2024-02-05T00:00:00.000Z");
  const blocked = evaluateOrderDiscipline({
    ...disciplineBase,
    currentPositionQuantity: 20,
    firstFillAt,
    positionUnrealizedPnl: -100,
  });
  assert.ok(
    blocked.hardBlockReasons.some((reason) => reason.code === "LEVERAGED_ETF_LOSS_ADD_BLOCK"),
  );
  const allowed = evaluateOrderDiscipline({
    ...disciplineBase,
    currentPositionQuantity: 20,
    firstFillAt: null,
    positionUnrealizedPnl: -100,
    scalePlan: {
      allowOvernight: false,
      approvedAt: new Date("2024-02-04T10:00:00.000Z"),
      createdAt: new Date("2024-02-04T09:00:00.000Z"),
      expiresAt: null,
      finalStopPrice: 19.5,
      firstFilledAt: firstFillAt,
      id: "scale-plan-memory-v1",
      maxAccountRiskPct: 0.25,
      maxPrincipalPercent: 5,
      maxTotalQuantity: 40,
      status: "APPROVED",
      tranches: [{ price: 20, quantity: 10 }],
      version: 1,
    },
  });
  assert.equal(allowed.allowed, true);
});

test("成交后下移或取消 Stop，以及增加亏损仓数量，均为风险扩大改单", () => {
  for (const amendment of [
    { cancelStop: false, newQuantity: 100, newStopPrice: 18 },
    { cancelStop: true, newQuantity: 100, newStopPrice: null },
    { cancelStop: false, newQuantity: 110, newStopPrice: 19 },
  ]) {
    const decision = evaluateRiskAmendment({
      ...amendment,
      currentQuantity: 100,
      currentStopPrice: 19,
      increasesExposure: true,
      positionDirection: "LONG",
      protectiveStop: true,
      unrealizedPnl: -500,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, "RISK_INCREASING_AMENDMENT");
  }
});

test("杠杆隔夜必须预先声明且 Gap Stress 必须通过", () => {
  const missing = evaluateOrderDiscipline({ ...disciplineBase, allowOvernight: undefined });
  assert.ok(
    missing.hardBlockReasons.some((reason) => reason.code === "OVERNIGHT_PERMISSION_REQUIRED"),
  );
  const stressed = evaluateOrderDiscipline({
    ...disciplineBase,
    allowOvernight: true,
    exposureAfter: memoryExposure,
    projectedPositionQuantity: 500,
  });
  assert.ok(
    stressed.hardBlockReasons.some((reason) => reason.code === "OVERNIGHT_GAP_STRESS_FAILED"),
  );
  assert.deepEqual(stressed.gapStress?.scenarios.map((scenario) => scenario.gapPct), [
    -10,
    -20,
    -25,
    -35,
  ]);
});

test("多空可以降低 Net，但不能抵消 Gross 或 Theme 硬上限", () => {
  const hedged = calculateEffectiveExposure(120_000, [
    {
      ...disciplineBase.instrument,
      marketValue: 26_000,
      symbol: "MEMORY_LONG",
    },
    {
      ...disciplineBase.instrument,
      direction: "SHORT",
      marketValue: 25_000,
      symbol: "MEMORY_SHORT",
    },
  ]);
  assert.equal(hedged.grossEffectiveExposure, 102_000);
  assert.equal(hedged.netDirectionalExposure, 2_000);
  const decision = evaluateOrderDiscipline({ ...disciplineBase, exposureAfter: hedged });
  assert.ok(
    decision.hardBlockReasons.some((reason) => reason.code === "RISK_THEME_EFFECTIVE_GROSS_MAX"),
  );
});

test("Kill Switch 开启后所有新增风险订单 BLOCK", () => {
  const decision = evaluateOrderDiscipline({
    ...disciplineBase,
    killSwitchLevel: "LEVEL_4_LOCKDOWN",
  });
  assert.ok(decision.hardBlockReasons.some((reason) => reason.code === "KILL_SWITCH"));
});

test("Profit Giveback Guard 按配置阈值分级且硬熔断不可 Override", () => {
  const states = [
    [950, "NORMAL"],
    [800, "REDUCED_RISK"],
    [700, "DEFENSIVE"],
    [550, "KILL_SWITCH"],
  ] as const;
  for (const [currentYtdPnl, expectedState] of states) {
    const result = calculateProfitGiveback({
      currentYtdPnl,
      defensivePct: 25,
      killSwitchPct: 40,
      peakYtdPnl: 1_000,
      reducedRiskPct: 15,
    });
    assert.equal(result.state, expectedState);
  }
  assert.equal(HARD_DISCIPLINE_RULES.has("GIVEBACK_KILL_SWITCH"), true);
  assert.equal(HARD_DISCIPLINE_RULES.has("RISK_INCREASING_AMENDMENT"), true);
  assert.equal(HARD_DISCIPLINE_RULES.has("MISSING_RISK_CONTEXT"), true);
  const normal = evaluateOrderDiscipline({
    ...disciplineBase,
    quantity: 700,
    stopPrice: 19.7,
  });
  const reduced = evaluateOrderDiscipline({
    ...disciplineBase,
    profitGivebackState: "REDUCED_RISK",
    quantity: 700,
    stopPrice: 19.7,
  });
  assert.equal(normal.budget.allowed, true);
  assert.equal(reduced.budget.limitPct, 0.125);
  assert.equal(reduced.budget.allowed, false);
});

test("重复 Risk Discipline 任务使用相同幂等键", () => {
  const payload = {
    phase: "PROPOSAL",
    proposalKey: "memory-incident-order",
    ruleCode: "RISK_THEME_EFFECTIVE_GROSS_MAX",
  };
  assert.equal(riskDisciplineEventKey(payload), riskDisciplineEventKey(payload));
  assert.notEqual(
    riskDisciplineEventKey(payload),
    riskDisciplineEventKey({ ...payload, ruleCode: "MISSING_STOP_PRICE" }),
  );
});

test("所有 Risk Discipline 拒绝理由使用唯一幂等键持久化审计", () => {
  const serviceSource = readFileSync(
    resolve(__dirname, "../risk-discipline/risk-discipline.service.ts"),
    "utf8",
  );
  const brokerSource = readFileSync(
    resolve(__dirname, "../broker-execution/broker-paper.service.ts"),
    "utf8",
  );
  assert.match(serviceSource, /riskDisciplineEvent\.upsert/);
  assert.match(serviceSource, /brokerPaperExecution\.findFirst/);
  assert.match(brokerSource, /for \(const reason of decision\.hardBlockReasons\)/);
  assert.match(brokerSource, /where: \{ idempotencyKey \}/);
  assert.match(brokerSource, /decision: "BLOCKED"/);
});
