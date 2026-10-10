import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

type Capabilities = {
  canCancelOrders: false;
  canModifyOrders: false;
  canPlaceOrders: false;
  canReadAccounts: boolean;
  canReadExecutions: boolean;
  canReadOrders: boolean;
  canReadPositions: boolean;
  canReadTopOfBook: boolean;
};

export type ConnectorTopOfBook = {
  askPrice: number;
  askSize: number;
  bidPrice: number;
  bidSize: number;
  contractId: string;
  marketDataType: "DELAYED" | "DELAYED_FROZEN" | "FROZEN" | "REALTIME" | "UNKNOWN";
  snapshotTime: string;
  symbol: string;
};

export type ConnectorAccount = {
  accountType: string;
  baseCurrency: string;
  externalAccountId: string;
};

export type ConnectorSummary = {
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

export type ConnectorCash = {
  availableCash: number;
  currency: string;
  settledCash: number;
  totalCash: number;
};

export type ConnectorPosition = {
  averageCost: number;
  currency: string;
  externalContractId: string;
  marketPrice: number;
  marketValue: number;
  quantity: number;
  symbol: string;
  unrealizedPnl: number;
};

export type ConnectorExecution = {
  commission: number | null;
  currency: string;
  exchange: string;
  executionTime: string;
  externalExecutionId?: string;
  orderReference?: string;
  price: number;
  quantity: number;
  side: "BUY" | "SELL";
  symbol: string;
  tradeDate: string;
};

export type ConnectorTransaction = {
  amount: number;
  currency: string;
  externalTransactionId?: string;
  recordTime: string;
  symbol?: string;
  type: string;
};

export type ConnectorOrder = {
  averageFillPrice?: number;
  currency: string;
  externalOrderId: string;
  filledQuantity: number;
  limitPrice?: number;
  orderTime: string;
  orderType: string;
  quantity: number;
  side: "BUY" | "SELL";
  status: string;
  symbol: string;
};

export type ConnectorCorporateAction = {
  actionDate: string;
  actionType: string;
  amount?: number;
  currency: string;
  externalActionId?: string;
  ratio?: number;
  symbol: string;
};

@Injectable()
export class BrokerConnectorClient {
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>("BROKER_CONNECTOR_URL", "http://localhost:5092");
    const parsed = new URL(this.baseUrl);
    if (parsed.username || parsed.password || parsed.search) {
      throw new Error("BROKER_CONNECTOR_URL 不得包含用户名、密码或查询令牌");
    }
  }

  health() {
    return this.get<{ checkedAt: string; latencyMs: number; message: string; status: string }>(
      "/health",
    );
  }

  connection() {
    return this.get<{
      authenticated: boolean;
      connected: boolean;
      mode: string;
      provider: string;
      updatedAt: string;
    }>("/connection");
  }

  capabilities() {
    return this.get<Capabilities>("/capabilities");
  }

  accounts() {
    return this.get<ConnectorAccount[]>("/accounts");
  }

  summary(accountId: string) {
    return this.accountGet<ConnectorSummary>(accountId, "summary");
  }

  cash(accountId: string) {
    return this.accountGet<ConnectorCash[]>(accountId, "cash");
  }

  positions(accountId: string) {
    return this.accountGet<ConnectorPosition[]>(accountId, "positions");
  }

  executions(accountId: string, from: string, to: string) {
    return this.accountGet<ConnectorExecution[]>(accountId, "executions", from, to);
  }

  transactions(accountId: string, from: string, to: string) {
    return this.accountGet<ConnectorTransaction[]>(accountId, "transactions", from, to);
  }

  openOrders(accountId: string) {
    return this.accountGet<ConnectorOrder[]>(accountId, "open-orders");
  }

  completedOrders(accountId: string, from: string, to: string) {
    return this.accountGet<ConnectorOrder[]>(accountId, "completed-orders", from, to);
  }

  corporateActions(accountId: string, from: string, to: string) {
    return this.accountGet<ConnectorCorporateAction[]>(accountId, "corporate-actions", from, to);
  }

  topOfBook(symbol: string, contractId: string) {
    const query = `?symbol=${encodeURIComponent(symbol)}&contractId=${encodeURIComponent(contractId)}`;
    return this.get<ConnectorTopOfBook>(`/market-data/top-of-book${query}`);
  }

  private accountGet<T>(accountId: string, action: string, from?: string, to?: string) {
    const range =
      from && to ? `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` : "";
    return this.get<T>(`/accounts/${encodeURIComponent(accountId)}/${action}${range}`);
  }

  private async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        headers: { Accept: "application/json" },
        method: "GET",
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? `Broker Connector 返回 ${response.status}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
