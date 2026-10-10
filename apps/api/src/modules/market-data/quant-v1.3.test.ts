import assert from "node:assert/strict";
import test from "node:test";

import { ServiceUnavailableException } from "@nestjs/common";

import { PrismaService } from "../../prisma/prisma.service";
import { RiskEngineService } from "../risk/risk-engine.service";
import { SignalService } from "../signals/signal.service";
import { markMarketDataDuplicates } from "./market-data-dedup";
import { MarketDataParserService } from "./market-data-parser.service";
import { QuantEngineClient } from "../quant-engine/quant-engine.client";

test("CSV 行情解析、OHLC 异常检查和文件内去重", () => {
  const csv = [
    "Date,Symbol,Open,High,Low,Close,Adj Close,Volume,Dividend,Split Factor",
    "2026-07-15,AAPL,210,215,208,214,214,1000000,0,1",
    "2026-07-15,AAPL,210,215,208,214,214,1000000,0,1",
    "2026-07-16,AAPL,220,218,219,217,217,900000,0,1",
  ].join("\n");
  const parsed = new MarketDataParserService().parse(csv, undefined, "CSV_IMPORT");
  assert.equal(parsed.records[0]?.status, "VALID");
  assert.equal(parsed.records[2]?.status, "PENDING");
  assert.match(parsed.records[2]?.errors.join("；") ?? "", /最高价不能低于最低价|开盘价超出/);
  const deduplicated = markMarketDataDuplicates(parsed.records, new Set());
  assert.equal(deduplicated[0]?.status, "VALID");
  assert.equal(deduplicated[1]?.status, "DUPLICATE");
});

test("DLA2 2000 美元信号经过现有 RiskEngine 后明确拒绝", async () => {
  const signal = {
    id: "signal-dla2",
    strategyId: "strategy-buy-and-hold-aapl",
    backtestRunId: null,
    accountId: "account-demo",
    symbol: "DLA2",
    signalType: "BUY",
    signalTime: new Date("2026-07-17T00:00:00Z"),
    requestedAmount: 2000,
    requestedQuantity: null,
    referencePrice: 150,
    stopLossCondition: "跌破 20 美元退出",
    exitCondition: "触发风险线退出",
    status: "GENERATED",
    triggerReason: "测试",
    riskResultJson: null,
    rejectionReason: null,
    reviewedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const account = {
    id: "account-demo",
    name: "虚构演示账户 DEMO",
    totalEquity: 120000,
    cashBalance: 81400,
    realizedPnlYtd: 18000,
  };
  const instruments = [
    ["DLA2", "LEVERAGED_ETF", "STORAGE", 60, 200, 150],
    ["DLB2", "LEVERAGED_ETF", "STORAGE", 100, 90, 60],
    ["QQQM", "ETF", "CORE_INDEX", 40, 320, 320],
    ["VOO", "ETF", "CORE_INDEX", 12, 500, 500],
    ["AAPL", "STOCK", "BIG_TECH", 30, 160, 160],
  ].map(([symbol, assetType, theme, quantity, avgCost, currentPrice]) => ({
    id: `position-${symbol}`,
    quantity,
    avgCost,
    currentPrice,
    instrument: {
      id: `instrument-${symbol}`,
      symbol,
      name: symbol,
      assetType,
      category: null,
      theme,
    },
  }));
  const rules = [
    ["LEVERAGED_ETF_SINGLE_MAX", 5],
    ["LEVERAGED_ETF_TOTAL_MAX", 10],
    ["SINGLE_STOCK_MAX", 15],
    ["STORAGE_THEME_MAX", 15],
    ["THEME_MAX", 20],
    ["LEVERAGED_ETF_LOSS_DANGER", -15],
    ["ANNUAL_PROFIT_PROTECTION", 50],
  ].map(([code, limitValue]) => ({ code, limitValue, enabled: true, level: "DANGER" }));
  const fakePrisma = {
    strategySignal: {
      findUnique: async () => signal,
      update: async ({ data }: { data: Record<string, unknown> }) => ({
        ...signal,
        ...data,
        account: { id: account.id, name: account.name },
        strategy: { id: signal.strategyId, name: "测试策略" },
      }),
    },
    account: { findUnique: async () => account, findFirst: async () => account },
    instrument: { findUnique: async () => instruments[0]?.instrument },
    position: { findMany: async () => instruments },
    riskRule: { findMany: async () => rules },
  } as unknown as PrismaService;
  const result = await new SignalService(fakePrisma, new RiskEngineService()).review(signal.id);
  assert.equal(result.status, "RISK_REJECTED");
  const riskResult = result.riskResult as { violations: Array<{ code: string; expectedValue: number }> };
  assert.ok(riskResult.violations.some((item) => item.code === "LEVERAGED_ETF_TOTAL_MAX"));
  assert.ok(
    riskResult.violations.find((item) => item.code === "LEVERAGED_ETF_TOTAL_MAX")!.expectedValue > 10,
  );
});

test("quant-engine 不可用时返回隔离错误", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("connection refused");
  };
  try {
    const config = { get: (_key: string, fallback: unknown) => fallback };
    const client = new QuantEngineClient(config as never);
    await assert.rejects(() => client.runBacktest({}), ServiceUnavailableException);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
