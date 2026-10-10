import assert from "node:assert/strict";
import test from "node:test";

import { MarketDataParserService } from "../market-data/market-data-parser.service";
import { UsMarketCalendarService } from "../market-data/us-market-calendar.service";
import {
  dailyCycleKey,
  observationIsEligible,
  qualityAllowsStrategy,
  taskCanRetry,
} from "./operations.rules";

const calendar = new UsMarketCalendarService();

test("美股交易日历识别周末、休市日和正常交易日", () => {
  assert.equal(calendar.session("2026-07-03").isTradingDay, false);
  assert.equal(calendar.session("2026-07-03").holidayName, "Independence Day");
  assert.equal(calendar.session("2026-07-04").isTradingDay, false);
  assert.equal(calendar.session("2026-07-17").isTradingDay, true);
  assert.equal(calendar.session("2021-12-31").holidayName, "New Year's Day");
});

test("America/New_York 夏令时会改变开盘 UTC 时间", () => {
  assert.equal(
    calendar.session("2026-03-06").sessionOpenUtc?.toISOString(),
    "2026-03-06T14:30:00.000Z",
  );
  assert.equal(
    calendar.session("2026-03-09").sessionOpenUtc?.toISOString(),
    "2026-03-09T13:30:00.000Z",
  );
});

test("交易时钟按夏令时换算常规开盘和 IBKR 夜盘的北京时间", () => {
  const summer = calendar.marketClock(new Date("2026-07-17T12:00:00.000Z"));
  assert.equal(summer.daylightSaving, true);
  assert.equal(summer.regularSession.startBeijing, "21:30");
  assert.equal(summer.regularSession.endBeijing, "04:00");
  assert.equal(summer.regularSession.endDayOffset, 1);
  assert.equal(summer.overnightSession.startBeijing, "08:00");
  assert.equal(summer.overnightSession.endBeijing, "15:50");
  assert.equal(summer.overnightSession.eligibleSymbolsOnly, true);

  const winter = calendar.marketClock(new Date("2026-01-16T12:00:00.000Z"));
  assert.equal(winter.daylightSaving, false);
  assert.equal(winter.regularSession.startBeijing, "22:30");
  assert.equal(winter.regularSession.endBeijing, "05:00");
  assert.equal(winter.overnightSession.startBeijing, "09:00");
  assert.equal(winter.overnightSession.endBeijing, "16:50");
});

test("交易时钟识别常规交易、夜盘和周末休市状态", () => {
  assert.equal(calendar.marketClock(new Date("2026-07-17T14:00:00.000Z")).phase, "REGULAR");
  assert.equal(calendar.marketClock(new Date("2026-07-16T01:00:00.000Z")).phase, "OVERNIGHT");
  assert.equal(calendar.marketClock(new Date("2026-07-18T14:00:00.000Z")).phase, "CLOSED");
});

test("收盘前不会把当日识别为完整交易日", () => {
  assert.equal(
    calendar.latestCompletedSession(new Date("2026-07-17T19:00:00.000Z")).date,
    "2026-07-16",
  );
  assert.equal(
    calendar.latestCompletedSession(new Date("2026-07-17T21:00:00.000Z")).date,
    "2026-07-17",
  );
});

test("每日任务幂等键对同一日期和 Provider 稳定", () => {
  const first = dailyCycleKey("2026-07-17", "SEED_V1_3");
  assert.equal(first, dailyCycleKey("2026-07-17", "SEED_V1_3"));
  assert.notEqual(first, dailyCycleKey("2026-07-18", "SEED_V1_3"));
});

test("数据缺失、异常 OHLC 或零成交量均阻止策略运行", () => {
  assert.equal(
    qualityAllowsStrategy({
      invalidOhlcCount: 0,
      latestComplete: true,
      missingDayCount: 0,
      zeroVolumeCount: 0,
    }),
    true,
  );
  assert.equal(
    qualityAllowsStrategy({
      invalidOhlcCount: 1,
      latestComplete: true,
      missingDayCount: 0,
      zeroVolumeCount: 0,
    }),
    false,
  );
  assert.equal(
    qualityAllowsStrategy({
      invalidOhlcCount: 0,
      latestComplete: false,
      missingDayCount: 1,
      zeroVolumeCount: 0,
    }),
    false,
  );
  assert.equal(
    qualityAllowsStrategy({
      invalidOhlcCount: 0,
      latestComplete: true,
      missingDayCount: 0,
      zeroVolumeCount: 1,
    }),
    false,
  );
});

test("在线与 CSV 行情共用同一 OHLC 校验规则", () => {
  const parser = new MarketDataParserService();
  const errors = parser.validate({
    adjustedClose: 10,
    close: 12,
    currency: "USD",
    dividend: 0,
    high: 11,
    low: 9,
    open: 10,
    source: "TEST",
    splitFactor: 1,
    symbol: "AAPL",
    tradeDate: new Date("2026-07-17T00:00:00Z"),
    volume: 100,
  });
  assert.ok(errors.includes("收盘价超出最高最低区间"));
});

test("PAPER_OBSERVING 未满 20 个交易日不得完成观察", () => {
  assert.equal(
    observationIsEligible({
      eventCount: 2,
      maxDrawdown: -2,
      maxDrawdownLimit: 20,
      requiredTradingDays: 20,
      returnDeviation: 1,
      riskRejectedCount: 0,
      runningTradingDays: 19,
    }),
    false,
  );
  assert.equal(
    observationIsEligible({
      eventCount: 2,
      maxDrawdown: -2,
      maxDrawdownLimit: 20,
      requiredTradingDays: 20,
      returnDeviation: 1,
      riskRejectedCount: 0,
      runningTradingDays: 20,
    }),
    true,
  );
});

test("重大风控拒绝或回测偏差过大时观察期不合格", () => {
  assert.equal(
    observationIsEligible({
      eventCount: 2,
      maxDrawdown: -2,
      maxDrawdownLimit: 20,
      requiredTradingDays: 20,
      returnDeviation: 11,
      riskRejectedCount: 0,
      runningTradingDays: 20,
    }),
    false,
  );
  assert.equal(
    observationIsEligible({
      eventCount: 2,
      maxDrawdown: -2,
      maxDrawdownLimit: 20,
      requiredTradingDays: 20,
      returnDeviation: 1,
      riskRejectedCount: 1,
      runningTradingDays: 20,
    }),
    false,
  );
});

test("失败任务只能在最大次数内使用原幂等键重试", () => {
  assert.equal(taskCanRetry("FAILED", 1, 3), true);
  assert.equal(taskCanRetry("FAILED", 3, 3), false);
  assert.equal(taskCanRetry("COMPLETED", 1, 3), false);
});
