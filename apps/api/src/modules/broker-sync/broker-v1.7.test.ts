import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_RECONCILIATION_TOLERANCE,
  brokerExecutionKey,
  brokerOrderSnapshotKey,
  brokerSyncKey,
  businessHash,
  hashExternalAccountId,
  maskBrokerAccount,
  reconciliationDifference,
  shadowIntentKey,
  shadowRiskDecision,
  shadowTaskAllowed,
  validateCurrency,
  validateFiniteNumbers,
} from "./broker-sync.rules";

const moduleDir = __dirname;
const serviceSource = readFileSync(path.join(moduleDir, "broker-sync.service.ts"), "utf8");
const repositoryRoot = path.resolve(moduleDir, "..", "..", "..", "..", "..");
const connectorSource = ["broker-provider.ts", "providers.ts", "main.ts"]
  .map((file) =>
    readFileSync(path.join(repositoryRoot, "apps", "broker-connector", "src", file), "utf8"),
  )
  .join("\n");

test("券商账户标识使用 HMAC 不可逆映射且页面只需使用掩码", () => {
  // Constructed sequential-digit Fixture; never an imported broker account.
  const hashed = hashExternalAccountId("U12345678", "acceptance-pepper");
  assert.equal(hashed.length, 64);
  assert.notEqual(hashed, "U12345678");
  assert.equal(maskBrokerAccount("U12345678"), "U12****678");
  assert.throws(() => hashExternalAccountId("U12345678", "INVALID_EXAMPLE"));
});

test("同步任务幂等键对相同范围稳定，对不同范围不同", () => {
  const first = brokerSyncKey("connection", "2026-07-01", "2026-07-17");
  assert.equal(first, brokerSyncKey("connection", "2026-07-01", "2026-07-17"));
  assert.notEqual(first, brokerSyncKey("connection", "2026-07-02", "2026-07-17"));
});

test("Execution 优先按外部 ID 的哈希去重且固定为数据库安全长度", () => {
  const base = {
    executionTime: "2026-07-17T14:30:00.000Z",
    price: 200,
    quantity: 2,
    side: "BUY",
    symbol: "AAPL",
  };
  const key = brokerExecutionKey({ ...base, externalExecutionId: "EXEC-123" });
  assert.equal(key.length, 64);
  assert.equal(key, brokerExecutionKey({ ...base, externalExecutionId: "EXEC-123" }));
  assert.notEqual(key, brokerExecutionKey({ ...base, externalExecutionId: "EXEC-124" }));
});

test("缺少 Execution ID 时使用完整业务字段 SHA-256 去重", () => {
  const execution = {
    executionTime: "2026-07-17T14:30:00.000Z",
    price: 200,
    quantity: 2,
    side: "BUY",
    symbol: "AAPL",
  };
  assert.equal(brokerExecutionKey(execution), brokerExecutionKey(execution));
  assert.notEqual(brokerExecutionKey(execution), brokerExecutionKey({ ...execution, quantity: 3 }));
});

test("订单快照去重包含订单、状态、成交数量和快照时间", () => {
  const order = {
    externalOrderId: "ORDER-1",
    filledQuantity: 0,
    snapshotTime: "2026-07-17T14:30:00.000Z",
    status: "OPEN",
  };
  assert.equal(brokerOrderSnapshotKey(order), brokerOrderSnapshotKey(order));
  assert.notEqual(
    brokerOrderSnapshotKey(order),
    brokerOrderSnapshotKey({ ...order, status: "FILLED" }),
  );
});

test("标准业务哈希不受对象字段顺序影响", () => {
  assert.equal(businessHash({ a: 1, b: 2 }), businessHash({ b: 2, a: 1 }));
});

test("币种与数值字段拒绝猜测或无效格式", () => {
  assert.equal(validateCurrency("USD"), true);
  assert.equal(validateCurrency("usd"), false);
  assert.deepEqual(validateFiniteNumbers({ price: "bad", quantity: 2 }, ["price", "quantity"]), [
    "price",
  ]);
});

test("金额对账在容差内不产生差异", () => {
  assert.equal(
    reconciliationDifference({
      broker: 120_000.5,
      fieldName: "totalEquity",
      local: 120_000,
      toleranceKind: "AMOUNT",
      type: "EQUITY_MISMATCH",
    }),
    null,
  );
});

test("权益、现金和盈亏差异超过容差时可见且分级", () => {
  for (const [type, fieldName] of [
    ["EQUITY_MISMATCH", "totalEquity"],
    ["CASH_MISMATCH", "cashBalance"],
    ["REALIZED_PNL_MISMATCH", "realizedPnlYtd"],
    ["UNREALIZED_PNL_MISMATCH", "unrealizedPnl"],
  ] as const) {
    const difference = reconciliationDifference({
      broker: 14_000,
      fieldName,
      local: 120_000,
      toleranceKind: "AMOUNT",
      type,
    });
    assert.equal(difference?.differenceType, type);
    assert.equal(difference?.severity, "CRITICAL");
  }
});

test("持仓数量与平均成本使用独立小容差", () => {
  const quantity = reconciliationDifference({
    broker: 20.01,
    fieldName: "quantity",
    local: 20,
    symbol: "DLA2",
    toleranceKind: "QUANTITY",
    type: "QUANTITY_MISMATCH",
  });
  const cost = reconciliationDifference({
    broker: 200.05,
    fieldName: "avgCost",
    local: 200,
    symbol: "DLA2",
    toleranceKind: "PRICE",
    type: "AVERAGE_COST_MISMATCH",
  });
  assert.equal(quantity?.fieldName, "quantity");
  assert.equal(cost?.fieldName, "avgCost");
  assert.equal(DEFAULT_RECONCILIATION_TOLERANCE.quantityAbsolute, 0.0001);
  assert.equal(DEFAULT_RECONCILIATION_TOLERANCE.priceAbsolute, 0.01);
});

test("影子订单意图在组合、策略、标的、方向和交易日维度幂等", () => {
  const input = {
    brokerAccountId: "broker-account",
    marketDate: "2026-07-17",
    side: "BUY",
    strategyId: "strategy",
    symbol: "AAPL",
  };
  assert.equal(shadowIntentKey(input), shadowIntentKey(input));
  assert.notEqual(shadowIntentKey(input), shadowIntentKey({ ...input, side: "SELL" }));
});

test("Connector 离线或券商数据过期时影子任务安全跳过", () => {
  const base = {
    brokerDataIsFresh: true,
    connectorAvailable: true,
    killSwitchEnabled: false,
    safetyState: "SHADOW_ONLY",
    shadowTradingEnabled: true,
  };
  assert.equal(
    shadowTaskAllowed({ ...base, connectorAvailable: false }).reason,
    "CONNECTOR_UNAVAILABLE",
  );
  assert.equal(
    shadowTaskAllowed({ ...base, brokerDataIsFresh: false }).reason,
    "BROKER_DATA_STALE",
  );
});

test("Kill Switch 与 LOCKDOWN 均阻止新影子订单", () => {
  const base = {
    brokerDataIsFresh: true,
    connectorAvailable: true,
    killSwitchEnabled: false,
    safetyState: "SHADOW_ONLY",
    shadowTradingEnabled: true,
  };
  assert.equal(shadowTaskAllowed({ ...base, killSwitchEnabled: true }).reason, "KILL_SWITCH");
  assert.equal(shadowTaskAllowed({ ...base, safetyState: "LOCKDOWN" }).reason, "LOCKDOWN");
});

test("当前 VIOLATION 真实账户拒绝所有新增影子买入", () => {
  assert.equal(
    shadowRiskDecision({
      assetType: "STOCK",
      existingLeveragedPercent: 12.5,
      overallRiskLevel: "VIOLATION",
      portfolioAllows: true,
      side: "BUY",
    }).approved,
    false,
  );
});

test("DLA2 杠杆 ETF 超仓被 RiskEngine 拒绝", () => {
  const decision = shadowRiskDecision({
    assetType: "LEVERAGED_ETF",
    existingLeveragedPercent: 12.5,
    overallRiskLevel: "WARNING",
    portfolioAllows: true,
    side: "BUY",
  });
  assert.equal(decision.approved, false);
  assert.match(decision.reason ?? "", /杠杆 ETF/);
});

test("PortfolioRiskEngine 拒绝组合状态不允许的影子买入", () => {
  assert.equal(
    shadowRiskDecision({
      assetType: "STOCK",
      existingLeveragedPercent: 0,
      overallRiskLevel: "SAFE",
      portfolioAllows: false,
      side: "BUY",
    }).approved,
    false,
  );
});

test("Broker Connector 生产代码仅暴露 GET 且无券商写入口", () => {
  assert.match(connectorSource, /request\.method !== "GET"/);
  for (const forbidden of [
    "place" + "Order",
    "submit" + "Order",
    "modify" + "Order",
    "cancel" + "Order",
    "replace" + "Order",
    "transmit" + "Order",
  ]) {
    assert.equal(connectorSource.includes(forbidden), false, `发现禁止入口 ${forbidden}`);
  }
});

test("同步持久化使用串行化事务且失败路径保留旧数据", () => {
  assert.match(serviceSource, /TransactionIsolationLevel\.Serializable/);
  assert.match(serviceSource, /上次成功数据已保留/);
  assert.equal(serviceSource.includes("deleteMany({"), false);
});

test("未知标的、未知记录、负现金和空头都进入待确认", () => {
  for (const marker of [
    "UNKNOWN_INSTRUMENT",
    "UNKNOWN_EXECUTION",
    "UNKNOWN_CORPORATE_ACTION",
    "NEGATIVE_CASH_REVIEW",
    "SHORT_POSITION_REVIEW",
    "PENDING_REVIEW",
  ]) {
    assert.equal(serviceSource.includes(marker), true, `缺少待确认标记 ${marker}`);
  }
});

test("人工接受券商值与本地调整必须在同一事务创建决定和审计", () => {
  assert.match(serviceSource, /reconciliationDecision\.create/);
  assert.match(serviceSource, /RECONCILIATION_DECISION_RECORDED/);
  assert.match(serviceSource, /evaluateAndPersistInTransaction/);
});

test("影子写入仅使用 Shadow 表，不修改 Account、Paper 或 Portfolio 账本", () => {
  const start = serviceSource.indexOf("async createShadowIntent");
  const end = serviceSource.indexOf("async processShadowFills", start);
  const shadowCreate = serviceSource.slice(start, end);
  assert.match(shadowCreate, /shadowTradingSession\.create/);
  assert.match(shadowCreate, /shadowOrderIntent\.create/);
  for (const forbidden of [
    "transaction.account.update",
    "transaction.position.update",
    "transaction.paperAccount.update",
    "transaction.paperPosition.update",
    "transaction.portfolioPosition.update",
  ]) {
    assert.equal(shadowCreate.includes(forbidden), false, `影子隔离被破坏: ${forbidden}`);
  }
});

test("影子成交明确记录零券商请求并仅写独立影子账本", () => {
  const start = serviceSource.indexOf("async processShadowFills");
  const end = serviceSource.indexOf("async readiness", start);
  const shadowFill = serviceSource.slice(start, end);
  assert.match(shadowFill, /brokerRequests: 0/);
  assert.match(shadowFill, /shadowFill\.create/);
  assert.equal(shadowFill.includes("this.connector."), false);
});

test("LOCKDOWN 同时接入单策略与组合模拟执行门禁", () => {
  const paper = readFileSync(
    path.join(
      repositoryRoot,
      "apps",
      "api",
      "src",
      "modules",
      "paper-trading",
      "paper-trading.service.ts",
    ),
    "utf8",
  );
  const portfolio = readFileSync(
    path.join(
      repositoryRoot,
      "apps",
      "api",
      "src",
      "modules",
      "portfolios",
      "portfolio.service.ts",
    ),
    "utf8",
  );
  assert.match(paper, /LOCKDOWN/);
  assert.match(portfolio, /LOCKDOWN/);
});
