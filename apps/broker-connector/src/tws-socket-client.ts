import { parseExecutionTime } from "./execution-time";
import { createHash } from "node:crypto";

import {
  EventName,
  IBApi,
  MarketDataType,
  OrderAction,
  OrderType,
  SecType,
  type CommissionReport,
  type Contract,
  type Execution,
  type ExecutionFilter,
  type Order,
  type OrderState,
  type TickType,
} from "@stoqey/ib";

import type {
  BrokerAccountRecord,
  BrokerAccountSummaryRecord,
  BrokerCashRecord,
  BrokerExecutionRecord,
  BrokerOrderRecord,
  BrokerPositionRecord,
  BrokerTopOfBookRecord,
} from "./broker-provider";
import type { PaperOrderInput, PaperOrderState } from "./paper-execution-provider";

export type TwsSocketConfig = {
  apiReadOnly: boolean;
  clientId: number;
  expectedPaperAccountId: string;
  host: string;
  port: number;
  timeoutMs: number;
};

type AccountValue = {
  currency: string;
  key: string;
  value: string;
};

type AccountSnapshot = {
  accountValues: AccountValue[];
  positions: BrokerPositionRecord[];
};

type TwsOrderRow = {
  broker: BrokerOrderRecord;
  orderRef: string;
  parentId?: number;
  permanentId?: string;
};

const PAPER_SOCKET_PORTS = new Set([4002, 7497]);
const SAFE_SOCKET_HOSTS = new Set(["127.0.0.1", "::1", "localhost", "host.docker.internal"]);
const NON_FATAL_CODES = new Set([1101, 1102, 2104, 2106, 2107, 2108, 2158]);
const MARKET_TICK = Object.freeze({
  ASK: 2,
  ASK_SIZE: 3,
  BID: 1,
  BID_SIZE: 0,
  DELAYED_ASK: 67,
  DELAYED_ASK_SIZE: 70,
  DELAYED_BID: 66,
  DELAYED_BID_SIZE: 69,
  DELAYED_LAST: 68,
  LAST: 4,
});

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined || value.trim() === "") return fallback;
  if (/^(1|true|yes)$/i.test(value.trim())) return true;
  if (/^(0|false|no)$/i.test(value.trim())) return false;
  throw new Error("IBKR TWS 布尔配置无效");
}

function parseInteger(value: string | undefined, fallback: number, field: string) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${field} 必须是整数`);
  return parsed;
}

export function twsSocketConfigFromEnvironment(environment: NodeJS.ProcessEnv): TwsSocketConfig {
  const host = (environment.IBKR_TWS_HOST ?? "127.0.0.1").trim().toLowerCase();
  const port = parseInteger(environment.IBKR_TWS_PORT, 4002, "IBKR_TWS_PORT");
  const clientId = parseInteger(environment.IBKR_TWS_CLIENT_ID, 71, "IBKR_TWS_CLIENT_ID");
  const timeoutMs = parseInteger(environment.IBKR_TWS_TIMEOUT_MS, 12_000, "IBKR_TWS_TIMEOUT_MS");
  const expectedPaperAccountId = (environment.IBKR_PAPER_ACCOUNT_ID ?? "").trim().toUpperCase();

  if (!SAFE_SOCKET_HOSTS.has(host)) {
    throw new Error("IBKR TWS Socket 仅允许本机或 Docker 宿主地址");
  }
  if (!PAPER_SOCKET_PORTS.has(port)) {
    throw new Error("IBKR Paper Socket 仅允许官方 Paper 端口 4002 或 7497");
  }
  if (clientId < 1 || clientId > 999_999) throw new Error("IBKR_TWS_CLIENT_ID 超出安全范围");
  if (timeoutMs < 2_000 || timeoutMs > 30_000) throw new Error("IBKR_TWS_TIMEOUT_MS 超出安全范围");
  if (expectedPaperAccountId && !isPaperAccount(expectedPaperAccountId)) {
    throw new Error("IBKR_PAPER_ACCOUNT_ID 不是 DU 开头的模拟账户");
  }

  return {
    apiReadOnly: parseBoolean(environment.IBKR_TWS_API_READ_ONLY, true),
    clientId,
    expectedPaperAccountId,
    host,
    port,
    timeoutMs,
  };
}

export function twsSocketConfigFromProcess() {
  return twsSocketConfigFromEnvironment(process.env);
}

function rawHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeStatus(value: unknown) {
  const status = String(value ?? "UNKNOWN").toUpperCase().replaceAll(" ", "_");
  return ({
    APICANCELLED: "API_CANCELLED",
    API_PENDING: "API_PENDING",
    APIPENDING: "API_PENDING",
    CANCELLED: "CANCELLED",
    FILLED: "FILLED",
    INACTIVE: "INACTIVE",
    PENDINGCANCEL: "PENDING_CANCEL",
    PENDING_CANCEL: "PENDING_CANCEL",
    PENDINGSUBMIT: "SUBMITTING",
    PENDING_SUBMIT: "SUBMITTING",
    PRESUBMITTED: "PRE_SUBMITTED",
    PRE_SUBMITTED: "PRE_SUBMITTED",
    SUBMITTED: "SUBMITTED",
  } as Record<string, string>)[status] ?? status;
}

function finite(value: unknown, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function side(value: unknown): "BUY" | "SELL" {
  return /^(BUY|BOT)$/i.test(String(value ?? "")) ? "BUY" : "SELL";
}

function errorDetails(args: unknown[]) {
  if (args[0] instanceof Error) {
    return {
      code: finite(args[1], -1),
      message: args[0].message,
      requestId: finite(args[2], -1),
    };
  }
  return {
    code: finite(args[1], -1),
    message: String(args[2] ?? args[0] ?? "IBKR TWS API 错误"),
    requestId: finite(args[0], -1),
  };
}

export function isDelayedMarketDataNotice(args: unknown[], requestId: number) {
  const details = errorDetails(args);
  return details.requestId === requestId && new Set([354, 10167]).has(details.code);
}

function isPaperAccount(accountId: string) {
  return /^DU(?=[A-Z0-9]{5,20}$)(?=[A-Z0-9]*\d)[A-Z0-9]+$/i.test(accountId.trim());
}

export class IbkrTwsSocketClient {
  private readonly commissionReports = new Map<string, CommissionReport>();
  private orderWriteChain: Promise<unknown> = Promise.resolve();
  private accountUpdateChain: Promise<unknown> = Promise.resolve();
  private api: IBApi | null = null;
  private connectPromise: Promise<void> | null = null;
  private managedAccounts: string[] = [];
  private nextOrderId: number | null = null;
  private requestId = 7_100_000;

  constructor(readonly config: TwsSocketConfig) {}

  get canWritePaperOrders() {
    return !this.config.apiReadOnly && Boolean(this.config.expectedPaperAccountId);
  }

  get isConnected() {
    return Boolean(this.api?.isConnected && this.managedAccounts.length);
  }

  async connect() {
    if (this.isConnected) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const api = new IBApi({
        host: this.config.host,
        maxReqPerSec: 20,
        port: this.config.port,
      });
      this.api = api;
      api.on(EventName.commissionReport, (report: CommissionReport) => {
        if (report.execId) this.commissionReports.set(report.execId, report);
      });
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        api.disconnect();
        reject(new Error("IBKR TWS Socket 连接超时，请确认 Gateway 已登录并启用 API"));
      }, this.config.timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        api.off(EventName.managedAccounts, onAccounts);
        api.off(EventName.error, onError);
      };
      const onAccounts = (accountsList: string) => {
        try {
          const accounts = accountsList.split(",").map((item) => item.trim()).filter(Boolean);
          this.assertPaperAccounts(accounts);
          this.managedAccounts = accounts;
          if (!settled) {
            settled = true;
            cleanup();
            resolve();
          }
        } catch (error) {
          if (!settled) {
            settled = true;
            cleanup();
            api.disconnect();
            reject(error);
          }
        }
      };
      const onError = (...args: unknown[]) => {
        const details = errorDetails(args);
        if (NON_FATAL_CODES.has(details.code)) return;
        if (!settled) {
          settled = true;
          cleanup();
          api.disconnect();
          reject(new Error(`IBKR TWS Socket 连接失败（${details.code}）：${details.message}`));
        }
      };

      api.on(EventName.managedAccounts, onAccounts);
      api.on(EventName.error, onError);
      api.on(EventName.nextValidId, (orderId: number) => {
        this.nextOrderId = Math.max(this.nextOrderId ?? 0, orderId);
      });
      api.on(EventName.connectionClosed, () => {
        this.managedAccounts = [];
        this.nextOrderId = null;
      });
      api.connect(this.config.clientId);
    }).finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  async disconnect() {
    this.api?.disconnect();
    this.api = null;
    this.managedAccounts = [];
    this.nextOrderId = null;
  }

  async ping() {
    const api = await this.connectedApi();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("IBKR TWS 时间探测超时")), this.config.timeoutMs);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        api.off(EventName.currentTime, onTime);
        api.off(EventName.error, onError);
        if (error) reject(error);
        else resolve();
      };
      const onTime = () => finish();
      const onError = (...args: unknown[]) => {
        const details = errorDetails(args);
        if (!NON_FATAL_CODES.has(details.code)) finish(new Error(details.message));
      };
      api.once(EventName.currentTime, onTime);
      api.on(EventName.error, onError);
      api.reqCurrentTime();
    });
  }

  async getAccounts(): Promise<BrokerAccountRecord[]> {
    await this.connect();
    const result: BrokerAccountRecord[] = [];
    for (const accountId of this.managedAccounts) {
      const snapshot = await this.getAccountSnapshot(accountId);
      const baseCurrency =
        snapshot.accountValues.find((row) => row.key === "NetLiquidation" && row.currency)?.currency ||
        "USD";
      result.push({ accountType: "PAPER", baseCurrency, externalAccountId: accountId });
    }
    return result;
  }

  async ensurePaperAccount(accountId: string) {
    await this.connect();
    this.assertConfiguredAccount(accountId);
  }

  async getAccountSummary(accountId: string): Promise<BrokerAccountSummaryRecord> {
    this.assertConfiguredAccount(accountId);
    const snapshot = await this.getAccountSnapshot(accountId);
    const value = (key: string) => {
      const matches = snapshot.accountValues.filter((row) => row.key === key);
      const base = matches.find((row) => row.currency && row.currency !== "BASE") ?? matches[0];
      return finite(base?.value);
    };
    const baseCurrency =
      snapshot.accountValues.find((row) => row.key === "NetLiquidation" && row.currency)?.currency ||
      "USD";
    return {
      availableFunds: value("AvailableFunds"),
      baseCurrency,
      buyingPower: value("BuyingPower"),
      grossPositionValue: value("GrossPositionValue"),
      netLiquidation: value("NetLiquidation"),
      realizedPnl: value("RealizedPnL"),
      settledCash: value("SettledCash") || value("CashBalance"),
      snapshotTime: new Date().toISOString(),
      totalCash: value("TotalCashValue") || value("TotalCashBalance"),
      unrealizedPnl: value("UnrealizedPnL"),
    };
  }

  async getCashBalances(accountId: string): Promise<BrokerCashRecord[]> {
    this.assertConfiguredAccount(accountId);
    const snapshot = await this.getAccountSnapshot(accountId);
    const currencies = new Set(
      snapshot.accountValues
        .map((row) => row.currency)
        .filter((currency) => /^[A-Z]{3}$/.test(currency)),
    );
    return [...currencies].map((currency) => {
      const value = (key: string) =>
        finite(snapshot.accountValues.find((row) => row.currency === currency && row.key === key)?.value);
      return {
        availableCash: value("AvailableFunds") || value("CashBalance"),
        currency,
        settledCash: value("SettledCash") || value("CashBalance"),
        totalCash: value("TotalCashBalance") || value("CashBalance"),
      };
    });
  }

  async getPositions(accountId: string) {
    this.assertConfiguredAccount(accountId);
    return (await this.getAccountSnapshot(accountId)).positions;
  }

  async getExecutions(accountId: string, from: string, to: string): Promise<BrokerExecutionRecord[]> {
    this.assertConfiguredAccount(accountId);
    const api = await this.connectedApi();
    const reqId = this.nextRequestId();
    const executions = new Map<string, { contract: Contract; execution: Execution }>();
    const commissions = this.commissionReports;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("IBKR TWS 成交查询超时")), this.config.timeoutMs);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        api.off(EventName.execDetails, onExecution);
        api.off(EventName.execDetailsEnd, onEnd);
        api.off(EventName.commissionReport, onCommission);
        api.off(EventName.error, onError);
        if (error) reject(error);
        else resolve();
      };
      const onExecution = (eventReqId: number, contract: Contract, execution: Execution) => {
        if (eventReqId === reqId && execution.execId) executions.set(execution.execId, { contract, execution });
      };
      const onCommission = (commission: CommissionReport) => {
        if (commission.execId) commissions.set(commission.execId, commission);
      };
      const onEnd = (eventReqId: number) => {
        if (eventReqId === reqId) setTimeout(() => finish(), 100);
      };
      const onError = (...args: unknown[]) => this.rejectRequest(args, reqId, finish);
      api.on(EventName.execDetails, onExecution);
      api.on(EventName.execDetailsEnd, onEnd);
      api.on(EventName.commissionReport, onCommission);
      api.on(EventName.error, onError);
      api.reqExecutions(reqId, { acctCode: accountId } as ExecutionFilter);
    });

    return [...executions.values()]
      .map(({ contract, execution }) => {
        const executionTime = parseExecutionTime(execution.time, process.env.IBKR_TWS_EXECUTION_TIMEZONE);
        const commission = execution.execId ? commissions.get(execution.execId) : undefined;
        return {
          commission: commission && Number.isFinite(commission.commission) && Math.abs(commission.commission ?? Number.NaN) < 1e100 ? commission.commission ?? null : null,
          commissionReportId: commission?.execId,
          realizedPnl: commission && Number.isFinite(commission.realizedPNL) && Math.abs(commission.realizedPNL ?? 0) < 1e100 ? commission.realizedPNL : null,
          externalOrderId: String(execution.orderId ?? ""),
          externalPermanentId: String(execution.permId ?? ""),
          currency: commission?.currency || contract.currency || "USD",
          exchange: execution.exchange || "UNKNOWN",
          executionTime,
          externalExecutionId: execution.execId,
          orderReference: execution.orderRef || String(execution.orderId ?? "") || undefined,
          price: finite(execution.price),
          quantity: Math.abs(finite(execution.shares)),
          side: side(execution.side),
          symbol: contract.symbol || contract.localSymbol || "UNKNOWN",
          tradeDate: executionTime.slice(0, 10),
        } satisfies BrokerExecutionRecord;
      })
      .filter((row) => Date.parse(row.executionTime) >= Date.parse(from) && Date.parse(row.executionTime) <= Date.parse(to));
  }

  async getOpenOrders(): Promise<BrokerOrderRecord[]> {
    return (await this.getOpenOrderRows()).map((row) => row.broker);
  }

  async getCompletedOrders(from: string, to: string): Promise<BrokerOrderRecord[]> {
    return (await this.getCompletedOrderRows())
      .map((row) => row.broker)
      .filter((row) => Date.parse(row.orderTime) >= Date.parse(from) && Date.parse(row.orderTime) <= Date.parse(to));
  }

  async getTopOfBook(symbol: string, contractId: string): Promise<BrokerTopOfBookRecord> {
    const api = await this.connectedApi();
    const reqId = this.nextRequestId();
    const quote = { askPrice: 0, askSize: 0, bidPrice: 0, bidSize: 0, lastPrice: 0 };
    let dataType = 0;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("IBKR TWS 行情快照超时")), this.config.timeoutMs);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        api.off(EventName.tickPrice, onPrice);
        api.off(EventName.tickSize, onSize);
        api.off(EventName.tickSnapshotEnd, onEnd);
        api.off(EventName.marketDataType, onDataType);
        api.off(EventName.error, onError);
        api.cancelMktData(reqId);
        if (error) reject(error);
        else resolve();
      };
      const ready = () => {
        if (quote.askPrice > 0 && quote.bidPrice > 0 && dataType > 0) finish();
      };
      const onDataType = (eventReqId: number, value: number) => {
        if (eventReqId !== reqId) return;
        dataType = value;
        ready();
      };
      const onPrice = (eventReqId: number, field: TickType, value: number) => {
        if (eventReqId !== reqId || value <= 0) return;
        if (field === MARKET_TICK.ASK || field === MARKET_TICK.DELAYED_ASK) quote.askPrice = value;
        if (field === MARKET_TICK.BID || field === MARKET_TICK.DELAYED_BID) quote.bidPrice = value;
        if (field === MARKET_TICK.LAST || field === MARKET_TICK.DELAYED_LAST) quote.lastPrice = value;
        ready();
      };
      const onSize = (eventReqId: number, field?: TickType, value?: number) => {
        if (eventReqId !== reqId) return;
        if (field === MARKET_TICK.ASK_SIZE || field === MARKET_TICK.DELAYED_ASK_SIZE) quote.askSize = finite(value);
        if (field === MARKET_TICK.BID_SIZE || field === MARKET_TICK.DELAYED_BID_SIZE) quote.bidSize = finite(value);
      };
      const onEnd = (eventReqId: number) => {
        if (eventReqId === reqId) finish(quote.askPrice > 0 && quote.bidPrice > 0 ? undefined : new Error("IBKR TWS 未返回有效买卖价"));
      };
      const onError = (...args: unknown[]) => {
        if (isDelayedMarketDataNotice(args, reqId)) return;
        this.rejectRequest(args, reqId, finish);
      };
      api.on(EventName.tickPrice, onPrice);
      api.on(EventName.tickSize, onSize);
      api.on(EventName.tickSnapshotEnd, onEnd);
      api.on(EventName.marketDataType, onDataType);
      api.on(EventName.error, onError);
      // 请求 IBKR 的最佳可用行情：账户有实时权限时返回 REALTIME，
      // 否则返回明确标记的 DELAYED；ExecutionGuard 不允许延迟行情下单。
      api.reqMarketDataType(MarketDataType.DELAYED);
      api.reqMktData(reqId, this.stockContract(symbol, contractId), null, true, false);
    });
    return {
      askPrice: quote.askPrice,
      askSize: quote.askSize,
      bidPrice: quote.bidPrice,
      bidSize: quote.bidSize,
      contractId,
      marketDataType:
        ({
          1: "REALTIME",
          2: "FROZEN",
          3: "DELAYED",
          4: "DELAYED_FROZEN",
        } as const)[dataType as 1 | 2 | 3 | 4] ?? "UNKNOWN",
      snapshotTime: new Date().toISOString(),
      symbol,
    };
  }

  async findOrderByReference(orderRef: string): Promise<PaperOrderState | null> {
    const rows = [...(await this.getOpenOrderRows()), ...(await this.getCompletedOrderRows())];
    const found = rows.find((row) => row.orderRef === orderRef);
    if (!found) return null;
    return this.orderRowState(found, this.protectiveRow(rows, found));
  }

  async getOrderState(externalOrderId: string): Promise<PaperOrderState> {
    const normalized = String(this.numericOrderId(externalOrderId));
    const rows = [...(await this.getOpenOrderRows()), ...(await this.getCompletedOrderRows())];
    const found = rows.find((row) => row.broker.externalOrderId === normalized);
    if (!found) throw new Error("Paper 订单状态尚未从 IBKR TWS 返回");
    return this.orderRowState(found, this.protectiveRow(rows, found));
  }

  async placePaperOrder(input: PaperOrderInput) {
    const result = this.orderWriteChain.then(() => this.placePaperOrderSerialized(input));
    this.orderWriteChain = result.catch(() => undefined);
    return result;
  }

  private async placePaperOrderSerialized(input: PaperOrderInput) {
    this.assertPaperWriteReady();
    const existing = await this.findOrderByReference(input.idempotencyKey);
    if (existing) return existing;
    const orderIds = await this.reserveOrderIds(input.side === "BUY" ? 2 : 1);
    return this.sendOrder(orderIds[0]!, input, orderIds[1]);
  }

  async modifyPaperOrder(externalOrderId: string, input: PaperOrderInput) {
    this.assertPaperWriteReady();
    const orderId = this.numericOrderId(externalOrderId);
    return this.sendOrder(orderId, input);
  }

  async cancelPaperOrder(externalOrderId: string) {
    this.assertPaperWriteReady();
    const api = await this.connectedApi();
    const orderId = this.numericOrderId(externalOrderId);
    return this.waitForOrderState(orderId, 0, () => api.cancelOrder(orderId, ""));
  }

  private async sendOrder(orderId: number, input: PaperOrderInput, protectiveStopOrderId?: number) {
    const api = await this.connectedApi();
    const orderType = ({
      LIMIT: OrderType.LMT,
      MARKET: OrderType.MKT,
      STOP: OrderType.STP,
      STOP_LIMIT: OrderType.STP_LMT,
    } as const)[input.orderType];
    const order: Order = {
      account: this.config.expectedPaperAccountId,
      action: input.side === "BUY" ? OrderAction.BUY : OrderAction.SELL,
      allOrNone: !input.allowPartialFill,
      auxPrice: input.stopPrice,
      lmtPrice: input.limitPrice,
      orderId,
      orderRef: input.idempotencyKey,
      orderType,
      outsideRth: input.outsideRth,
      overridePercentageConstraints: false,
      parentId: input.parentOrderId ? this.numericOrderId(input.parentOrderId) : undefined,
      tif: input.timeInForce as Order["tif"],
      totalQuantity: input.quantity,
      transmit: protectiveStopOrderId === undefined,
    };
    const protectiveStop =
      protectiveStopOrderId === undefined
        ? undefined
        : {
            account: this.config.expectedPaperAccountId,
            action: OrderAction.SELL,
            allOrNone: !input.allowPartialFill,
            auxPrice: input.protectiveStopPrice,
            orderId: protectiveStopOrderId,
            orderRef: `${input.idempotencyKey}:PROTECTIVE_STOP`,
            orderType: OrderType.STP,
            outsideRth: false,
            overridePercentageConstraints: false,
            parentId: orderId,
            tif: "GTC" as Order["tif"],
            totalQuantity: input.quantity,
            transmit: true,
          } satisfies Order;
    const contract = this.stockContract(input.symbol, input.contractId);
    return this.waitForOrderState(
      orderId,
      input.quantity,
      () => {
        api.placeOrder(orderId, contract, order);
        if (protectiveStop) api.placeOrder(protectiveStopOrderId!, contract, protectiveStop);
      },
      protectiveStopOrderId === undefined
        ? undefined
        : { orderId: protectiveStopOrderId, price: Number(input.protectiveStopPrice) },
    );
  }

  private async waitForOrderState(
    orderId: number,
    quantity: number,
    action: () => void,
    protectiveStop?: { orderId: number; price: number },
  ) {
    const api = await this.connectedApi();
    return new Promise<PaperOrderState>((resolve, reject) => {
      let parentState: PaperOrderState | undefined;
      let protectiveState: PaperOrderState | undefined;
      const timer = setTimeout(() => finish(undefined, new Error("IBKR Paper 订单状态确认超时，结果未知")), this.config.timeoutMs);
      const finish = (state?: PaperOrderState, error?: Error) => {
        clearTimeout(timer);
        api.off(EventName.orderStatus, onStatus);
        api.off(EventName.openOrder, onOpenOrder);
        api.off(EventName.error, onError);
        if (error) reject(error);
        else if (state) resolve(state);
      };
      const accept = (eventOrderId: number, state: PaperOrderState) => {
        if (eventOrderId === orderId) parentState = state;
        if (protectiveStop && eventOrderId === protectiveStop.orderId) protectiveState = state;
        if (!parentState || (protectiveStop && !protectiveState)) return;
        finish({
          ...parentState,
          protectiveStopExternalOrderId: protectiveState?.externalOrderId,
          protectiveStopPermanentId: protectiveState?.externalPermanentId,
          protectiveStopPrice: protectiveStop?.price,
          protectiveStopStatus: protectiveState?.status,
          protectiveStopQuantity: protectiveState ? protectiveState.filledQuantity + protectiveState.remainingQuantity : undefined,
          rawDataHash: rawHash({ parentState, protectiveState }),
        });
      };
      const onStatus = (
        eventOrderId: number,
        status: unknown,
        filled: number,
        remaining: number,
        averageFillPrice: number,
        permanentId?: number,
        _parentId?: number,
        lastFillPrice?: number,
      ) => {
        if (eventOrderId !== orderId && eventOrderId !== protectiveStop?.orderId) return;
        accept(eventOrderId, {
          averageFillPrice: finite(averageFillPrice) || undefined,
          externalOrderId: String(eventOrderId),
          externalPermanentId: permanentId ? String(permanentId) : undefined,
          filledQuantity: finite(filled),
          lastFillPrice: finite(lastFillPrice) || undefined,
          rawDataHash: rawHash({ averageFillPrice, filled, lastFillPrice, orderId, permanentId, remaining, status }),
          remainingQuantity: finite(remaining, quantity),
          status: normalizeStatus(status),
          updatedAt: new Date().toISOString(),
        });
      };
      const onOpenOrder = (eventOrderId: number, _contract: Contract, order: Order, orderState: OrderState) => {
        if (eventOrderId !== orderId && eventOrderId !== protectiveStop?.orderId) return;
        accept(eventOrderId, {
          externalOrderId: String(eventOrderId),
          externalPermanentId: order.permId ? String(order.permId) : undefined,
          filledQuantity: 0,
          rawDataHash: rawHash({ orderId, orderState, permanentId: order.permId }),
          remainingQuantity: finite(order.totalQuantity, quantity),
          status: normalizeStatus(orderState.status),
          updatedAt: new Date().toISOString(),
        });
      };
      const onError = (...args: unknown[]) => {
        const details = errorDetails(args);
        if (
          NON_FATAL_CODES.has(details.code) ||
          (details.requestId !== orderId && details.requestId !== protectiveStop?.orderId)
        ) {
          return;
        }
        finish(undefined, new Error(`IBKR Paper 拒绝订单（${details.code}）：${details.message}`));
      };
      api.on(EventName.orderStatus, onStatus);
      api.on(EventName.openOrder, onOpenOrder);
      api.on(EventName.error, onError);
      action();
    });
  }

  private async getAccountSnapshot(accountId: string): Promise<AccountSnapshot> {
    const operation = this.accountUpdateChain.then(() => this.collectAccountSnapshot(accountId));
    this.accountUpdateChain = operation.catch(() => undefined);
    return operation;
  }

  private async collectAccountSnapshot(accountId: string): Promise<AccountSnapshot> {
    const api = await this.connectedApi();
    const accountValues: AccountValue[] = [];
    const positions: BrokerPositionRecord[] = [];
    return new Promise<AccountSnapshot>((resolve, reject) => {
      const timer = setTimeout(() => finish(undefined, new Error("IBKR TWS 账户快照超时")), this.config.timeoutMs);
      const finish = (result?: AccountSnapshot, error?: Error) => {
        clearTimeout(timer);
        api.off(EventName.updateAccountValue, onValue);
        api.off(EventName.updatePortfolio, onPosition);
        api.off(EventName.accountDownloadEnd, onEnd);
        api.off(EventName.error, onError);
        api.reqAccountUpdates(false, accountId);
        if (error) reject(error);
        else if (result) resolve(result);
      };
      const onValue = (key: string, value: string, currency: string, accountName: string) => {
        if (accountName === accountId) accountValues.push({ currency, key, value });
      };
      const onPosition = (
        contract: Contract,
        position: number,
        marketPrice: number,
        marketValue: number,
        averageCost?: number,
        unrealizedPnl?: number,
        _realizedPnl?: number,
        accountName?: string,
      ) => {
        if (accountName !== accountId || position === 0) return;
        positions.push({
          averageCost: finite(averageCost),
          currency: contract.currency || "USD",
          externalContractId: String(contract.conId ?? ""),
          marketPrice: finite(marketPrice),
          marketValue: finite(marketValue),
          quantity: finite(position),
          symbol: contract.symbol || contract.localSymbol || "UNKNOWN",
          unrealizedPnl: finite(unrealizedPnl),
        });
      };
      const onEnd = (finishedAccount: string) => {
        if (finishedAccount === accountId) finish({ accountValues, positions });
      };
      const onError = (...args: unknown[]) => this.rejectRequest(args, -1, (error) => error && finish(undefined, error));
      api.on(EventName.updateAccountValue, onValue);
      api.on(EventName.updatePortfolio, onPosition);
      api.on(EventName.accountDownloadEnd, onEnd);
      api.on(EventName.error, onError);
      api.reqAccountUpdates(true, accountId);
    });
  }

  private async getOpenOrderRows() {
    const api = await this.connectedApi();
    const rows: TwsOrderRow[] = [];
    const statuses = new Map<number, { averageFillPrice: number; filled: number; remaining: number; status: unknown }>();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("IBKR TWS 活动订单查询超时")), this.config.timeoutMs);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        api.off(EventName.openOrder, onOrder);
        api.off(EventName.orderStatus, onStatus);
        api.off(EventName.openOrderEnd, onEnd);
        api.off(EventName.error, onError);
        if (error) reject(error);
        else resolve();
      };
      const onOrder = (orderId: number, contract: Contract, order: Order, orderState: OrderState) => {
        const status = statuses.get(orderId);
        rows.push(this.toOrderRow(orderId, contract, order, orderState, status));
      };
      const onStatus = (orderId: number, status: unknown, filled: number, remaining: number, averageFillPrice: number) => {
        statuses.set(orderId, { averageFillPrice, filled, remaining, status });
      };
      const onEnd = () => finish();
      const onError = (...args: unknown[]) => this.rejectRequest(args, -1, finish);
      api.on(EventName.openOrder, onOrder);
      api.on(EventName.orderStatus, onStatus);
      api.once(EventName.openOrderEnd, onEnd);
      api.on(EventName.error, onError);
      // reqOpenOrders 可能把订单绑定到当前客户端，Gateway 会把只读快照误判为订单管理请求。
      // reqAllOpenOrders 只返回跨客户端快照而不绑定订单，更适合这条只读同步路径。
      api.reqAllOpenOrders();
    });
    return rows.map((row) => {
      const status = statuses.get(Number(row.broker.externalOrderId));
      return status
        ? {
            ...row,
            broker: {
              ...row.broker,
              averageFillPrice: finite(status.averageFillPrice) || row.broker.averageFillPrice,
              filledQuantity: finite(status.filled),
              status: normalizeStatus(status.status),
            },
          }
        : row;
    });
  }

  private async getCompletedOrderRows() {
    const api = await this.connectedApi();
    const rows: TwsOrderRow[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("IBKR TWS 完成订单查询超时")), this.config.timeoutMs);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        api.off(EventName.completedOrder, onOrder);
        api.off(EventName.completedOrdersEnd, onEnd);
        api.off(EventName.error, onError);
        if (error) reject(error);
        else resolve();
      };
      const onOrder = (contract: Contract, order: Order, orderState: OrderState) => {
        rows.push(this.toOrderRow(order.orderId ?? 0, contract, order, orderState));
      };
      const onEnd = () => finish();
      const onError = (...args: unknown[]) => this.rejectRequest(args, -1, finish);
      api.on(EventName.completedOrder, onOrder);
      api.once(EventName.completedOrdersEnd, onEnd);
      api.on(EventName.error, onError);
      api.reqCompletedOrders(true);
    });
    return rows;
  }

  private toOrderRow(
    orderId: number,
    contract: Contract,
    order: Order,
    orderState: OrderState,
    liveStatus?: { averageFillPrice: number; filled: number; remaining: number; status: unknown },
  ): TwsOrderRow {
    const quantity = finite(order.totalQuantity);
    return {
      broker: {
        averageFillPrice: finite(liveStatus?.averageFillPrice) || undefined,
        currency: contract.currency || "USD",
        externalOrderId: String(orderId),
        externalPermanentId: order.permId ? String(order.permId) : undefined,
        orderReference: order.orderRef || undefined,
        filledQuantity: finite(liveStatus?.filled ?? order.filledQuantity),
        limitPrice: finite(order.lmtPrice) || undefined,
        orderTime: new Date().toISOString(),
        orderType: String(order.orderType ?? "UNKNOWN"),
        quantity,
        side: side(order.action),
        status: normalizeStatus(liveStatus?.status ?? orderState.status),
        stopPrice: finite(order.auxPrice) || undefined,
        symbol: contract.symbol || contract.localSymbol || "UNKNOWN",
      },
      orderRef: order.orderRef || "",
      parentId: finite(order.parentId) || undefined,
      permanentId: order.permId ? String(order.permId) : undefined,
    };
  }

  private orderRowState(row: TwsOrderRow, protective?: TwsOrderRow): PaperOrderState {
    return {
      averageFillPrice: row.broker.averageFillPrice,
      externalOrderId: row.broker.externalOrderId,
      externalPermanentId: row.permanentId,
      filledQuantity: row.broker.filledQuantity,
      rawDataHash: rawHash(row),
      remainingQuantity: Math.max(0, row.broker.quantity - row.broker.filledQuantity),
      status: row.broker.status,
      protectiveStopExternalOrderId: protective?.broker.externalOrderId,
      protectiveStopPermanentId: protective?.permanentId,
      protectiveStopPrice: protective?.broker.stopPrice,
      protectiveStopStatus: protective?.broker.status,
      protectiveStopQuantity: protective?.broker.quantity,
      updatedAt: row.broker.orderTime,
    };
  }

  private protectiveRow(rows: TwsOrderRow[], parent: TwsOrderRow) {
    const parentId = Number(parent.broker.externalOrderId);
    return rows.find(
      (row) =>
        row.parentId === parentId ||
        (parent.orderRef && row.orderRef === `${parent.orderRef}:PROTECTIVE_STOP`),
    );
  }

  private async reserveOrderIds(count: number) {
    const api = await this.connectedApi();
    if (this.nextOrderId === null) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error("IBKR TWS 未返回有效订单序号")), this.config.timeoutMs);
        const finish = (error?: Error) => {
          clearTimeout(timer);
          api.off(EventName.nextValidId, onId);
          if (error) reject(error);
          else resolve();
        };
        const onId = (orderId: number) => {
          this.nextOrderId = orderId;
          finish();
        };
        api.once(EventName.nextValidId, onId);
        api.reqIds();
      });
    }
    const reserved = this.nextOrderId!;
    this.nextOrderId = reserved + count;
    return Array.from({ length: count }, (_, index) => reserved + index);
  }

  private stockContract(symbol: string, contractId: string): Contract {
    if (!/^\d{1,20}$/.test(contractId)) throw new Error("IBKR contractId 格式无效");
    return {
      conId: Number(contractId),
      currency: "USD",
      exchange: "SMART",
      secType: SecType.STK,
      symbol,
    };
  }

  private numericOrderId(externalOrderId: string) {
    if (!/^\d{1,18}$/.test(externalOrderId)) throw new Error("IBKR Paper 订单 ID 格式无效");
    return Number(externalOrderId);
  }

  private assertPaperAccounts(accounts: string[]) {
    if (!accounts.length) throw new Error("IBKR TWS 未返回账户");
    if (accounts.some((account) => !isPaperAccount(account))) {
      throw new Error("PAPER_ENVIRONMENT_MISMATCH：TWS Socket 返回了非 DU 模拟账户");
    }
    if (
      this.config.expectedPaperAccountId &&
      (accounts.length !== 1 || accounts[0]?.toUpperCase() !== this.config.expectedPaperAccountId)
    ) {
      throw new Error("PAPER_ENVIRONMENT_MISMATCH：实际 Paper 账户与配置不一致");
    }
  }

  private assertConfiguredAccount(accountId: string) {
    const normalized = accountId.trim().toUpperCase();
    if (!isPaperAccount(normalized) || !this.managedAccounts.includes(normalized)) {
      throw new Error("PAPER_ENVIRONMENT_MISMATCH：请求账户不是当前 TWS 模拟账户");
    }
    if (this.config.expectedPaperAccountId && normalized !== this.config.expectedPaperAccountId) {
      throw new Error("PAPER_ENVIRONMENT_MISMATCH：请求账户与配置不一致");
    }
  }

  private assertPaperWriteReady() {
    if (!this.canWritePaperOrders) throw new Error("IBKR TWS Socket 当前为只读，Paper 写能力未启用");
    this.assertConfiguredAccount(this.config.expectedPaperAccountId);
  }

  private async connectedApi() {
    await this.connect();
    if (!this.api?.isConnected) throw new Error("IBKR TWS Socket 未连接");
    return this.api;
  }

  private nextRequestId() {
    this.requestId += 1;
    return this.requestId;
  }

  private rejectRequest(args: unknown[], requestId: number, finish: (error?: Error) => void) {
    const details = errorDetails(args);
    if (NON_FATAL_CODES.has(details.code)) return;
    if (requestId >= 0 && details.requestId !== requestId) return;
    if (requestId < 0 && details.requestId >= 0) return;
    finish(new Error(`IBKR TWS API 错误（${details.code}）：${this.redactAccounts(details.message)}`));
  }

  private redactAccounts(message: string) {
    return this.managedAccounts.reduce((result, account) => result.replaceAll(account, "[REDACTED_ACCOUNT]"), message);
  }
}

let sharedClient: IbkrTwsSocketClient | null = null;
let sharedKey = "";

export function sharedTwsSocketClient() {
  const config = twsSocketConfigFromProcess();
  const key = JSON.stringify(config);
  if (!sharedClient || key !== sharedKey) {
    sharedClient = new IbkrTwsSocketClient(config);
    sharedKey = key;
  }
  return sharedClient;
}
