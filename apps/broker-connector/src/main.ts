import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { loadBrokerEnvironment } from "./runtime-env";
import {
  assertPaperAccountEnvelope,
  assertPaperWriteEnvelope,
  createPaperExecutionProvider,
  PAPER_DISABLED_CAPABILITIES,
  paperEnvironmentFromProcess,
  type PaperCancelInput,
  type PaperOrderInput,
} from "./paper-execution-provider";
import { createBrokerProvider } from "./providers";
import { connectorResponsePayload, safeError } from "./security";

loadBrokerEnvironment();

const provider = createBrokerProvider();
const paperProvider = createPaperExecutionProvider();
const paperEnvironment = paperEnvironmentFromProcess();
const port = Number(process.env.BROKER_CONNECTOR_PORT ?? 5092);
const PAPER_KEEP_ALIVE_MS = 60_000;
const activePaperProvider = paperProvider;
const paperKeepAliveTimer = activePaperProvider
  ? setInterval(() => {
      void activePaperProvider.keepAlive().catch((error: unknown) => {
        audit("PAPER_SESSION_KEEPALIVE_FAILED", "CRITICAL", "paper-session-keepalive", safeError(error));
      });
    }, PAPER_KEEP_ALIVE_MS)
  : null;

function send(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  // 成功响应在仅限本机/内部网络的 Connector 与 API 之间保留原始账户标识，
  // API 会在持久化前做 HMAC。错误响应继续统一脱敏，避免把券商标识带入日志或页面。
  response.end(JSON.stringify(connectorResponsePayload(status, payload)));
}

function audit(
  eventType: string,
  severity: "CRITICAL" | "INFO" | "WARNING",
  correlationId: string,
  message: string,
) {
  process.stdout.write(
    `${JSON.stringify({ correlationId, eventType, message: safeError(message), severity, timestamp: new Date().toISOString() })}\n`,
  );
}

function range(url: URL) {
  const to = url.searchParams.get("to") ?? new Date().toISOString();
  const from = url.searchParams.get("from") ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
  return { from, to };
}

async function jsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 128 * 1024) throw new Error("Paper 订单请求体超过安全上限");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function paperInput(body: Record<string, unknown>): PaperOrderInput {
  return {
    accountRef: String(body.accountRef ?? ""),
    accountType: String(body.accountType ?? "") as "PAPER",
    allowPartialFill: Boolean(body.allowPartialFill),
    approvalSnapshotHash: String(body.approvalSnapshotHash ?? ""),
    contractId: String(body.contractId ?? ""),
    correlationId: String(body.correlationId ?? ""),
    idempotencyKey: String(body.idempotencyKey ?? ""),
    limitPrice: body.limitPrice === undefined ? undefined : Number(body.limitPrice),
    maxSlippage: Number(body.maxSlippage ?? 0),
    orderType: String(body.orderType ?? "") as PaperOrderInput["orderType"],
    outsideRth: Boolean(body.outsideRth),
    parentOrderId: body.parentOrderId === undefined ? undefined : String(body.parentOrderId),
    protectiveStopPrice:
      body.protectiveStopPrice === undefined ? undefined : Number(body.protectiveStopPrice),
    quantity: Number(body.quantity),
    side: String(body.side ?? "") as PaperOrderInput["side"],
    stopPrice: body.stopPrice === undefined ? undefined : Number(body.stopPrice),
    symbol: String(body.symbol ?? ""),
    timeInForce: String(body.timeInForce ?? "DAY"),
  };
}

function paperCancelInput(body: Record<string, unknown>): PaperCancelInput {
  return {
    accountRef: String(body.accountRef ?? ""),
    accountType: String(body.accountType ?? "") as "PAPER",
    correlationId: String(body.correlationId ?? ""),
  };
}

function assertPaperEnabled(input?: PaperOrderInput | PaperCancelInput) {
  const correlationId = input?.correlationId || "connector-paper-guard";
  if (!paperProvider) {
    audit(
      "PAPER_EXECUTION_DISABLED",
      "WARNING",
      correlationId,
      "Paper 订单接口仅在 IBKR_PAPER + PAPER 环境注册",
    );
    throw new Error("Paper 订单接口未启用");
  }
  if (input) {
    try {
      if ("quantity" in input) assertPaperWriteEnvelope(input, paperEnvironment);
      else assertPaperAccountEnvelope(input, paperEnvironment);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Paper 环境验证失败";
      audit(
        message.includes("MISMATCH") ? "PAPER_ENVIRONMENT_MISMATCH" : "PAPER_EXECUTION_REJECTED",
        "CRITICAL",
        correlationId,
        message,
      );
      throw error;
    }
  }
  return paperProvider;
}

async function paperRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  segments: string[],
) {
  if (url.pathname === "/paper/capabilities" && request.method === "GET") {
    return send(response, 200, paperProvider?.getCapabilities() ?? PAPER_DISABLED_CAPABILITIES);
  }
  if (url.pathname === "/paper/health" && request.method === "GET") {
    if (!paperProvider) {
      return send(response, 200, {
        checkedAt: new Date().toISOString(),
        latencyMs: 0,
        message: "IBKR Paper 执行默认关闭",
        status: "OFFLINE",
      });
    }
    return send(response, 200, await paperProvider.healthCheck());
  }
  if (request.method === "GET") {
    const execution = assertPaperEnabled();
    const { from, to } = range(url);
    if (url.pathname === "/paper/orders/open") {
      return send(response, 200, await execution.getPaperOpenOrders());
    }
    if (url.pathname === "/paper/orders/completed") {
      return send(response, 200, await execution.getPaperCompletedOrders(from, to));
    }
    if (url.pathname === "/paper/executions") {
      return send(response, 200, await execution.getPaperExecutions(from, to));
    }
    if (url.pathname === "/paper/account/summary") {
      return send(response, 200, await execution.getPaperAccountSummary());
    }
    if (url.pathname === "/paper/account/positions") {
      return send(response, 200, await execution.getPaperPositions());
    }
    if (segments[1] === "orders" && segments[2]) {
      return send(response, 200, await execution.getPaperOrderStatus(segments[2]));
    }
  }
  if (url.pathname === "/paper/orders/preview" && request.method === "POST") {
    const input = paperInput(await jsonBody(request));
    return send(response, 200, await assertPaperEnabled(input).previewOrder(input));
  }
  if (url.pathname === "/paper/orders" && request.method === "POST") {
    const input = paperInput(await jsonBody(request));
    const result = await assertPaperEnabled(input).placePaperOrder(input);
    audit("PAPER_ORDER_SUBMITTED", "INFO", input.correlationId, "Paper 订单已发送并等待券商状态确认");
    return send(response, 201, result);
  }
  if (
    segments[1] === "replies" &&
    segments[2] &&
    segments[3] === "confirm" &&
    request.method === "POST"
  ) {
    const input = paperInput(await jsonBody(request));
    const result = await assertPaperEnabled(input).confirmPaperOrderReply(segments[2], input);
    audit(
      "PAPER_ORDER_BROKER_REPLY_CONFIRMED",
      "INFO",
      input.correlationId,
      "IBKR Paper 警告已由独立人工确认继续处理",
    );
    return send(response, 200, result);
  }
  if (segments[1] === "orders" && segments[2] && request.method === "PATCH") {
    const input = paperInput(await jsonBody(request));
    const result = await assertPaperEnabled(input).modifyPaperOrder(segments[2], input);
    audit("PAPER_ORDER_MODIFIED", "INFO", input.correlationId, "Paper 订单修改请求已发送");
    return send(response, 200, result);
  }
  if (
    segments[1] === "orders" &&
    segments[2] &&
    segments[3] === "cancel" &&
    request.method === "POST"
  ) {
    const input = paperCancelInput(await jsonBody(request));
    const execution = assertPaperEnabled(input);
    const result = await execution.cancelPaperOrder(segments[2], input);
    audit("PAPER_ORDER_CANCEL_REQUESTED", "INFO", input.correlationId, "Paper 撤单请求已发送");
    return send(response, 200, result);
  }
  send(response, 404, { message: "未找到 IBKR Paper 专用接口" });
}

async function readonlyRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  segments: string[],
) {
  if (request.method !== "GET") {
    send(response, 405, { message: "非 Paper 路径仅开放只读 GET 接口" });
    return;
  }
  if (url.pathname === "/health") {
    return send(response, 200, paperProvider ? await paperProvider.healthCheck() : await provider.healthCheck());
  }
  if (url.pathname === "/connection") {
    return send(response, 200, await provider.getConnectionStatus());
  }
  if (url.pathname === "/capabilities") {
    return send(response, 200, provider.getSupportedCapabilities());
  }
  if (url.pathname === "/market-data/top-of-book") {
    const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase();
    const contractId = (url.searchParams.get("contractId") ?? "").trim();
    if (!/^[A-Z0-9._-]{1,32}$/.test(symbol) || !/^\d{1,20}$/.test(contractId)) {
      return send(response, 400, { message: "symbol 或 contractId 格式无效" });
    }
    return send(response, 200, await provider.getTopOfBook(symbol, contractId));
  }
  if (url.pathname === "/accounts") return send(response, 200, await provider.getAccounts());
  if (segments[0] === "accounts" && segments[1] && segments[2]) {
    const accountId = decodeURIComponent(segments[1]);
    const { from, to } = range(url);
    const action = segments.slice(2).join("/");
    if (action === "summary") {
      return send(response, 200, await provider.getAccountSummary(accountId));
    }
    if (action === "cash") return send(response, 200, await provider.getCashBalances(accountId));
    if (action === "positions") return send(response, 200, await provider.getPositions(accountId));
    if (action === "executions") {
      return send(response, 200, await provider.getExecutions(accountId, from, to));
    }
    if (action === "transactions") {
      return send(response, 200, await provider.getTransactions(accountId, from, to));
    }
    if (action === "open-orders") {
      return send(response, 200, await provider.getOpenOrdersReadonly(accountId));
    }
    if (action === "completed-orders") {
      return send(response, 200, await provider.getCompletedOrdersReadonly(accountId, from, to));
    }
    if (action === "corporate-actions") {
      return send(response, 200, await provider.getCorporateActions(accountId, from, to));
    }
  }
  send(response, 404, { message: "未找到只读券商接口" });
}

async function route(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] === "paper") return paperRoute(request, response, url, segments);
  return readonlyRoute(request, response, url, segments);
}

const server = createServer((request, response) => {
  void route(request, response).catch((error: unknown) => {
    const message = safeError(error);
    const status = message.includes("MISMATCH") || message.includes("未启用") ? 403 : 503;
    send(response, status, { message });
  });
});

server.listen(port, process.env.BROKER_CONNECTOR_HOST ?? "127.0.0.1", () => {
  process.stdout.write(`Broker Connector safe service listening on ${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (paperKeepAliveTimer) clearInterval(paperKeepAliveTimer);
    void provider.disconnect().finally(() => server.close());
  });
}
