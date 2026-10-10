import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export type ConnectorPaperCapabilities = {
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

export type ConnectorPaperOrderInput = {
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

export type ConnectorPaperCancelInput = {
  accountRef: string;
  accountType: "PAPER";
  correlationId: string;
};

export type ConnectorPaperOrderState = {
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

export type ConnectorPaperAccountSummary = {
  availableFunds: number;
  baseCurrency: string;
  buyingPower: number;
  grossPositionValue: number;
  netLiquidation: number;
  realizedPnl: number;
  settledCash: number;
  snapshotTime: string;
  totalCash: number;
  unrealizedPnl: number;
};

export type ConnectorPaperPosition = {
  averageCost: number;
  currency: string;
  externalContractId: string;
  marketPrice: number;
  marketValue: number;
  quantity: number;
  symbol: string;
  unrealizedPnl: number;
};

export class SubmissionUnknownError extends Error {
  constructor(message = "Broker Connector 返回不确定，禁止盲目重试") {
    super(message);
    this.name = "SubmissionUnknownError";
  }
}

@Injectable()
export class PaperBrokerConnectorClient {
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>("BROKER_CONNECTOR_URL", "http://localhost:5092");
    const parsed = new URL(this.baseUrl);
    if (parsed.username || parsed.password || parsed.search) {
      throw new Error("Broker Connector URL 不得包含凭证或查询令牌");
    }
  }

  capabilities() {
    return this.request<ConnectorPaperCapabilities>("/paper/capabilities", "GET");
  }

  health() {
    return this.request<{ checkedAt: string; latencyMs: number; message: string; status: string }>(
      "/paper/health",
      "GET",
    );
  }

  preview(input: ConnectorPaperOrderInput) {
    return this.request<{
      accepted: boolean;
      accountType: "PAPER";
      estimatedCommission: number;
      estimatedSlippagePercent: number;
      estimatedValue: number;
      marketDataSource?: "IBKR_TWS_SOCKET" | "IBKR_CLIENT_PORTAL";
  marketDataQuality?: "VERIFIED_TOP_OF_BOOK" | "UNKNOWN";
  marketDataTime: string;
      marketDataType: "DELAYED" | "DELAYED_FROZEN" | "FROZEN" | "REALTIME" | "UNKNOWN";
      referencePrice: number;
      spreadPercent: number;
      warnings: string[];
    }>("/paper/orders/preview", "POST", input, input.correlationId);
  }

  async placePaperOrder(input: ConnectorPaperOrderInput) {
    return this.paperWriteRequest("/paper/orders", input);
  }

  modifyPaperOrder(externalOrderId: string, input: ConnectorPaperOrderInput) {
    return this.request<ConnectorPaperOrderState>(
      `/paper/orders/${encodeURIComponent(externalOrderId)}`,
      "PATCH",
      input,
      input.correlationId,
    );
  }

  cancelPaperOrder(externalOrderId: string, input: ConnectorPaperCancelInput) {
    return this.request<ConnectorPaperOrderState>(
      `/paper/orders/${encodeURIComponent(externalOrderId)}/cancel`,
      "POST",
      input,
      input.correlationId,
    );
  }

  confirmPaperOrderReply(replyId: string, input: ConnectorPaperOrderInput) {
    return this.paperWriteRequest(`/paper/replies/${encodeURIComponent(replyId)}/confirm`, input);
  }

  orderStatus(externalOrderId: string) {
    return this.request<ConnectorPaperOrderState>(
      `/paper/orders/${encodeURIComponent(externalOrderId)}`,
      "GET",
    );
  }

  openOrders() {
    return this.request<unknown[]>("/paper/orders/open", "GET");
  }

  completedOrders() {
    return this.request<unknown[]>("/paper/orders/completed", "GET");
  }

  executions() {
    return this.request<unknown[]>("/paper/executions", "GET");
  }

  accountSummary() {
    return this.request<ConnectorPaperAccountSummary>("/paper/account/summary", "GET");
  }

  positions() {
    return this.request<ConnectorPaperPosition[]>("/paper/account/positions", "GET");
  }

  private async paperWriteRequest(path: string, input: ConnectorPaperOrderInput) {
    try {
      return await this.request<ConnectorPaperOrderState>(
        path,
        "POST",
        input,
        input.correlationId,
      );
    } catch (error) {
      if (
        error instanceof DOMException ||
        (error instanceof Error &&
          (error.name === "AbortError" ||
            /提交结果未知|订单 ID|请求超时|超时|Gateway 返回 5\d\d|网关返回 5\d\d/.test(
              error.message,
            )))
      ) {
        throw new SubmissionUnknownError();
      }
      throw error;
    }
  }

  private async request<T>(
    path: string,
    method: "GET" | "PATCH" | "POST",
    body?: unknown,
    correlationId?: string,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), method === "GET" ? 8_000 : 15_000);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Correlation-Id": correlationId ?? "broker-paper-read",
        },
        method,
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as T & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? `Broker Connector 返回 ${response.status}`);
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }
}
