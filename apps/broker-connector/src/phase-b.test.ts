import assert from "node:assert/strict";
import test from "node:test";
import { parseExecutionTime } from "./execution-time";
import { PAPER_EXECUTION_CAPABILITIES } from "./paper-execution-provider";

test("TWS 时间按显式时区解释，未知时间不得用当前时间替代", () => {
  assert.equal(parseExecutionTime("20261009 09:30:00 America/New_York"), "2026-10-09T13:30:00.000Z");
  assert.equal(parseExecutionTime("20261009 09:30:00", "Asia/Shanghai"), "2026-10-09T01:30:00.000Z");
  assert.throws(() => parseExecutionTime("20261009 09:30:00"), /requires/);
  assert.throws(() => parseExecutionTime("invalid"), /refusing/);
  assert.throws(() => parseExecutionTime("20261101 01:30:00 America/New_York"), /ambiguous/);
});

test("所有 Live 写能力永久为 false", () => {
  assert.equal(PAPER_EXECUTION_CAPABILITIES.canPlaceLiveOrders, false);
  assert.equal(PAPER_EXECUTION_CAPABILITIES.canModifyLiveOrders, false);
  assert.equal(PAPER_EXECUTION_CAPABILITIES.canCancelLiveOrders, false);
  assert.equal(Object.isFrozen(PAPER_EXECUTION_CAPABILITIES), true);
});
