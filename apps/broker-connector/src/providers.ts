import {
  READ_ONLY_CAPABILITIES,
  type BrokerAccountRecord,
  type BrokerAccountSummaryRecord,
  type BrokerCapabilities,
  type BrokerCashRecord,
  type BrokerConnectionStatus,
  type BrokerCorporateActionRecord,
  type BrokerExecutionRecord,
  type BrokerHealth,
  type BrokerOrderRecord,
  type BrokerPositionRecord,
  type BrokerProvider,
  type BrokerTransactionRecord,
  type BrokerTopOfBookRecord,
} from "./broker-provider";
import { assertLocalGatewayBaseUrl, requestGatewayJson } from "./http-json-client";
import { invalidateIbkrPaperSession, verifiedIbkrPaperAccount } from "./ibkr-session";
import { sharedTwsSocketClient } from "./tws-socket-client";

function numberValue(value: unknown, field: string): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) throw new Error(`券商字段 ${field} 不是有效数字`);
  return parsed;
}

function textValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sideValue(value: unknown): "BUY" | "SELL" {
  const normalized = textValue(value).toUpperCase();
  if (normalized === "BUY" || normalized === "BOT") return "BUY";
  if (normalized === "SELL" || normalized === "SLD") return "SELL";
  throw new Error("券商买卖方向无法识别");
}

function inRange(value: string, from: string, to: string) {
  const time = Date.parse(value);
  return time >= Date.parse(from) && time <= Date.parse(to);
}

export class OfflineBrokerProvider implements BrokerProvider {
  async healthCheck(): Promise<BrokerHealth> {
    return {
      checkedAt: new Date().toISOString(),
      latencyMs: 0,
      message: "Broker Connector 处于 OFFLINE，只保留本地风控和历史数据",
      status: "OFFLINE",
    };
  }

  async getConnectionStatus(): Promise<BrokerConnectionStatus> {
    return {
      authenticated: false,
      connected: false,
      mode: "OFFLINE",
      provider: "IBKR_READONLY",
      updatedAt: new Date().toISOString(),
    };
  }

  getSupportedCapabilities() {
    return READ_ONLY_CAPABILITIES;
  }

  private unavailable(): never {
    throw new Error("Broker Connector 当前处于 OFFLINE");
  }

  async getAccounts(): Promise<BrokerAccountRecord[]> {
    return this.unavailable();
  }

  async getAccountSummary(_accountId: string): Promise<BrokerAccountSummaryRecord> {
    return this.unavailable();
  }

  async getCashBalances(_accountId: string): Promise<BrokerCashRecord[]> {
    return this.unavailable();
  }

  async getPositions(_accountId: string): Promise<BrokerPositionRecord[]> {
    return this.unavailable();
  }

  async getExecutions(
    _accountId: string,
    _from: string,
    _to: string,
  ): Promise<BrokerExecutionRecord[]> {
    return this.unavailable();
  }

  async getTransactions(
    _accountId: string,
    _from: string,
    _to: string,
  ): Promise<BrokerTransactionRecord[]> {
    return this.unavailable();
  }

  async getOpenOrdersReadonly(_accountId: string): Promise<BrokerOrderRecord[]> {
    return this.unavailable();
  }

  async getCompletedOrdersReadonly(
    _accountId: string,
    _from: string,
    _to: string,
  ): Promise<BrokerOrderRecord[]> {
    return this.unavailable();
  }

  async getCorporateActions(
    _accountId: string,
    _from: string,
    _to: string,
  ): Promise<BrokerCorporateActionRecord[]> {
    return this.unavailable();
  }

  async getTopOfBook(_symbol: string, _contractId: string): Promise<BrokerTopOfBookRecord> {
    return this.unavailable();
  }

  async disconnect() {}
}

export class FixtureBrokerProvider implements BrokerProvider {
  readonly accountId = "TEST-ACCOUNT-001";

  getSupportedCapabilities(): BrokerCapabilities {
    return READ_ONLY_CAPABILITIES;
  }

  async healthCheck(): Promise<BrokerHealth> {
    return {
      checkedAt: new Date().toISOString(),
      latencyMs: 1,
      message: "只读验收 Provider 可用",
      status: "OK",
    };
  }

  async getConnectionStatus(): Promise<BrokerConnectionStatus> {
    return {
      authenticated: false,
      connected: true,
      mode: "MOCK",
      provider: "FIXTURE_READONLY",
      updatedAt: new Date().toISOString(),
    };
  }

  async getAccounts(): Promise<BrokerAccountRecord[]> {
    return [{ accountType: "INDIVIDUAL", baseCurrency: "USD", externalAccountId: this.accountId }];
  }

  async getAccountSummary(_accountId: string): Promise<BrokerAccountSummaryRecord> {
    return {
      availableFunds: 81_400,
      baseCurrency: "USD",
      buyingPower: 81_400,
      grossPositionValue: 38_600,
      netLiquidation: 120_000,
      realizedPnl: 18_000,
      settledCash: 81_400,
      snapshotTime: new Date().toISOString(),
      totalCash: 81_400,
      unrealizedPnl: -6_000,
    };
  }

  async getCashBalances(_accountId: string): Promise<BrokerCashRecord[]> {
    return [{ availableCash: 81_400, currency: "USD", settledCash: 81_400, totalCash: 81_400 }];
  }

  async getPositions(_accountId: string): Promise<BrokerPositionRecord[]> {
    return ([
      ["DLA2", 60, 200, 150], ["DLB2", 100, 90, 60], ["QQQM", 40, 320, 320],
      ["VOO", 12, 500, 500], ["AAPL", 30, 160, 160],
    ] as const).map(([symbol, quantity, averageCost, marketPrice]) => ({
      symbol, quantity, averageCost, marketPrice, currency: "USD", externalContractId: `SYNTHETIC-${symbol}`,
      marketValue: quantity * marketPrice, unrealizedPnl: quantity * (marketPrice - averageCost),
    }));
  }

  async getExecutions(
    _accountId: string,
    _from: string,
    _to: string,
  ): Promise<BrokerExecutionRecord[]> {
    return [];
  }

  async getTransactions(
    _accountId: string,
    _from: string,
    _to: string,
  ): Promise<BrokerTransactionRecord[]> {
    return [];
  }

  async getOpenOrdersReadonly(_accountId: string): Promise<BrokerOrderRecord[]> {
    return [];
  }

  async getCompletedOrdersReadonly(
    _accountId: string,
    _from: string,
    _to: string,
  ): Promise<BrokerOrderRecord[]> {
    return [];
  }

  async getCorporateActions(
    _accountId: string,
    _from: string,
    _to: string,
  ): Promise<BrokerCorporateActionRecord[]> {
    return [];
  }

  async getTopOfBook(symbol: string, contractId: string): Promise<BrokerTopOfBookRecord> {
    return {
      askPrice: 100.02,
      askSize: 900,
      bidPrice: 100,
      bidSize: 1100,
      contractId,
      marketDataType: "REALTIME",
      snapshotTime: new Date().toISOString(),
      symbol,
    };
  }

  async disconnect() {}
}

type JsonRecord = Record<string, unknown>;

export class IbkrReadonlyHttpProvider implements BrokerProvider {
  private readonly baseUrl: string;
  private readonly paperProofCacheKey: string;

  constructor(
    baseUrl: string,
    private readonly connectionMode: "IBKR_PAPER" | "READ_ONLY_LIVE" = "READ_ONLY_LIVE",
    private readonly expectedPaperAccountId = "",
  ) {
    this.baseUrl = assertLocalGatewayBaseUrl(baseUrl, "IBKR 只读网关");
    if (connectionMode === "IBKR_PAPER" && !expectedPaperAccountId.trim()) {
      throw new Error("缺少本机 IBKR Paper Account 配置");
    }
    this.paperProofCacheKey = `${this.baseUrl}|${expectedPaperAccountId}`;
  }

  getSupportedCapabilities() {
    return READ_ONLY_CAPABILITIES;
  }

  async healthCheck(): Promise<BrokerHealth> {
    const started = Date.now();
    try {
      await this.read<JsonRecord>("/tickle");
      if (this.connectionMode === "IBKR_PAPER") await this.paperAccount();
      return {
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        message: "IBKR 只读网关可达",
        status: "OK",
      };
    } catch {
      return {
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        message: "IBKR 只读网关不可达",
        status: "OFFLINE",
      };
    }
  }

  async getConnectionStatus(): Promise<BrokerConnectionStatus> {
    const result = await this.request<JsonRecord>("/iserver/auth/status", "POST");
    return {
      authenticated: Boolean(result.authenticated),
      connected: Boolean(result.connected),
      mode: this.connectionMode,
      provider: "IBKR_READONLY",
      updatedAt: new Date().toISOString(),
    };
  }

  async getAccounts(): Promise<BrokerAccountRecord[]> {
    if (this.connectionMode === "IBKR_PAPER") {
      const row = await this.paperAccount();
      return [{
        accountType: "PAPER",
        baseCurrency: textValue(row.currency, "USD"),
        externalAccountId: textValue(row.accountId ?? row.id),
      }];
    }
    const rows = await this.read<JsonRecord[]>("/portfolio/accounts");
    return rows.map((row) => ({
      accountType: textValue(row.type, "UNKNOWN"),
      baseCurrency: textValue(row.currency, "USD"),
      externalAccountId: textValue(row.accountId ?? row.id),
    }));
  }

  async getAccountSummary(accountId: string): Promise<BrokerAccountSummaryRecord> {
    const row = await this.read<JsonRecord>(`/portfolio/${encodeURIComponent(accountId)}/summary`);
    const value = (key: string) => {
      const field = row[key];
      return numberValue(
        field && typeof field === "object" ? (field as JsonRecord).amount : field,
        key,
      );
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

  async getCashBalances(accountId: string): Promise<BrokerCashRecord[]> {
    const ledger = await this.read<JsonRecord>(
      `/portfolio/${encodeURIComponent(accountId)}/ledger`,
    );
    return Object.entries(ledger)
      .filter(([currency, value]) => currency !== "BASE" && value && typeof value === "object")
      .map(([currency, value]) => {
        const row = value as JsonRecord;
        return {
          availableCash: numberValue(row.cashbalance, "cashbalance"),
          currency,
          settledCash: numberValue(row.settledcash ?? row.cashbalance, "settledcash"),
          totalCash: numberValue(row.cashbalance, "cashbalance"),
        };
      });
  }

  async getPositions(accountId: string): Promise<BrokerPositionRecord[]> {
    const rows = await this.read<JsonRecord[]>(
      `/portfolio/${encodeURIComponent(accountId)}/positions/0`,
    );
    return rows.map((row) => ({
      averageCost: numberValue(row.avgCost, "avgCost"),
      currency: textValue(row.currency, "USD"),
      externalContractId: String(row.conid ?? ""),
      marketPrice: numberValue(row.mktPrice, "mktPrice"),
      marketValue: numberValue(row.mktValue, "mktValue"),
      quantity: numberValue(row.position, "position"),
      symbol: textValue(row.ticker ?? row.contractDesc),
      unrealizedPnl: numberValue(row.unrealizedPnl, "unrealizedPnl"),
    }));
  }

  async getExecutions(
    _accountId: string,
    from: string,
    to: string,
  ): Promise<BrokerExecutionRecord[]> {
    const response = await this.read<JsonRecord>("/iserver/account/trades");
    const rows = Array.isArray(response.trades) ? (response.trades as JsonRecord[]) : [];
    return rows
      .map((row) => ({
        commission: numberValue(row.commission, "commission"),
        currency: textValue(row.currency, "USD"),
        exchange: textValue(row.exchange, "UNKNOWN"),
        executionTime: new Date(String(row.trade_time ?? row.time)).toISOString(),
        externalExecutionId: textValue(row.execution_id ?? row.execId) || undefined,
        orderReference: textValue(row.order_ref ?? row.orderId) || undefined,
        price: numberValue(row.price, "price"),
        quantity: Math.abs(numberValue(row.size, "size")),
        side: sideValue(row.side),
        symbol: textValue(row.symbol),
        tradeDate: textValue(
          row.trade_date,
          new Date(String(row.trade_time)).toISOString().slice(0, 10),
        ),
      }))
      .filter((row) => inRange(row.executionTime, from, to));
  }

  async getTransactions(
    _accountId: string,
    _from: string,
    _to: string,
  ): Promise<BrokerTransactionRecord[]> {
    return [];
  }

  async getOpenOrdersReadonly(_accountId: string): Promise<BrokerOrderRecord[]> {
    const response = await this.read<JsonRecord>("/iserver/account/orders");
    return this.mapOrders(response);
  }

  async getCompletedOrdersReadonly(
    _accountId: string,
    from: string,
    to: string,
  ): Promise<BrokerOrderRecord[]> {
    const response = await this.read<JsonRecord>("/iserver/account/orders?force=true");
    return this.mapOrders(response).filter((row) => inRange(row.orderTime, from, to));
  }

  async getCorporateActions(
    _accountId: string,
    _from: string,
    _to: string,
  ): Promise<BrokerCorporateActionRecord[]> {
    return [];
  }

  async getTopOfBook(symbol: string, contractId: string): Promise<BrokerTopOfBookRecord> {
    if (!/^\d{1,20}$/.test(contractId)) throw new Error("IBKR contractId 格式无效");
    const fields = "84,85,86,88";
    const path = `/iserver/marketdata/snapshot?conids=${encodeURIComponent(contractId)}&fields=${fields}`;
    let rows = await this.read<JsonRecord[]>(path);
    let row = rows[0] ?? {};
    if (row["84"] === undefined || row["86"] === undefined) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      rows = await this.read<JsonRecord[]>(path);
      row = rows[0] ?? {};
    }
    return {
      askPrice: numberValue(row["86"], "askPrice"),
      askSize: numberValue(row["85"], "askSize"),
      bidPrice: numberValue(row["84"], "bidPrice"),
      bidSize: numberValue(row["88"], "bidSize"),
      contractId,
      marketDataType: "UNKNOWN",
      snapshotTime: new Date(Number(row._updated ?? Date.now())).toISOString(),
      symbol,
    };
  }

  async disconnect() {}

  private mapOrders(response: JsonRecord): BrokerOrderRecord[] {
    const rows = Array.isArray(response.orders) ? (response.orders as JsonRecord[]) : [];
    return rows.map((row) => ({
      averageFillPrice: numberValue(row.avgPrice, "avgPrice"),
      currency: textValue(row.currency, "USD"),
      externalOrderId: String(row.orderId ?? ""),
      filledQuantity: numberValue(row.filledQuantity, "filledQuantity"),
      limitPrice: row.price === undefined ? undefined : numberValue(row.price, "price"),
      orderTime: new Date(
        String(row.lastExecutionTime_r ?? row.orderTime ?? Date.now()),
      ).toISOString(),
      orderType: textValue(row.orderType, "UNKNOWN"),
      quantity: numberValue(row.totalSize, "totalSize"),
      side: sideValue(row.side),
      status: textValue(row.status, "UNKNOWN"),
      symbol: textValue(row.ticker ?? row.symbol),
    }));
  }

  private async read<T>(path: string): Promise<T> {
    return this.request<T>(path, "GET");
  }

  private async paperAccount() {
    return verifiedIbkrPaperAccount({
      cacheKey: this.paperProofCacheKey,
      load: async () => {
        const [ssoValidation, authenticationStatus, accounts] = await Promise.all([
          this.read<JsonRecord>("/sso/validate"),
          this.request<JsonRecord>("/iserver/auth/status", "POST"),
          this.read<JsonRecord[]>("/portfolio/accounts"),
        ]);
        return {
          accounts,
          authenticationStatus,
          expectedAccountId: this.expectedPaperAccountId,
          ssoValidation,
        };
      },
    });
  }

  private async request<T>(path: string, method: "GET" | "POST") {
    try {
      return await requestGatewayJson<T>({
        baseUrl: this.baseUrl,
        method,
        path,
        timeoutMs: 8_000,
      });
    } catch (error) {
      if (this.connectionMode === "IBKR_PAPER") {
        invalidateIbkrPaperSession(this.paperProofCacheKey);
      }
      throw error;
    }
  }
}

export class IbkrTwsReadonlyProvider implements BrokerProvider {
  private readonly client = sharedTwsSocketClient();

  getSupportedCapabilities() {
    return READ_ONLY_CAPABILITIES;
  }

  async healthCheck(): Promise<BrokerHealth> {
    const started = Date.now();
    try {
      await this.client.ping();
      return {
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        message: "IBKR TWS Socket Paper 可达且仅返回模拟账户",
        status: "OK",
      };
    } catch {
      return {
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        message: "IBKR TWS Socket Paper 不可达或账户类型不匹配",
        status: "OFFLINE",
      };
    }
  }

  async getConnectionStatus(): Promise<BrokerConnectionStatus> {
    await this.client.connect();
    return {
      authenticated: this.client.isConnected,
      connected: this.client.isConnected,
      mode: "IBKR_PAPER",
      provider: "IBKR_TWS_SOCKET",
      updatedAt: new Date().toISOString(),
    };
  }

  async getAccounts() {
    return this.client.getAccounts();
  }

  async getAccountSummary(accountId: string) {
    return this.client.getAccountSummary(accountId);
  }

  async getCashBalances(accountId: string) {
    return this.client.getCashBalances(accountId);
  }

  async getPositions(accountId: string) {
    return this.client.getPositions(accountId);
  }

  async getExecutions(accountId: string, from: string, to: string) {
    return this.client.getExecutions(accountId, from, to);
  }

  async getTransactions(
    accountId: string,
    _from: string,
    _to: string,
  ): Promise<BrokerTransactionRecord[]> {
    await this.client.ensurePaperAccount(accountId);
    return [];
  }

  async getOpenOrdersReadonly(accountId: string) {
    await this.client.ensurePaperAccount(accountId);
    return this.client.getOpenOrders();
  }

  async getCompletedOrdersReadonly(accountId: string, from: string, to: string) {
    await this.client.ensurePaperAccount(accountId);
    return this.client.getCompletedOrders(from, to);
  }

  async getCorporateActions(
    accountId: string,
    _from: string,
    _to: string,
  ): Promise<BrokerCorporateActionRecord[]> {
    await this.client.ensurePaperAccount(accountId);
    return [];
  }

  async getTopOfBook(symbol: string, contractId: string) {
    return this.client.getTopOfBook(symbol, contractId);
  }

  async disconnect() {
    await this.client.disconnect();
  }
}

export function createBrokerProvider(): BrokerProvider {
  const mode = (process.env.BROKER_CONNECTOR_MODE ?? "OFFLINE").toUpperCase();
  if (mode === "MOCK") return new FixtureBrokerProvider();
  if (mode === "READ_ONLY_LIVE") {
    return new IbkrReadonlyHttpProvider(process.env.IBKR_READONLY_BASE_URL ?? "");
  }
  if (mode === "IBKR_PAPER") {
    if ((process.env.IBKR_PAPER_TRANSPORT ?? "HTTP").toUpperCase() === "TWS_SOCKET") {
      return new IbkrTwsReadonlyProvider();
    }
    return new IbkrReadonlyHttpProvider(
      process.env.IBKR_PAPER_BASE_URL ?? "",
      "IBKR_PAPER",
      process.env.IBKR_PAPER_ACCOUNT_ID ?? "",
    );
  }
  return new OfflineBrokerProvider();
}
