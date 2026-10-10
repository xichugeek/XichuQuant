// 本文件中的券商账户标识均为虚构测试值，禁止复制本机或真实账户标识。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { READ_ONLY_CAPABILITIES } from "./broker-provider";
import { assertLocalGatewayBaseUrl } from "./http-json-client";
import { assertIbkrPaperSession } from "./ibkr-session";
import {
  assertPaperAccountEnvelope,
  assertPaperWriteEnvelope,
  IbkrPaperHttpExecutionProvider,
  PAPER_EXECUTION_CAPABILITIES,
  toIbkrOrderType,
  type PaperOrderInput,
} from "./paper-execution-provider";
import { FixtureBrokerProvider, IbkrReadonlyHttpProvider, OfflineBrokerProvider } from "./providers";
import { parseBrokerEnvironment } from "./runtime-env";
import { connectorResponsePayload, redactSensitive, safeError } from "./security";
import { isDelayedMarketDataNotice, twsSocketConfigFromEnvironment } from "./tws-socket-client";

test("IBKR 延迟行情提示只对当前行情请求降级，不作为致命连接错误", () => {
  assert.equal(
    isDelayedMarketDataNotice([7_100_001, 10167, "Displaying delayed market data"], 7_100_001),
    true,
  );
  assert.equal(
    isDelayedMarketDataNotice([7_100_001, 354, "Delayed market data is available"], 7_100_001),
    true,
  );
  assert.equal(
    isDelayedMarketDataNotice([7_100_002, 10167, "Displaying delayed market data"], 7_100_001),
    false,
  );
  assert.equal(
    isDelayedMarketDataNotice([7_100_001, 200, "No security definition"], 7_100_001),
    false,
  );
});

test("Broker Provider 字段映射保持标准化且账户能力只读", async () => {
  const provider = new FixtureBrokerProvider();
  const [account] = await provider.getAccounts();
  const [position] = await provider.getPositions(account!.externalAccountId);
  assert.equal(account!.baseCurrency, "USD");
  assert.equal(position!.symbol, "DLA2");
  assert.equal(position!.quantity, 60);
  assert.deepEqual(provider.getSupportedCapabilities(), READ_ONLY_CAPABILITIES);
  assert.equal(READ_ONLY_CAPABILITIES.canPlaceOrders, false);
  assert.equal(READ_ONLY_CAPABILITIES.canModifyOrders, false);
  assert.equal(READ_ONLY_CAPABILITIES.canCancelOrders, false);
});

test("OFFLINE Provider 不伪造最新券商数据", async () => {
  const provider = new OfflineBrokerProvider();
  assert.equal((await provider.healthCheck()).status, "OFFLINE");
  await assert.rejects(provider.getAccounts(), /OFFLINE/);
});

test("敏感日志字段和认证片段会被自动脱敏", () => {
  assert.deepEqual(redactSensitive({ accountNumber: "U000", nested: { token: "abc", value: 1 } }), {
    accountNumber: "[REDACTED]",
    nested: { token: "[REDACTED]", value: 1 },
  });
  assert.equal(safeError(new Error("authorization=abc")), "authorization=[REDACTED]");
  assert.equal(
    safeError(new Error("IBKR account DU1234567 rejected")),
    "IBKR account [REDACTED_ACCOUNT] rejected",
  );
  assert.equal(
    safeError(new Error("IBKR account DUX123456 rejected")),
    "IBKR account [REDACTED_ACCOUNT] rejected",
  );
});

test("Connector 成功响应向内部 API 保留账户标识，错误响应继续脱敏", () => {
  const payload = { externalAccountId: "DU1234567", status: "PAPER" };
  assert.deepEqual(connectorResponsePayload(200, payload), payload);
  assert.deepEqual(connectorResponsePayload(503, payload), {
    externalAccountId: "[REDACTED]",
    status: "PAPER",
  });
});

test("只读网关地址禁止内嵌用户名、密码或查询令牌", () => {
  assert.throws(() => new IbkrReadonlyHttpProvider("https://user:pass@localhost:5000"));
  assert.throws(() => new IbkrReadonlyHttpProvider("https://localhost:5000?token=secret"));
  assert.equal(
    assertLocalGatewayBaseUrl("https://localhost:5000/v1/api/", "IBKR Gateway"),
    "https://localhost:5000/v1/api",
  );
  assert.throws(() => assertLocalGatewayBaseUrl("https://gateway.example.com/v1/api", "IBKR Gateway"));
});

test("Broker Connector 只从根环境文件读取允许的券商配置", () => {
  assert.deepEqual(
    parseBrokerEnvironment([
      "DATABASE_URL=secret-database",
      'BROKER_CONNECTOR_MODE="IBKR_PAPER"',
      "IBKR_PAPER_ACCOUNT_ID='DU1234567'",
      "JWT_SECRET=secret-jwt",
    ].join("\n")),
    { BROKER_CONNECTOR_MODE: "IBKR_PAPER", IBKR_PAPER_ACCOUNT_ID: "DU1234567" },
  );
});

test("TWS Socket 默认只读且只接受本机 Paper 端口和 DU 模拟账户", () => {
  assert.deepEqual(twsSocketConfigFromEnvironment({}), {
    apiReadOnly: true,
    clientId: 71,
    expectedPaperAccountId: "",
    host: "127.0.0.1",
    port: 4002,
    timeoutMs: 12_000,
  });
  assert.equal(
    twsSocketConfigFromEnvironment({
      IBKR_PAPER_ACCOUNT_ID: "du1234567",
      IBKR_TWS_API_READ_ONLY: "false",
      IBKR_TWS_HOST: "host.docker.internal",
      IBKR_TWS_PORT: "7497",
    }).expectedPaperAccountId,
    "DU1234567",
  );
  assert.equal(
    twsSocketConfigFromEnvironment({ IBKR_PAPER_ACCOUNT_ID: "DUT9999999" }).expectedPaperAccountId,
    "DUT9999999",
  );
  assert.throws(() => twsSocketConfigFromEnvironment({ IBKR_TWS_HOST: "broker.example.com" }), /仅允许本机/);
  assert.throws(() => twsSocketConfigFromEnvironment({ IBKR_TWS_PORT: "7496" }), /Paper 端口/);
  assert.throws(() => twsSocketConfigFromEnvironment({ IBKR_TWS_PORT: "4001" }), /Paper 端口/);
  assert.throws(() => twsSocketConfigFromEnvironment({ IBKR_PAPER_ACCOUNT_ID: "U1234567" }), /不是 DU/);
});

test("IBKR Paper 会话必须同时满足登录类型、认证状态与精确 DEMO 账户", () => {
  const valid = {
    accounts: [{ accountId: "DU1234567", brokerageAccess: true, type: "DEMO" }],
    authenticationStatus: { authenticated: true, connected: true },
    expectedAccountId: "DU1234567",
    ssoValidation: { success: { value: { LOGIN_TYPE: 2, RESULT: true } } },
  };
  assert.equal(assertIbkrPaperSession(valid).accountId, "DU1234567");
  assert.throws(
    () => assertIbkrPaperSession({ ...valid, ssoValidation: { LOGIN_TYPE: 1, RESULT: true } }),
    /PAPER_ENVIRONMENT_MISMATCH/,
  );
  assert.throws(
    () => assertIbkrPaperSession({ ...valid, ssoValidation: { LOGIN_TYPE: 2, RESULT: "false" } }),
    /PAPER_ENVIRONMENT_MISMATCH/,
  );
  assert.throws(() => assertIbkrPaperSession({ ...valid, expectedAccountId: "DU7654321" }), /PAPER_ENVIRONMENT_MISMATCH/);
});

test("内部订单类型在 IBKR 边界转换为官方代码", () => {
  assert.equal(toIbkrOrderType("MARKET"), "MKT");
  assert.equal(toIbkrOrderType("LIMIT"), "LMT");
  assert.equal(toIbkrOrderType("STOP"), "STP");
  assert.equal(toIbkrOrderType("STOP_LIMIT"), "STOP_LIMIT");
});

test("Broker Connector 生产源码只包含明确命名的 Paper 写入口且不存在 Live 写入口", () => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const source = [
    "broker-provider.ts",
    "paper-execution-provider.ts",
    "providers.ts",
    "main.ts",
    "http-json-client.ts",
    "ibkr-session.ts",
    "runtime-env.ts",
    "security.ts",
    "tws-socket-client.ts",
  ]
    .map((file) => readFileSync(path.join(root, file), "utf8"))
    .join("\n");
  assert.match(source, /placePaperOrder/);
  assert.match(source, /modifyPaperOrder/);
  assert.match(source, /cancelPaperOrder/);
  for (const forbidden of ["place" + "LiveOrder", "submit" + "LiveOrder", "transmit" + "LiveOrder"]) {
    assert.equal(source.includes(forbidden), false, `发现禁止的券商写入口: ${forbidden}`);
  }
  const twsSocketSource = readFileSync(path.join(root, "tws-socket-client.ts"), "utf8");
  assert.equal((twsSocketSource.match(/\.placeOrder\(/g) ?? []).length, 2, "底层 TWS 只允许在同一审计边界发送主单和保护单");
  assert.match(twsSocketSource, /transmit: protectiveStopOrderId === undefined/);
  assert.match(twsSocketSource, /parentId: orderId/);
  assert.match(twsSocketSource, /PROTECTIVE_STOP/);
  assert.match(twsSocketSource, /async placePaperOrder[\s\S]*?this\.assertPaperWriteReady\(\)/);
  assert.match(twsSocketSource, /async modifyPaperOrder[\s\S]*?this\.assertPaperWriteReady\(\)/);
  assert.match(twsSocketSource, /async cancelPaperOrder[\s\S]*?this\.assertPaperWriteReady\(\)/);
});

const validPaperOrder: PaperOrderInput = {
  accountRef: "a".repeat(64),
  accountType: "PAPER",
  allowPartialFill: true,
  approvalSnapshotHash: "b".repeat(64),
  contractId: "265598",
  correlationId: "corr-paper-test",
  idempotencyKey: "PAPER:DEPLOYMENT:AAPL:BUY:2026-07-17:V1:1",
  limitPrice: 220,
  maxSlippage: 0.5,
  orderType: "LIMIT",
  outsideRth: false,
  protectiveStopPrice: 210,
  quantity: 1,
  side: "BUY",
  symbol: "AAPL",
  timeInForce: "DAY",
};

test("Paper 能力明确允许模拟写入并永久拒绝 Live 写入", () => {
  assert.equal(PAPER_EXECUTION_CAPABILITIES.canPlacePaperOrders, true);
  assert.equal(PAPER_EXECUTION_CAPABILITIES.canModifyPaperOrders, true);
  assert.equal(PAPER_EXECUTION_CAPABILITIES.canCancelPaperOrders, true);
  assert.equal(PAPER_EXECUTION_CAPABILITIES.canPlaceLiveOrders, false);
  assert.equal(PAPER_EXECUTION_CAPABILITIES.canModifyLiveOrders, false);
  assert.equal(PAPER_EXECUTION_CAPABILITIES.canCancelLiveOrders, false);
});

test("Paper 写入需要 IBKR_PAPER、PAPER 环境和账户哈希白名单同时满足", () => {
  const allowlist = new Set([validPaperOrder.accountRef]);
  assert.doesNotThrow(() =>
    assertPaperWriteEnvelope(validPaperOrder, {
      accountAllowlist: allowlist,
      connectorEnvironment: "PAPER",
      runMode: "IBKR_PAPER",
    }),
  );
  assert.throws(() =>
    assertPaperWriteEnvelope(validPaperOrder, {
      accountAllowlist: allowlist,
      connectorEnvironment: "LIVE",
      runMode: "IBKR_PAPER",
    }),
  );
  assert.throws(() =>
    assertPaperWriteEnvelope(validPaperOrder, {
      accountAllowlist: new Set(),
      connectorEnvironment: "PAPER",
      runMode: "IBKR_PAPER",
    }),
  );
});

test("新增 Paper 多头必须原子附带低于入场价的保护性 Stop", () => {
  const environment = {
    accountAllowlist: new Set([validPaperOrder.accountRef]),
    connectorEnvironment: "PAPER",
    runMode: "IBKR_PAPER",
  };
  assert.throws(
    () => assertPaperWriteEnvelope({ ...validPaperOrder, protectiveStopPrice: undefined }, environment),
    /原子附带保护性 Stop/,
  );
  assert.throws(
    () => assertPaperWriteEnvelope({ ...validPaperOrder, protectiveStopPrice: 221 }, environment),
    /必须低于多头入场限价/,
  );
});

test("非 PAPER 账户在 Connector 层直接触发环境不匹配拒绝", () => {
  assert.throws(
    () =>
      assertPaperWriteEnvelope(
        { ...validPaperOrder, accountType: "LIVE" as "PAPER" },
        {
          accountAllowlist: new Set([validPaperOrder.accountRef]),
          connectorEnvironment: "PAPER",
          runMode: "IBKR_PAPER",
        },
      ),
    /PAPER_ENVIRONMENT_MISMATCH/,
  );
});

test("Paper 撤单同样要求运行模式、PAPER 环境和账户哈希白名单", () => {
  const environment = {
    accountAllowlist: new Set([validPaperOrder.accountRef]),
    connectorEnvironment: "PAPER",
    runMode: "IBKR_PAPER",
  };
  assert.doesNotThrow(() => assertPaperAccountEnvelope(validPaperOrder, environment));
  assert.throws(() =>
    assertPaperAccountEnvelope({ ...validPaperOrder, accountRef: "c".repeat(64) }, environment),
  );
});

test("IBKR 警告只在显式人工确认接口后继续，且订单类型已正确映射", async () => {
  const httpPaperOrder: PaperOrderInput = {
    ...validPaperOrder,
    protectiveStopPrice: undefined,
    side: "SELL",
  };
  const paperAccountId = "DU1234567";
  let submittedOrderType = "";
  let replyConfirmed = false;
  let ssoValidationCalls = 0;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> : {};
      let payload: unknown;
      if (request.method === "GET" && pathname === "/v1/api/sso/validate") {
        ssoValidationCalls += 1;
        payload = { LOGIN_TYPE: 2, RESULT: true };
      } else if (request.method === "POST" && pathname === "/v1/api/iserver/auth/status") {
        payload = { authenticated: true, connected: true };
      } else if (request.method === "GET" && pathname === "/v1/api/portfolio/accounts") {
        payload = [{ accountId: paperAccountId, brokerageAccess: true, type: "DEMO" }];
      } else if (request.method === "GET" && pathname === "/v1/api/iserver/marketdata/snapshot") {
        payload = [{ "31": 100, "84": 99.9, "86": 100.1 }];
      } else if (request.method === "POST" && pathname === `/v1/api/iserver/account/${paperAccountId}/orders`) {
        const orders = body.orders as Array<Record<string, unknown>>;
        submittedOrderType = String(orders[0]?.orderType ?? "");
        payload = [{ id: "reply-warning-123", message: [`Account ${paperAccountId} price warning`], messageIds: ["o163"] }];
      } else if (request.method === "POST" && pathname === "/v1/api/iserver/reply/reply-warning-123") {
        replyConfirmed = body.confirmed === true;
        payload = [{ order_id: "9001", order_status: "Submitted" }];
      } else {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: `Unhandled ${request.method} ${pathname}` }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(payload));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/v1/api`;
  const provider = new IbkrPaperHttpExecutionProvider(baseUrl, paperAccountId, {
    accountAllowlist: new Set([validPaperOrder.accountRef]),
    connectorEnvironment: "PAPER",
    runMode: "IBKR_PAPER",
  });
  try {
    const unknownPreview = await provider.previewOrder(httpPaperOrder);
    assert.equal(unknownPreview.marketDataType, "UNKNOWN");
    assert.equal(unknownPreview.accepted, false);
    await assert.rejects(() => provider.placePaperOrder(httpPaperOrder), /缺少实时订阅/);
    // Isolate the warning-confirmation protocol using the local fake server only.
    provider.previewOrder = async () => ({ ...unknownPreview, accepted: true });
    const pending = await provider.placePaperOrder(httpPaperOrder);
    assert.equal(pending.status, "BROKER_CONFIRMATION_REQUIRED");
    assert.equal(pending.brokerReplyId, "reply-warning-123");
    assert.equal(pending.brokerReplyMessages?.[0]?.includes(paperAccountId), false);
    assert.equal(submittedOrderType, "LMT");
    assert.equal(replyConfirmed, false);
    const submitted = await provider.confirmPaperOrderReply("reply-warning-123", httpPaperOrder);
    assert.equal(submitted.externalOrderId, "9001");
    assert.equal(submitted.status, "SUBMITTED");
    assert.equal(replyConfirmed, true);
    const readonlyProvider = new IbkrReadonlyHttpProvider(baseUrl, "IBKR_PAPER", paperAccountId);
    assert.equal((await readonlyProvider.getAccounts())[0]?.accountType, "PAPER");
    assert.equal(ssoValidationCalls, 1);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("Client Portal HTTP 未实现原子保护单时默认拒绝新增风险", async () => {
  const provider = new IbkrPaperHttpExecutionProvider(
    "http://127.0.0.1:5000/v1/api",
    "DU1234567",
    {
      accountAllowlist: new Set([validPaperOrder.accountRef]),
      connectorEnvironment: "PAPER",
      runMode: "IBKR_PAPER",
    },
  );
  await assert.rejects(() => provider.placePaperOrder(validPaperOrder), /原子保护性 Stop/);
});
