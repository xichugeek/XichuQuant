import { createHash } from "node:crypto";

import { assertLocalGatewayBaseUrl, requestGatewayJson } from "./http-json-client";
import { invalidateIbkrPaperSession, verifiedIbkrPaperAccount } from "./ibkr-session";
import type {
  BrokerAccountSummaryRecord,
  BrokerExecutionRecord,
  BrokerHealth,
  BrokerOrderRecord,
  BrokerPositionRecord,
} from "./broker-provider";
import { sharedTwsSocketClient } from "./tws-socket-client";

export type PaperExecutionCapabilities = {
  canCancelLiveOrders: false;
  canCancelPaperOrders: boolean;
  canModifyLiveOrders: false;
  canModifyPaperOrders: boolean;
  canPlaceLiveOrders: false;
  canPlacePaperOrders: boolean;
  canReadAccounts: true;
  canReadOrders: true;
  canReadPositions: true;
};

export const PAPER_DISABLED_CAPABILITIES: PaperExecutionCapabilities = Object.freeze({
  canCancelLiveOrders: false,
  canCancelPaperOrders: false,
  canModifyLiveOrders: false,
  canModifyPaperOrders: false,
  canPlaceLiveOrders: false,
  canPlacePaperOrders: false,
  canReadAccounts: true,
  canReadOrders: true,
  canReadPositions: true,
});

export const PAPER_EXECUTION_CAPABILITIES: PaperExecutionCapabilities = Object.freeze({
  ...PAPER_DISABLED_CAPABILITIES,
  canCancelPaperOrders: true,
  canModifyPaperOrders: true,
  canPlacePaperOrders: true,
});

export type PaperOrderInput = {
  accountRef: string;
  accountType: "PAPER";
  allowPartialFill: boolean;
  approvalSnapshotHash: string;
  contractId: string;
  correlationId: string;
  idempotencyKey: string;
  limitPrice?: number;
  maxSlippage: number;
  orderType: "LIMIT" | "MARKET" | "STOP" | "STOP_LIMIT";
  outsideRth: boolean;
  parentOrderId?: string;
  protectiveStopPrice?: number;
  quantity: number;
  side: "BUY" | "SELL";
  stopPrice?: number;
  symbol: string;
  timeInForce: string;
};

export type PaperCancelInput = {
  accountRef: string;
  accountType: "PAPER";
  correlationId: string;
};

export type PaperOrderPreview = {
  accepted: boolean;
  accountType: "PAPER";
  estimatedCommission: number;
  estimatedSlippagePercent: number;
  estimatedValue: number;
  marketDataSource?: "IBKR_TWS_SOCKET" | "IBKR_CLIENT_PORTAL";
  marketDataQuality?: "VERIFIED_TOP_OF_BOOK" | "UNKNOWN";
  marketDataTime: string;
  marketDataType: "DELAYED" | "DELAYED_FROZEN" | "FROZEN" | "REALTIME" | "UNKNOWN";
  normalizedOrder: PaperOrderInput;
  referencePrice: number;
  spreadPercent: number;
  warnings: string[];
};

export type PaperOrderState = {
  averageFillPrice?: number;
  brokerReplyId?: string;
  brokerReplyMessageIds?: string[];
  brokerReplyMessages?: string[];
  externalOrderId?: string;
  externalPermanentId?: string;
  filledQuantity: number;
  lastFillPrice?: number;
  protectiveStopExternalOrderId?: string;
  protectiveStopPermanentId?: string;
  protectiveStopPrice?: number;
  protectiveStopQuantity?: number;
  protectiveStopStatus?: string;
  rawDataHash: string;
  reason?: string;
  remainingQuantity: number;
  status: string;
  updatedAt: string;
};

export interface PaperBrokerExecutionProvider {
  cancelPaperOrder(externalOrderId: string, input: PaperCancelInput): Promise<PaperOrderState>;
  confirmPaperOrderReply(replyId: string, input: PaperOrderInput): Promise<PaperOrderState>;
  getCapabilities(): PaperExecutionCapabilities;
  getPaperAccountSummary(): Promise<BrokerAccountSummaryRecord>;
  getPaperCompletedOrders(from: string, to: string): Promise<BrokerOrderRecord[]>;
  getPaperExecutions(from: string, to: string): Promise<BrokerExecutionRecord[]>;
  getPaperOpenOrders(): Promise<BrokerOrderRecord[]>;
  getPaperOrderStatus(externalOrderId: string): Promise<PaperOrderState>;
  getPaperPositions(): Promise<BrokerPositionRecord[]>;
  healthCheck(): Promise<BrokerHealth>;
  keepAlive(): Promise<void>;
  modifyPaperOrder(externalOrderId: string, input: PaperOrderInput): Promise<PaperOrderState>;
  placePaperOrder(input: PaperOrderInput): Promise<PaperOrderState>;
  previewOrder(input: PaperOrderInput): Promise<PaperOrderPreview>;
}

type PaperEnvironment = {
  accountAllowlist: ReadonlySet<string>;
  connectorEnvironment: string;
  runMode: string;
};

export function assertPaperAccountEnvelope(
  input: Pick<PaperCancelInput, "accountRef" | "accountType">,
  environment: PaperEnvironment,
) {
  if (environment.runMode !== "IBKR_PAPER") throw new Error("运行模式不是 IBKR_PAPER");
  if (environment.connectorEnvironment !== "PAPER") throw new Error("Connector 环境不是 PAPER");
  if (input.accountType !== "PAPER") throw new Error("PAPER_ENVIRONMENT_MISMATCH");
  if (!environment.accountAllowlist.has(input.accountRef)) {
    throw new Error("Paper Account 不在允许白名单");
  }
  if (!/^[a-f0-9]{64}$/i.test(input.accountRef)) throw new Error("Paper Account 引用格式无效");
}

export function assertPaperWriteEnvelope(input: PaperOrderInput, environment: PaperEnvironment) {
  assertPaperAccountEnvelope(input, environment);
  if (!/^[a-f0-9]{64}$/i.test(input.approvalSnapshotHash)) throw new Error("审批快照哈希无效");
  if (!/^[a-zA-Z0-9:_-]{8,240}$/.test(input.idempotencyKey)) throw new Error("幂等键无效");
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new Error("订单数量无效");
  if (!Number.isFinite(input.maxSlippage) || input.maxSlippage < 0) {
    throw new Error("最大滑点无效");
  }
  if (!new Set(["LIMIT", "MARKET", "STOP", "STOP_LIMIT"]).has(input.orderType)) {
    throw new Error("V1.8 不支持该订单类型");
  }
  if (input.orderType === "LIMIT" && !(Number(input.limitPrice) > 0)) {
    throw new Error("限价单必须提供限价");
  }
  if (input.side === "BUY" && !(Number(input.protectiveStopPrice) > 0)) {
    throw new Error("新增多头风险必须原子附带保护性 Stop");
  }
  if (
    input.side === "BUY" &&
    Number(input.limitPrice) > 0 &&
    Number(input.protectiveStopPrice) >= Number(input.limitPrice)
  ) {
    throw new Error("保护性 Stop 必须低于多头入场限价");
  }
  if (input.orderType === "STOP" && !(Number(input.stopPrice) > 0)) {
    throw new Error("止损单必须提供止损价");
  }
  if (
    input.orderType === "STOP_LIMIT" &&
    (!(Number(input.stopPrice) > 0) || !(Number(input.limitPrice) > 0))
  ) {
    throw new Error("止损限价单必须提供限价和止损价");
  }
}

type JsonRecord = Record<string, unknown>;

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function textValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function rawHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeStatus(value: unknown) {
  const status = textValue(value, "UNKNOWN").toUpperCase().replaceAll(" ", "_");
  const mapping: Record<string, string> = {
    APICANCELLED: "API_CANCELLED",
    CANCELLED: "CANCELLED",
    FILLED: "FILLED",
    INACTIVE: "INACTIVE",
    PENDINGCANCEL: "PENDING_CANCEL",
    PENDINGSUBMIT: "SUBMITTING",
    PRESUBMITTED: "PRE_SUBMITTED",
    SUBMITTED: "SUBMITTED",
  };
  return mapping[status] ?? status;
}

export function toIbkrOrderType(orderType: PaperOrderInput["orderType"]) {
  return {
    LIMIT: "LMT",
    MARKET: "MKT",
    STOP: "STP",
    STOP_LIMIT: "STOP_LIMIT",
  }[orderType];
}

export class IbkrTwsPaperExecutionProvider implements PaperBrokerExecutionProvider {
  private readonly client = sharedTwsSocketClient();

  constructor(private readonly environment: PaperEnvironment) {}

  getCapabilities() {
    return this.client.canWritePaperOrders
      ? PAPER_EXECUTION_CAPABILITIES
      : PAPER_DISABLED_CAPABILITIES;
  }

  async healthCheck(): Promise<BrokerHealth> {
    const started = Date.now();
    try {
      await this.keepAlive();
      return {
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        message: this.client.canWritePaperOrders
          ? "IBKR TWS Socket Paper 可达，模拟订单能力已启用"
          : "IBKR TWS Socket Paper 可达，当前保持 API 只读",
        status: "OK",
      };
    } catch {
      return {
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        message: "IBKR TWS Socket Paper 不可用或模拟账户校验失败",
        status: "OFFLINE",
      };
    }
  }

  async keepAlive() {
    await this.client.ping();
    await this.client.ensurePaperAccount(this.paperAccountId());
  }

  async previewOrder(input: PaperOrderInput): Promise<PaperOrderPreview> {
    assertPaperWriteEnvelope(input, this.environment);
    await this.client.ensurePaperAccount(this.paperAccountId());
    const quote = await this.client.getTopOfBook(input.symbol, input.contractId);
    const midpoint = (quote.askPrice + quote.bidPrice) / 2;
    const quoteValid =
      quote.bidPrice > 0 && quote.askPrice > 0 && quote.askPrice >= quote.bidPrice && midpoint > 0;
    const spreadPercent = quoteValid
      ? ((quote.askPrice - quote.bidPrice) / midpoint) * 100
      : Number.POSITIVE_INFINITY;
    const referencePrice = input.side === "BUY" ? quote.askPrice : quote.bidPrice;
    const requestedPrice = input.limitPrice ?? input.stopPrice ?? referencePrice;
    const estimatedSlippagePercent = quoteValid
      ? (Math.abs(referencePrice - midpoint) / midpoint) * 100
      : Number.POSITIVE_INFINITY;
    const realTimeMarketData = quote.marketDataType === "REALTIME";
    const accepted =
      quoteValid &&
      realTimeMarketData &&
      spreadPercent <= 1 &&
      estimatedSlippagePercent <= input.maxSlippage &&
      requestedPrice > 0;
    return {
      accepted,
      accountType: "PAPER",
      estimatedCommission: Math.max(1, input.quantity * 0.005),
      estimatedSlippagePercent,
      estimatedValue: input.quantity * requestedPrice,
      marketDataSource: "IBKR_TWS_SOCKET",
      marketDataQuality: quoteValid && realTimeMarketData ? "VERIFIED_TOP_OF_BOOK" : "UNKNOWN",
      marketDataTime: quote.snapshotTime,
      marketDataType: quote.marketDataType,
      normalizedOrder: input,
      referencePrice,
      spreadPercent,
      warnings: [
        ...(input.orderType === "MARKET" ? ["市价单仅允许 IBKR Paper，成交价不可预知"] : []),
        ...(!quoteValid ? ["IBKR Paper 实时报价不完整，默认拒绝"] : []),
        ...(!realTimeMarketData
          ? [`IBKR 行情类型为 ${quote.marketDataType}，新增风险订单要求 REALTIME 行情`]
          : []),
        ...(spreadPercent > 1 ? ["买卖价差超过 1%"] : []),
        ...(estimatedSlippagePercent > input.maxSlippage ? ["预计滑点超过建议上限"] : []),
      ],
    };
  }

  async placePaperOrder(input: PaperOrderInput) {
    const preview = await this.previewOrder(input);
    if (!preview.accepted) throw new Error(`ExecutionGuard 预览拒绝：${preview.warnings.join("；")}`);
    return this.client.placePaperOrder(input);
  }

  async modifyPaperOrder(externalOrderId: string, input: PaperOrderInput) {
    const preview = await this.previewOrder(input);
    if (!preview.accepted) throw new Error(`ExecutionGuard 预览拒绝：${preview.warnings.join("；")}`);
    return this.client.modifyPaperOrder(externalOrderId, input);
  }

  async cancelPaperOrder(externalOrderId: string, input: PaperCancelInput) {
    assertPaperAccountEnvelope(input, this.environment);
    await this.client.ensurePaperAccount(this.paperAccountId());
    return this.client.cancelPaperOrder(externalOrderId);
  }

  async confirmPaperOrderReply(_replyId: string, input: PaperOrderInput): Promise<PaperOrderState> {
    assertPaperWriteEnvelope(input, this.environment);
    throw new Error("TWS Socket 不支持网页回执确认；IBKR 警告必须在 Gateway/TWS 中人工处理");
  }

  async getPaperOrderStatus(externalOrderId: string) {
    await this.client.ensurePaperAccount(this.paperAccountId());
    return this.client.getOrderState(externalOrderId);
  }

  async getPaperOpenOrders() {
    await this.client.ensurePaperAccount(this.paperAccountId());
    return this.client.getOpenOrders();
  }

  async getPaperCompletedOrders(from: string, to: string) {
    await this.client.ensurePaperAccount(this.paperAccountId());
    return this.client.getCompletedOrders(from, to);
  }

  async getPaperExecutions(from: string, to: string) {
    return this.client.getExecutions(this.paperAccountId(), from, to);
  }

  async getPaperAccountSummary() {
    return this.client.getAccountSummary(this.paperAccountId());
  }

  async getPaperPositions() {
    return this.client.getPositions(this.paperAccountId());
  }

  private paperAccountId() {
    const accountId = this.client.config.expectedPaperAccountId;
    if (!accountId) throw new Error("缺少 IBKR_PAPER_ACCOUNT_ID，Paper 执行保持关闭");
    return accountId;
  }
}

export class IbkrPaperHttpExecutionProvider implements PaperBrokerExecutionProvider {
  private readonly baseUrl: string;
  private readonly paperProofCacheKey: string;

  constructor(
    baseUrl: string,
    private readonly paperAccountId: string,
    private readonly environment: PaperEnvironment,
  ) {
    this.baseUrl = assertLocalGatewayBaseUrl(baseUrl, "Paper 网关");
    if (!paperAccountId.trim()) throw new Error("缺少本机 IBKR Paper Account 配置");
    this.paperProofCacheKey = `${this.baseUrl}|${paperAccountId}`;
  }

  getCapabilities() {
    return PAPER_EXECUTION_CAPABILITIES;
  }

  async healthCheck(): Promise<BrokerHealth> {
    const started = Date.now();
    try {
      await this.keepAlive();
      return {
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        message: "IBKR Paper 网关可达且账户类型已确认",
        status: "OK",
      };
    } catch {
      return {
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        message: "IBKR Paper 网关不可用或账户类型无法确认",
        status: "OFFLINE",
      };
    }
  }

  async keepAlive() {
    await this.request<JsonRecord>("/tickle", "GET");
    await this.assertConfiguredAccountIsPaper();
  }

  async previewOrder(input: PaperOrderInput): Promise<PaperOrderPreview> {
    assertPaperWriteEnvelope(input, this.environment);
    await this.assertConfiguredAccountIsPaper();
    const quoteRows = await this.request<JsonRecord[]>(
      `/iserver/marketdata/snapshot?conids=${encodeURIComponent(input.contractId)}&fields=31,84,86`,
      "GET",
    );
    const quote = quoteRows[0] ?? {};
    const last = numberValue(quote["31"] ?? quote.last);
    const bid = numberValue(quote["84"] ?? quote.bid);
    const ask = numberValue(quote["86"] ?? quote.ask);
    const quoteValid = bid > 0 && ask > 0 && ask >= bid && last > 0;
    const spreadPercent = quoteValid ? ((ask - bid) / last) * 100 : Number.POSITIVE_INFINITY;
    const referencePrice = input.side === "BUY" ? ask : bid;
    const requestedPrice = input.limitPrice ?? input.stopPrice ?? referencePrice;
    const estimatedSlippagePercent = quoteValid
      ? (Math.abs(referencePrice - last) / last) * 100
      : Number.POSITIVE_INFINITY;
    const accepted = false; // HTTP has no verified REALTIME type/freshness evidence.
    return {
      accepted,
      accountType: "PAPER",
      estimatedCommission: Math.max(1, input.quantity * 0.005),
      estimatedSlippagePercent,
      estimatedValue: input.quantity * requestedPrice,
      marketDataSource: "IBKR_CLIENT_PORTAL",
      marketDataQuality: "UNKNOWN",
      marketDataTime: typeof quote._updated === "number" ? new Date(quote._updated).toISOString() : "",
      marketDataType: "UNKNOWN",
      normalizedOrder: input,
      referencePrice,
      spreadPercent,
      warnings: [
        "HTTP 行情缺少实时订阅与新鲜度证据，默认拒绝",
        ...(input.orderType === "MARKET" ? ["市价单仅允许 IBKR Paper，成交价不可预知"] : []),
        ...(!quoteValid ? ["IBKR Paper 实时报价不完整，默认拒绝"] : []),
        ...(spreadPercent > 1 ? ["买卖价差超过 1%"] : []),
        ...(estimatedSlippagePercent > input.maxSlippage
          ? ["预计滑点超过建议上限"]
          : []),
      ],
    };
  }

  async placePaperOrder(input: PaperOrderInput): Promise<PaperOrderState> {
    if (input.side === "BUY") {
      throw new Error("IBKR Client Portal HTTP 尚不支持本系统的原子保护性 Stop，新增风险默认拒绝");
    }
    const preview = await this.previewOrder(input);
    if (!preview.accepted) throw new Error(`ExecutionGuard 预览拒绝：${preview.warnings.join("；")}`);
    const response = await this.request<unknown>(
      `/iserver/account/${encodeURIComponent(this.paperAccountId)}/orders`,
      "POST",
      { orders: [this.toIbkrOrder(input)] },
    );
    return this.mapWriteResponse(response, input.quantity);
  }

  async modifyPaperOrder(
    externalOrderId: string,
    input: PaperOrderInput,
  ): Promise<PaperOrderState> {
    if (input.side === "BUY") {
      throw new Error("IBKR Client Portal HTTP 尚不支持本系统的原子保护性 Stop，新增风险默认拒绝");
    }
    const preview = await this.previewOrder(input);
    if (!preview.accepted) throw new Error(`ExecutionGuard 预览拒绝：${preview.warnings.join("；")}`);
    const response = await this.request<unknown>(
      `/iserver/account/${encodeURIComponent(this.paperAccountId)}/order/${encodeURIComponent(externalOrderId)}`,
      "POST",
      this.toIbkrOrder(input),
    );
    return this.mapWriteResponse(response, input.quantity, externalOrderId);
  }

  async cancelPaperOrder(externalOrderId: string, input: PaperCancelInput) {
    assertPaperAccountEnvelope(input, this.environment);
    await this.assertConfiguredAccountIsPaper();
    const response = await this.request<unknown>(
      `/iserver/account/${encodeURIComponent(this.paperAccountId)}/order/${encodeURIComponent(externalOrderId)}`,
      "DELETE",
    );
    return this.mapWriteResponse(response, 0, externalOrderId, "PENDING_CANCEL");
  }

  async confirmPaperOrderReply(replyId: string, input: PaperOrderInput) {
    assertPaperWriteEnvelope(input, this.environment);
    await this.assertConfiguredAccountIsPaper();
    if (!/^[a-zA-Z0-9-]{8,160}$/.test(replyId)) {
      throw new Error("IBKR Paper 确认回执 ID 格式无效");
    }
    const response = await this.request<unknown>(
      `/iserver/reply/${encodeURIComponent(replyId)}`,
      "POST",
      { confirmed: true },
    );
    return this.mapWriteResponse(response, input.quantity);
  }

  async getPaperOrderStatus(externalOrderId: string) {
    const orders = [...(await this.getPaperOpenOrders()), ...(await this.getPaperCompletedOrders("1970-01-01", "2999-12-31"))];
    const order = orders.find((item) => item.externalOrderId === externalOrderId);
    if (!order) throw new Error("Paper 订单状态尚未从券商返回");
    return {
      averageFillPrice: order.averageFillPrice,
      externalOrderId,
      filledQuantity: order.filledQuantity,
      rawDataHash: rawHash(order),
      remainingQuantity: Math.max(0, order.quantity - order.filledQuantity),
      status: normalizeStatus(order.status),
      updatedAt: order.orderTime,
    };
  }

  async getPaperOpenOrders() {
    return this.readOrders("/iserver/account/orders");
  }

  async getPaperCompletedOrders(_from: string, _to: string) {
    return this.readOrders("/iserver/account/orders?force=true");
  }

  async getPaperExecutions(_from: string, _to: string): Promise<BrokerExecutionRecord[]> {
    const response = await this.request<JsonRecord>("/iserver/account/trades", "GET");
    const rows = Array.isArray(response.trades) ? (response.trades as JsonRecord[]) : [];
    return rows.map((row) => ({
      commission: numberValue(row.commission),
      currency: textValue(row.currency, "USD"),
      exchange: textValue(row.exchange, "UNKNOWN"),
      executionTime: new Date(String(row.trade_time ?? row.time ?? Date.now())).toISOString(),
      externalExecutionId: textValue(row.execution_id ?? row.execId) || undefined,
      orderReference: textValue(row.order_ref ?? row.orderId) || undefined,
      price: numberValue(row.price),
      quantity: Math.abs(numberValue(row.size)),
      side: textValue(row.side).toUpperCase().startsWith("B") ? "BUY" : "SELL",
      symbol: textValue(row.symbol),
      tradeDate: textValue(row.trade_date, new Date().toISOString().slice(0, 10)),
    }));
  }

  async getPaperAccountSummary(): Promise<BrokerAccountSummaryRecord> {
    await this.assertConfiguredAccountIsPaper();
    const row = await this.request<JsonRecord>(
      `/portfolio/${encodeURIComponent(this.paperAccountId)}/summary`,
      "GET",
    );
    const value = (key: string) => {
      const field = row[key];
      return numberValue(field && typeof field === "object" ? (field as JsonRecord).amount : field);
    };
    return {
      availableFunds: value("availablefunds"),
      baseCurrency: textValue(row.currency, "USD"),
      buyingPower: value("buyingpower"),
      grossPositionValue: value("grosspositionvalue"),
      netLiquidation: value("netliquidation"),
      realizedPnl: value("realizedpnl"),
      settledCash: value("settledcash"),
      snapshotTime: new Date().toISOString(),
      totalCash: value("totalcashvalue"),
      unrealizedPnl: value("unrealizedpnl"),
    };
  }

  async getPaperPositions(): Promise<BrokerPositionRecord[]> {
    await this.assertConfiguredAccountIsPaper();
    const rows = await this.request<JsonRecord[]>(
      `/portfolio/${encodeURIComponent(this.paperAccountId)}/positions/0`,
      "GET",
    );
    return rows.map((row) => ({
      averageCost: numberValue(row.avgCost),
      currency: textValue(row.currency, "USD"),
      externalContractId: String(row.conid ?? ""),
      marketPrice: numberValue(row.mktPrice),
      marketValue: numberValue(row.mktValue),
      quantity: numberValue(row.position),
      symbol: textValue(row.ticker ?? row.contractDesc),
      unrealizedPnl: numberValue(row.unrealizedPnl),
    }));
  }

  private async assertConfiguredAccountIsPaper() {
    await verifiedIbkrPaperAccount({
      cacheKey: this.paperProofCacheKey,
      load: async () => {
        const [ssoValidation, authenticationStatus, accounts] = await Promise.all([
          this.request<JsonRecord>("/sso/validate", "GET"),
          this.request<JsonRecord>("/iserver/auth/status", "POST"),
          this.request<JsonRecord[]>("/portfolio/accounts", "GET"),
        ]);
        return {
          accounts,
          authenticationStatus,
          expectedAccountId: this.paperAccountId,
          ssoValidation,
        };
      },
    });
  }

  private async readOrders(path: string): Promise<BrokerOrderRecord[]> {
    await this.assertConfiguredAccountIsPaper();
    const response = await this.request<JsonRecord>(path, "GET");
    const rows = Array.isArray(response.orders) ? (response.orders as JsonRecord[]) : [];
    return rows.map((row) => ({
      averageFillPrice: numberValue(row.avgPrice),
      currency: textValue(row.currency, "USD"),
      externalOrderId: String(row.orderId ?? ""),
      filledQuantity: numberValue(row.filledQuantity),
      limitPrice: row.price === undefined ? undefined : numberValue(row.price),
      orderTime: new Date(String(row.orderTime ?? row.lastExecutionTime_r ?? Date.now())).toISOString(),
      orderType: textValue(row.orderType, "UNKNOWN"),
      quantity: numberValue(row.totalSize),
      side: textValue(row.side).toUpperCase().startsWith("B") ? "BUY" : "SELL",
      status: normalizeStatus(row.status),
      symbol: textValue(row.ticker ?? row.symbol),
    }));
  }

  private toIbkrOrder(input: PaperOrderInput) {
    return {
      acctId: this.paperAccountId,
      auxPrice: input.stopPrice,
      cOID: input.idempotencyKey,
      conid: Number(input.contractId),
      listingExchange: "SMART",
      orderType: toIbkrOrderType(input.orderType),
      outsideRTH: input.outsideRth,
      price: input.limitPrice,
      quantity: input.quantity,
      side: input.side,
      ticker: input.symbol,
      tif: input.timeInForce,
    };
  }

  private mapWriteResponse(
    response: unknown,
    quantity: number,
    fallbackOrderId = "",
    fallbackStatus = "SUBMITTED",
  ): PaperOrderState {
    const first = Array.isArray(response) ? response[0] : response;
    const row = first && typeof first === "object" ? (first as JsonRecord) : {};
    const error = textValue(row.error);
    if (error) throw new Error(`IBKR Paper 拒绝订单：${this.redactAccount(error)}`);
    const brokerReplyId = textValue(row.id);
    const replyMessages = Array.isArray(row.message)
      ? row.message.map((item) => this.redactAccount(String(item))).filter(Boolean)
      : [];
    if (brokerReplyId && replyMessages.length) {
      return {
        brokerReplyId,
        brokerReplyMessageIds: Array.isArray(row.messageIds)
          ? row.messageIds.map((item) => String(item)).filter(Boolean)
          : [],
        brokerReplyMessages: replyMessages,
        filledQuantity: 0,
        rawDataHash: rawHash(response),
        reason: replyMessages.join("；"),
        remainingQuantity: quantity,
        status: "BROKER_CONFIRMATION_REQUIRED",
        updatedAt: new Date().toISOString(),
      };
    }
    const externalOrderId = String(row.order_id ?? row.orderId ?? fallbackOrderId);
    if (!externalOrderId) throw new Error("IBKR Paper 未返回订单 ID，提交结果未知");
    return {
      externalOrderId,
      externalPermanentId: textValue(row.perm_id ?? row.permId) || undefined,
      filledQuantity: numberValue(row.filledQuantity),
      rawDataHash: rawHash(response),
      remainingQuantity: numberValue(row.remainingQuantity, quantity),
      status: normalizeStatus(row.order_status ?? row.status ?? fallbackStatus),
      updatedAt: new Date().toISOString(),
    };
  }

  private async request<T>(path: string, method: "DELETE" | "GET" | "POST", body?: unknown) {
    try {
      return await requestGatewayJson<T>({
        baseUrl: this.baseUrl,
        body,
        method,
        path,
        timeoutMs: 10_000,
      });
    } catch (error) {
      invalidateIbkrPaperSession(this.paperProofCacheKey);
      throw error;
    }
  }

  private redactAccount(message: string) {
    return message.replaceAll(this.paperAccountId, "[REDACTED_ACCOUNT]");
  }
}

export function paperEnvironmentFromProcess(): PaperEnvironment {
  return {
    accountAllowlist: new Set(
      (process.env.BROKER_PAPER_ACCOUNT_HASH_ALLOWLIST ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
    connectorEnvironment: (process.env.BROKER_CONNECTOR_ENVIRONMENT ?? "DISABLED").toUpperCase(),
    runMode: (process.env.BROKER_CONNECTOR_MODE ?? "OFFLINE").toUpperCase(),
  };
}

export function createPaperExecutionProvider(): PaperBrokerExecutionProvider | null {
  const environment = paperEnvironmentFromProcess();
  if (environment.runMode !== "IBKR_PAPER" || environment.connectorEnvironment !== "PAPER") {
    return null;
  }
  if ((process.env.IBKR_PAPER_TRANSPORT ?? "HTTP").toUpperCase() === "TWS_SOCKET") {
    return new IbkrTwsPaperExecutionProvider(environment);
  }
  return new IbkrPaperHttpExecutionProvider(
    process.env.IBKR_PAPER_BASE_URL ?? "",
    process.env.IBKR_PAPER_ACCOUNT_ID ?? "",
    environment,
  );
}
