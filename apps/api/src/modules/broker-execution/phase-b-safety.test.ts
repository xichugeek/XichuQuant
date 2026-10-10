import assert from "node:assert/strict";
import test from "node:test";
import { assertDemoSeedTarget } from "../../../../../database/prisma/seed-safety";
import { cashFlowAdjustedSeries, realizedTradeProfitFactor } from "../accounts/performance-accounting";
import { RiskEngineService } from "../risk/risk-engine.service";
import { calculateEffectiveExposure, DEFAULT_DISCIPLINE_LIMITS, evaluateTradeRiskBudget } from "../risk-discipline/risk-discipline.rules";
import { evaluateBrokerPaperDeploymentEligibility, matchBrokerOrderIdentity, orderLifecycleStatus, protectiveStopCompliant, verifiedRealtimeQuote } from "./broker-paper.rules";
import { applyReplayFill } from "../risk-discipline/replay-accounting";

test("未知/终止状态不被部分或全成交数量掩盖；Short 复盘正确记平仓与反转", () => {
  const order = { current: "SUBMITTED", externalStatus: "UNKNOWN", quantity: 40, filledQuantity: 40 };
  assert.equal(orderLifecycleStatus(order), "UNKNOWN");
  assert.equal(orderLifecycleStatus({ ...order, externalStatus: "CANCELLED", filledQuantity: 10 }), "CANCELLED");
  assert.equal(orderLifecycleStatus({ ...order, externalStatus: "FILLED", filledQuantity: 10 }), "UNKNOWN");
  const identity = { socketId: "10", permanentId: "900", orderRef: "SYNTHETIC_PLAN" };
  const remapped = { externalOrderId: "11", externalPermanentId: "900", orderReference: "SYNTHETIC_PLAN" };
  assert.deepEqual(matchBrokerOrderIdentity([remapped], identity), remapped);
  assert.throws(() => matchBrokerOrderIdentity([{ ...remapped, externalOrderId: "10", externalPermanentId: "901" }], identity), /Conflicting/);
  assert.throws(() => matchBrokerOrderIdentity([remapped, { ...remapped, externalOrderId: "12" }], identity), /Ambiguous/);
  const short = applyReplayFill({ quantity: 0, averageCost: 0, realizedPnl: 0 }, "SELL", 10, 100, 1);
  assert.equal(short.quantity, -10);
  const covered = applyReplayFill(short, "BUY", 4, 90, 1);
  assert.equal(covered.quantity, -6);
  assert.equal(covered.realizedPnl, 38);
  const reversed = applyReplayFill(covered, "BUY", 8, 110, 1);
  assert.equal(reversed.quantity, 2);
  assert.equal(reversed.averageCost, 110);
  assert.equal(reversed.realizedPnl, -23);
});

test("Seed 拒绝业务库、缺少确认及部分匹配数据库名称", () => {
  for (const [url, confirmation] of [
    ["sqlserver://localhost;database=UserBusinessDb;", "CREATE_FICTIONAL_DEMO"],
    ["sqlserver://localhost;database=XichuRiskDemo_original;", "CREATE_FICTIONAL_DEMO"],
    ["sqlserver://localhost;database=XichuRiskPhaseBTest_original;", "CREATE_FICTIONAL_DEMO"],
    ["sqlserver://localhost;database=XichuQuantLocal_personal;", "CREATE_FICTIONAL_DEMO"],
    ["sqlserver://localhost;database=prefixXichuQuantDemo_test;", "CREATE_FICTIONAL_DEMO"],
    ["sqlserver://localhost;database=XichuQuantDemo_;", "CREATE_FICTIONAL_DEMO"],
    ["sqlserver://localhost;database=XichuQuantDemo_test-invalid;", "CREATE_FICTIONAL_DEMO"],
    ["sqlserver://localhost;database=XichuQuantDemo_test;", ""],
    ["sqlserver://localhost;database=XichuQuantDemo_test;DROP DATABASE;", ""],
    ["sqlserver://localhost;database=XichuQuantDemo_test;database=UserBusinessDb;", "CREATE_FICTIONAL_DEMO"],
  ]) assert.throws(() => assertDemoSeedTarget(url, confirmation));
  assert.equal(assertDemoSeedTarget("sqlserver://localhost;database=XichuQuantPhaseBTest_fixture;", "CREATE_FICTIONAL_DEMO"), "XichuQuantPhaseBTest_fixture");
  assert.equal(assertDemoSeedTarget("sqlserver://localhost;database=XichuQuantDemo_local;", "CREATE_FICTIONAL_DEMO"), "XichuQuantDemo_local");
});

test("REALTIME 文本不足以证明行情；未来、延迟、冻结、未知和过期全部拒绝", () => {
  const now = Date.parse("2026-10-09T15:00:00Z");
  const quote = { accepted: true, marketDataSource: "IBKR_TWS_SOCKET", marketDataTime: "2026-10-09T14:59:50Z", marketDataType: "REALTIME", marketDataQuality: "VERIFIED_TOP_OF_BOOK", referencePrice: 100 };
  assert.equal(verifiedRealtimeQuote(quote, now), true);
  for (const patch of [
    { accepted: false }, { marketDataSource: undefined }, { marketDataQuality: "UNKNOWN" },
    ...["UNKNOWN", "DELAYED", "FROZEN", "DELAYED_FROZEN"].map((marketDataType) => ({ marketDataType })),
    { marketDataTime: "invalid" }, { marketDataTime: "2026-10-09T15:01:00Z" },
    { marketDataTime: "2026-10-09T14:58:00Z" }, { referencePrice: Number.NaN },
  ]) assert.equal(verifiedRealtimeQuote({ ...quote, ...patch }, now), false);
});

test("部分成交的有效保护 Stop 必须覆盖剩余持仓且不能产生反向超量", () => {
  const now = Date.parse("2026-10-09T15:00:00Z");
  const protection = { filledQuantity: 40, closedQuantity: 10, stopQuantity: 30, stopStatus: "SUBMITTED", stopPrice: 98, stopObservedAt: new Date(now) };
  assert.equal(protectiveStopCompliant(protection, now), true);
  for (const patch of [
    { stopQuantity: null }, { stopQuantity: 29 }, { stopQuantity: 40 }, { stopQuantity: 41 }, { stopPrice: null }, { stopObservedAt: null },
    { stopObservedAt: new Date(now - 91000) },
    ...["REJECTED", "CANCELLED", "EXPIRED", "INACTIVE", "UNKNOWN"].map((stopStatus) => ({ stopStatus })),
  ]) assert.equal(protectiveStopCompliant({ ...protection, ...patch }, now), false);
  assert.equal(protectiveStopCompliant({ ...protection, closedQuantity: 40, stopQuantity: null }, now), true);
});

test("SHORT 负市值不再次反向，Gross 与本金上限使用绝对值", () => {
  const base = { industry: "LAB", sector: "LAB", underlyingSymbol: "FICTIONAL", leveragedETF: true, leverageMultiplier: 2, riskTheme: "SYNTHETIC_LAB", symbol: "LAB2", marketValue: -15000, direction: "SHORT" };
  const exposure = calculateEffectiveExposure(120000, [base, { ...base, symbol: "LAB3", marketValue: 15000, direction: "LONG" }]);
  assert.equal(exposure.grossEffectiveExposure, 60000);
  assert.equal(exposure.netDirectionalExposure, 0);
  const risk = new RiskEngineService().evaluate({ id: "synthetic", name: "SYNTHETIC", totalEquity: 120000, cashBalance: 120000, realizedPnlYtd: 0 }, [{
    id: "short", name: "Synthetic short", assetType: "LEVERAGED_ETF", category: null, theme: "LAB", quantity: -100,
    avgCost: 100, currentPrice: 150, ...base,
  }], []);
  assert.equal(risk.positions[0]!.unrealizedPnl, -5000);
  assert.equal(risk.positions[0]!.costAmount, 10000);
  assert.equal(risk.leveragedEtfValue, 15000);
  assert.equal(risk.overallRiskLevel, "VIOLATION");
});

test("资金流不是收益：入金、出金和后续损失正确影响 TWR、PnL 与回撤", () => {
  const date = (day: number) => new Date(Date.UTC(2026, 0, day));
  const series = cashFlowAdjustedSeries([
    { time: date(1), equity: 100000 }, { time: date(2), equity: 125000 },
    { time: date(3), equity: 115000 }, { time: date(4), equity: 103500 },
  ], [{ time: date(2), amount: 25000 }, { time: date(3), amount: -10000 }]);
  assert.equal(series[1]!.periodPnl, 0);
  assert.equal(series[2]!.periodReturnPercent, 0);
  assert.equal(series[3]!.periodPnl, -11500);
  assert.ok(Math.abs(series[3]!.periodReturnPercent + 10) < 1e-9);
  assert.ok(Math.abs(series[3]!.drawdownPercent + 10) < 1e-9);
  assert.equal(realizedTradeProfitFactor([200, -100, 100]), 3);
});

test("损坏配置、非数字权益/费用不能借比较 NaN 绕过预算", () => {
  const config = { deploymentRiskConfigJson: "broken", deploymentSymbolUniverseJson: '["AAPL"]', strategySymbolUniverseJson: '["AAPL"]', symbol: "AAPL" };
  assert.equal(evaluateBrokerPaperDeploymentEligibility(config).allowed, false);
  const budget = { accountEquity: 120000, entryPrice: 100, estimatedFees: 1, estimatedSlippage: 1, exitCondition: "stop", increasesExposure: true, leveragedETF: false, limits: DEFAULT_DISCIPLINE_LIMITS, quantity: 10, stopPrice: 98 };
  for (const patch of [{ accountEquity: Number.NaN }, { quantity: -1 }, { estimatedFees: -1 }, { estimatedSlippage: Number.NaN }]) {
    assert.equal(evaluateTradeRiskBudget({ ...budget, ...patch }).allowed, false);
  }
});
