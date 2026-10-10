import assert from "node:assert/strict";
import test from "node:test";

import {
  calculatePaperFill,
  canResumePaperExecution,
  canTransitionPaperDeployment,
  paperExecutionKey,
  paperGuardrailViolations,
} from "./paper-trading.rules";

test("Quant Engine 临时失败仅在尚未生成信号和订单时允许复用原执行记录", () => {
  assert.equal(canResumePaperExecution("FAILED", false, 0), true);
  assert.equal(canResumePaperExecution("FAILED", true, 0), false);
  assert.equal(canResumePaperExecution("FAILED", false, 1), false);
  assert.equal(canResumePaperExecution("RUNNING", false, 0), false);
  assert.equal(canResumePaperExecution("COMPLETED_NO_SIGNAL", false, 0), false);
});

test("模拟买入使用下一交易日开盘并计入滑点、手续费且现金不为负", () => {
  const fill = calculatePaperFill({
    side: "BUY",
    signalTradeDate: "2026-07-16",
    marketTradeDate: "2026-07-17",
    open: 100,
    commissionRate: 0.001,
    slippageRate: 0.0005,
    requestedAmount: 10_000,
    cashBalance: 10_000,
    positionQuantity: 0,
    positionAvgCost: 0,
  });
  assert.equal(fill.price, 100.05);
  assert.ok(fill.commission > 0);
  assert.ok(fill.slippage > 0);
  assert.ok(fill.cashAfter >= 0);
});

test("同日开盘成交被拒绝，严格执行 T+1 开盘规则", () => {
  assert.throws(
    () =>
      calculatePaperFill({
        side: "BUY",
        signalTradeDate: "2026-07-17",
        marketTradeDate: "2026-07-17",
        open: 100,
        commissionRate: 0,
        slippageRate: 0,
        requestedAmount: 1000,
        cashBalance: 1000,
        positionQuantity: 0,
        positionAvgCost: 0,
      }),
    /下一交易日/,
  );
});

test("现金不足时拒绝买入且不会生成负现金", () => {
  assert.throws(
    () =>
      calculatePaperFill({
        side: "BUY",
        signalTradeDate: "2026-07-16",
        marketTradeDate: "2026-07-17",
        open: 100,
        commissionRate: 0.001,
        slippageRate: 0,
        requestedAmount: 1000,
        cashBalance: 10,
        positionQuantity: 0,
        positionAvgCost: 0,
      }),
    /现金不足/,
  );
});

test("部分卖出按平均成本计算已实现盈亏并保留剩余持仓", () => {
  const fill = calculatePaperFill({
    side: "SELL",
    signalTradeDate: "2026-07-16",
    marketTradeDate: "2026-07-17",
    open: 120,
    commissionRate: 0.001,
    slippageRate: 0,
    requestedQuantity: 4,
    cashBalance: 100,
    positionQuantity: 10,
    positionAvgCost: 100,
  });
  assert.equal(fill.quantity, 4);
  assert.ok(fill.realizedPnl > 79 && fill.realizedPnl < 80);
  assert.equal(10 - fill.quantity, 6);
});

test("执行幂等键对相同部署、标的、日期和版本完全一致", async () => {
  const requests = Array.from({ length: 20 }, () =>
    Promise.resolve(paperExecutionKey("deployment", "AAPL", "2026-07-17", 1)),
  );
  const keys = await Promise.all(requests);
  assert.equal(new Set(keys).size, 1);
  assert.notEqual(keys[0], paperExecutionKey("deployment", "AAPL", "2026-07-18", 1));
});

test("策略暂停、停止与 Kill Switch 状态机禁止继续启动或下单", () => {
  assert.equal(canTransitionPaperDeployment("PAPER_APPROVED", "START", false), true);
  assert.equal(canTransitionPaperDeployment("PAPER_RUNNING", "START", false), false);
  assert.equal(canTransitionPaperDeployment("PAPER_RUNNING", "PAUSE", false), true);
  assert.equal(canTransitionPaperDeployment("PAPER_STOPPED", "START", false), false);
  assert.equal(canTransitionPaperDeployment("PAPER_PAUSED", "START", true), false);
});

test("模拟交易停止条件同时覆盖数据完整性、日亏、回撤、连亏、持仓与订单上限", () => {
  const violations = paperGuardrailViolations({
    killSwitchEnabled: true,
    dataAvailable: false,
    stopLossCondition: "",
    exitCondition: null,
    dailyLossPercent: -5,
    maxDrawdownPercent: -20,
    consecutiveLosses: 5,
    positionCount: 10,
    orderCountToday: 10,
  });
  assert.deepEqual(violations, [
    "PAPER_KILL_SWITCH",
    "PAPER_DATA_INTEGRITY",
    "ENTRY_EXIT_REQUIRED",
    "PAPER_DAILY_LOSS_MAX",
    "PAPER_ACCOUNT_DRAWDOWN_MAX",
    "PAPER_CONSECUTIVE_LOSSES_MAX",
    "PAPER_MAX_POSITIONS",
    "PAPER_MAX_ORDERS_PER_DAY",
  ]);
});

test("真实账户模型名称不出现在纯模拟账本计算输入中", () => {
  const inputKeys = Object.keys(
    calculatePaperFill({
      side: "BUY",
      signalTradeDate: "2026-07-16",
      marketTradeDate: "2026-07-17",
      open: 10,
      commissionRate: 0,
      slippageRate: 0,
      requestedAmount: 100,
      cashBalance: 100,
      positionQuantity: 0,
      positionAvgCost: 0,
    }),
  );
  assert.equal(
    inputKeys.some((key) => ["Account", "Position", "Trade"].includes(key)),
    false,
  );
});
