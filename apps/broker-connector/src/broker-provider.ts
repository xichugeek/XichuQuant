export type BrokerCapabilities = {
  canCancelOrders: false;
  canModifyOrders: false;
  canPlaceOrders: false;
  canReadAccounts: boolean;
  canReadExecutions: boolean;
  canReadOrders: boolean;
  canReadPositions: boolean;
  canReadTopOfBook: boolean;
};

export type BrokerTopOfBookRecord = {
  askPrice: number;
  askSize: number;
  bidPrice: number;
  bidSize: number;
  contractId: string;
  marketDataType: "DELAYED" | "DELAYED_FROZEN" | "FROZEN" | "REALTIME" | "UNKNOWN";
  snapshotTime: string;
  symbol: string;
};

export type BrokerHealth = {
  checkedAt: string;
  latencyMs: number;
  message: string;
  status: "OFFLINE" | "OK" | "STALE";
};

export type BrokerConnectionStatus = {
  authenticated: boolean;
  connected: boolean;
  mode: "IBKR_PAPER" | "MOCK" | "OFFLINE" | "READ_ONLY_LIVE";
  provider: string;
  updatedAt: string;
};

export type BrokerAccountRecord = {
  accountType: string;
  baseCurrency: string;
  externalAccountId: string;
};

export type BrokerAccountSummaryRecord = {
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

export type BrokerCashRecord = {
  availableCash: number;
  currency: string;
  settledCash: number;
  totalCash: number;
};

export type BrokerPositionRecord = {
  averageCost: number;
  currency: string;
  externalContractId: string;
  marketPrice: number;
  marketValue: number;
  quantity: number;
  symbol: string;
  unrealizedPnl: number;
};

export type BrokerExecutionRecord = {
  commission: number | null;
  commissionReportId?: string;
  realizedPnl?: number | null;
  externalOrderId?: string;
  externalPermanentId?: string;
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

export type BrokerTransactionRecord = {
  amount: number;
  currency: string;
  externalTransactionId?: string;
  recordTime: string;
  symbol?: string;
  type: string;
};

export type BrokerOrderRecord = {
  externalPermanentId?: string;
  orderReference?: string;
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
  stopPrice?: number;
  symbol: string;
};

export type BrokerCorporateActionRecord = {
  actionDate: string;
  actionType: string;
  amount?: number;
  currency: string;
  externalActionId?: string;
  ratio?: number;
  symbol: string;
};

export interface BrokerProvider {
  disconnect(): Promise<void>;
  getAccountSummary(accountId: string): Promise<BrokerAccountSummaryRecord>;
  getAccounts(): Promise<BrokerAccountRecord[]>;
  getCashBalances(accountId: string): Promise<BrokerCashRecord[]>;
  getCompletedOrdersReadonly(
    accountId: string,
    from: string,
    to: string,
  ): Promise<BrokerOrderRecord[]>;
  getConnectionStatus(): Promise<BrokerConnectionStatus>;
  getCorporateActions(
    accountId: string,
    from: string,
    to: string,
  ): Promise<BrokerCorporateActionRecord[]>;
  getExecutions(accountId: string, from: string, to: string): Promise<BrokerExecutionRecord[]>;
  getOpenOrdersReadonly(accountId: string): Promise<BrokerOrderRecord[]>;
  getPositions(accountId: string): Promise<BrokerPositionRecord[]>;
  getSupportedCapabilities(): BrokerCapabilities;
  getTopOfBook(symbol: string, contractId: string): Promise<BrokerTopOfBookRecord>;
  getTransactions(accountId: string, from: string, to: string): Promise<BrokerTransactionRecord[]>;
  healthCheck(): Promise<BrokerHealth>;
}

export const READ_ONLY_CAPABILITIES: BrokerCapabilities = Object.freeze({
  canCancelOrders: false,
  canModifyOrders: false,
  canPlaceOrders: false,
  canReadAccounts: true,
  canReadExecutions: true,
  canReadOrders: true,
  canReadPositions: true,
  canReadTopOfBook: true,
});
