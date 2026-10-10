import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { Prisma, type BrokerConnection } from "@prisma/client";

import { toNumber } from "../../common/decimal";
import { PrismaService } from "../../prisma/prisma.service";
import { RiskService } from "../risk/risk.service";
import {
  BrokerConnectorClient,
  type ConnectorAccount,
  type ConnectorCash,
  type ConnectorCorporateAction,
  type ConnectorExecution,
  type ConnectorOrder,
  type ConnectorPosition,
  type ConnectorSummary,
  type ConnectorTransaction,
} from "./broker-connector.client";
import type {
  CreateShadowIntentDto,
  ReconciliationDecisionDto,
  RunBrokerSyncDto,
  RunReconciliationDto,
  UpdateBrokerSettingsDto,
} from "./broker-sync.dto";
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
  type ReconciliationDifferenceInput,
} from "./broker-sync.rules";

type AccountBundle = {
  account: ConnectorAccount;
  cash: ConnectorCash[];
  completedOrders: ConnectorOrder[];
  corporateActions: ConnectorCorporateAction[];
  executions: ConnectorExecution[];
  openOrders: ConnectorOrder[];
  positions: ConnectorPosition[];
  summary: ConnectorSummary;
  transactions: ConnectorTransaction[];
};

const CONNECTION_ID = "broker-connection-ibkr-readonly";
const READ_ONLY_CAPABILITIES = {
  canCancelOrders: false,
  canModifyOrders: false,
  canPlaceOrders: false,
  canReadAccounts: true,
  canReadExecutions: true,
  canReadOrders: true,
  canReadPositions: true,
} as const;

@Injectable()
export class BrokerSyncService {
  private readonly logger = new Logger(BrokerSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connector: BrokerConnectorClient,
    private readonly risk: RiskService,
    private readonly config: ConfigService,
  ) {}

  async dashboard() {
    const connection = await this.ensureConnection();
    const [accounts, syncJobs, reconciliationRuns, shadowSessions, auditLogs, readiness, control] =
      await Promise.all([
        this.prisma.brokerAccount.findMany({
          include: {
            cashBalances: { orderBy: { snapshotTime: "desc" }, take: 8 },
            positionSnapshots: { orderBy: { snapshotTime: "desc" }, take: 30 },
            snapshots: { orderBy: { snapshotTime: "desc" }, take: 1 },
          },
          orderBy: { createdAt: "asc" },
        }),
        this.prisma.brokerSyncJob.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
        this.prisma.accountReconciliationRun.findMany({
          include: {
            decisions: { orderBy: { createdAt: "desc" }, take: 20 },
            differences: { orderBy: [{ severity: "desc" }, { createdAt: "desc" }] },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
        this.prisma.shadowTradingSession.findMany({
          include: {
            fills: { orderBy: { fillTime: "desc" }, take: 20 },
            orderIntents: { orderBy: { createdAt: "desc" }, take: 30 },
            performance: { orderBy: { snapshotTime: "desc" }, take: 20 },
            signals: { orderBy: { signalDate: "desc" }, take: 30 },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
        this.prisma.brokerAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: 80 }),
        this.readiness(),
        this.prisma.paperTradingControl.findUnique({ where: { id: "global" } }),
      ]);
    const now = Date.now();
    return {
      accounts: accounts.map((account) => {
        const latest = account.snapshots[0];
        const stale =
          !account.lastSyncedAt ||
          now - account.lastSyncedAt.getTime() > connection.staleAfterSeconds * 1_000;
        return {
          accountType: account.accountType,
          baseCurrency: account.baseCurrency,
          cashBalances: account.cashBalances.map((cash) => ({
            ...cash,
            availableCash: toNumber(cash.availableCash),
            settledCash: toNumber(cash.settledCash),
            totalCash: toNumber(cash.totalCash),
          })),
          id: account.id,
          lastSyncedAt: account.lastSyncedAt,
          localAccountId: account.localAccountId,
          maskedAccountNumber: account.maskedAccountNumber,
          positionSnapshots: account.positionSnapshots.map((position) => ({
            ...position,
            averageCost: toNumber(position.averageCost),
            marketPrice: toNumber(position.marketPrice),
            marketValue: toNumber(position.marketValue),
            quantity: toNumber(position.quantity),
            unrealizedPnl: toNumber(position.unrealizedPnl),
          })),
          snapshot: latest
            ? {
                ...latest,
                availableFunds: toNumber(latest.availableFunds),
                buyingPower: toNumber(latest.buyingPower),
                grossPositionValue: toNumber(latest.grossPositionValue),
                netLiquidation: toNumber(latest.netLiquidation),
                realizedPnl: toNumber(latest.realizedPnl),
                settledCash: toNumber(latest.settledCash),
                totalCash: toNumber(latest.totalCash),
                unrealizedPnl: toNumber(latest.unrealizedPnl),
              }
            : null,
          stale,
          status: stale ? "STALE" : account.status,
        };
      }),
      auditLogs,
      connection: this.serializeConnection(connection),
      control: {
        killSwitchEnabled: control?.killSwitchEnabled ?? false,
        reason: control?.reason ?? null,
      },
      disclaimers: {
        brokerWrites: "Broker Connector 只读；系统不存在任何券商下单、改单或撤单接口。",
        opportunityPnl: "机会损益仅为历史模拟结果，不代表真实可获得收益。",
        readiness: "本系统当前不具备实盘自动下单能力。",
      },
      readiness,
      reconciliationRuns: reconciliationRuns.map((run) => ({
        ...run,
        differences: run.differences.map((difference) => ({
          ...difference,
          absoluteDifference:
            difference.absoluteDifference === null ? null : toNumber(difference.absoluteDifference),
          percentageDifference:
            difference.percentageDifference === null
              ? null
              : toNumber(difference.percentageDifference),
        })),
      })),
      safeguards: {
        brokerConnectorHasWriteMethods: false,
        capabilities: READ_ONLY_CAPABILITIES,
        localAccountOverwriteRequiresDecision: true,
        paperIsolation: true,
        shadowIsolation: true,
      },
      shadowSessions: shadowSessions.map((session) => ({
        ...session,
        currentCash: toNumber(session.currentCash),
        currentEquity: toNumber(session.currentEquity),
        fills: session.fills.map((fill) => ({
          ...fill,
          commission: toNumber(fill.commission),
          fillPrice: toNumber(fill.fillPrice),
          quantity: toNumber(fill.quantity),
          slippage: toNumber(fill.slippage),
        })),
        initialCash: toNumber(session.initialCash),
        initialEquity: toNumber(session.initialEquity),
        orderIntents: session.orderIntents.map((intent) => ({
          ...intent,
          quantity: toNumber(intent.quantity),
          theoreticalPrice: toNumber(intent.theoreticalPrice),
        })),
        performance: session.performance.map((item) => ({
          ...item,
          cashBalance: toNumber(item.cashBalance),
          maxDrawdown: toNumber(item.maxDrawdown),
          opportunityPnl: item.opportunityPnl === null ? null : toNumber(item.opportunityPnl),
          realizedPnl: toNumber(item.realizedPnl),
          totalEquity: toNumber(item.totalEquity),
          totalReturn: toNumber(item.totalReturn),
          unrealizedPnl: toNumber(item.unrealizedPnl),
        })),
        signals: session.signals.map((signal) => ({
          ...signal,
          quantity: toNumber(signal.quantity),
          referencePrice: toNumber(signal.referencePrice),
        })),
      })),
      syncJobs,
    };
  }

  async connectionStatus() {
    const connection = await this.ensureConnection();
    try {
      // IB Gateway 的单个 Socket 会话串行处理请求；并发探测会互相等待并造成误报离线。
      const health = await this.connector.health();
      const remote = await this.connector.connection();
      const capabilities = await this.connector.capabilities();
      this.assertReadonlyCapabilities(capabilities);
      const status = health.status === "OK" && remote.connected ? "CONNECTED" : health.status;
      const updated = await this.prisma.brokerConnection.update({
        where: { id: connection.id },
        data: {
          capabilitiesJson: JSON.stringify(capabilities),
          lastConnectedAt: remote.connected
            ? new Date(remote.updatedAt)
            : connection.lastConnectedAt,
          lastErrorAt: status === "OK" || status === "CONNECTED" ? null : new Date(),
          lastErrorMessage:
            status === "OK" || status === "CONNECTED" ? null : this.safeMessage(health.message),
          lastHeartbeatAt: new Date(health.checkedAt),
          status,
        },
      });
      if (status === "CONNECTED" && connection.status !== "CONNECTED") {
        await this.notify(
          "BROKER_CONNECTION_RESTORED",
          "INFO",
          "IBKR 只读连接已恢复",
          "Broker Connector 只读心跳已恢复；系统仍不具备任何券商写能力。",
          `BROKER_CONNECTION_RESTORED:${new Date().toISOString().slice(0, 13)}`,
        );
      } else if (status !== "CONNECTED" && connection.status === "CONNECTED") {
        await this.notify(
          "BROKER_CONNECTION_LOST",
          "CRITICAL",
          "IBKR 只读连接中断",
          "Broker Connector 已中断；旧数据保留并标记过期，影子任务将安全跳过。",
          `BROKER_CONNECTION_LOST:${new Date().toISOString().slice(0, 13)}`,
        );
      }
      return { ...this.serializeConnection(updated), health, remote };
    } catch (error) {
      const message = this.safeMessage(error instanceof Error ? error.message : "连接失败");
      const updated = await this.prisma.brokerConnection.update({
        where: { id: connection.id },
        data: { lastErrorAt: new Date(), lastErrorMessage: message, status: "OFFLINE" },
      });
      await this.notify(
        "BROKER_CONNECTOR_UNAVAILABLE",
        "CRITICAL",
        "Broker Connector 不可用",
        `${message}；本地风控和历史数据不受影响。`,
        `BROKER_CONNECTOR_UNAVAILABLE:${new Date().toISOString().slice(0, 13)}`,
      );
      return {
        ...this.serializeConnection(updated),
        health: { message, status: "OFFLINE" },
        remote: { authenticated: false, connected: false },
      };
    }
  }

  async updateSettings(dto: UpdateBrokerSettingsDto) {
    if (!dto.acknowledgeNoBrokerWrites) {
      throw new BadRequestException("必须确认系统不存在任何券商写操作能力");
    }
    if (dto.runMode?.includes("TRADING") || dto.runMode?.includes("AUTO")) {
      throw new BadRequestException("禁止配置自动实盘模式");
    }
    const connection = await this.ensureConnection();
    const updated = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.brokerConnection.update({
        where: { id: connection.id },
        data: {
          autoReconciliation: dto.autoReconciliation,
          enabled: dto.enabled,
          runMode: dto.runMode,
          safetyState: dto.safetyState,
          shadowTradingEnabled: dto.shadowTradingEnabled,
          staleAfterSeconds: dto.staleAfterSeconds,
        },
      });
      await transaction.brokerAuditLog.create({
        data: {
          actorId: dto.operatorId,
          brokerConnectionId: connection.id,
          detailsJson: JSON.stringify({
            after: this.serializeConnection(result),
            before: this.serializeConnection(connection),
            reason: dto.reason,
          }),
          eventType:
            dto.safetyState === "LOCKDOWN" ? "LOCKDOWN_ENABLED" : "BROKER_SETTINGS_UPDATED",
          message: `运行模式或安全状态由 ${dto.operatorId} 人工更新`,
          severity: dto.safetyState === "LOCKDOWN" ? "CRITICAL" : "WARNING",
        },
      });
      return result;
    });
    return this.serializeConnection(updated);
  }

  async runSync(dto: RunBrokerSyncDto) {
    const connection = await this.ensureConnection();
    const to = dto.to ?? new Date().toISOString();
    const from = dto.from ?? new Date(Date.parse(to) - 30 * 86_400_000).toISOString();
    if (Date.parse(from) > Date.parse(to)) {
      throw new BadRequestException("同步开始时间不得晚于结束时间");
    }
    const minuteRange = `${from.slice(0, 16)}:${to.slice(0, 16)}`;
    const idempotencyKey =
      dto.idempotencyKey ?? brokerSyncKey(connection.id, minuteRange, "MANUAL");
    const existing = await this.prisma.brokerSyncJob.findUnique({ where: { idempotencyKey } });
    if (existing) return { ...existing, idempotent: true };
    const job = await this.prisma.brokerSyncJob.create({
      data: {
        brokerConnectionId: connection.id,
        idempotencyKey,
        requestedFrom: new Date(from),
        requestedTo: new Date(to),
        status: "PENDING",
      },
    });
    return this.executeSync(job.id);
  }

  @Cron("0 15 23 * * 1-5", { timeZone: "America/New_York" })
  async scheduledReadonlySync() {
    if (process.env.PUBLIC_DEMO_READ_ONLY === "true") return;
    const connection = await this.ensureConnection();
    if (!connection.enabled || !["SHADOW", "READ_ONLY_LIVE"].includes(connection.runMode)) return;
    try {
      await this.runSync({});
    } catch (error) {
      this.logger.error(
        this.safeMessage(error instanceof Error ? error.message : "定时只读同步失败"),
      );
    }
  }

  async retrySync(id: string) {
    const job = await this.prisma.brokerSyncJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException("同步任务不存在");
    if (job.status !== "FAILED") throw new BadRequestException("只有失败任务可以重试");
    await this.prisma.brokerSyncJob.update({
      where: { id },
      data: {
        completedAt: null,
        errorMessage: null,
        retryCount: { increment: 1 },
        status: "PENDING",
      },
    });
    return this.executeSync(id);
  }

  async cancelPendingSync(id: string) {
    const job = await this.prisma.brokerSyncJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException("同步任务不存在");
    if (job.status !== "PENDING") throw new BadRequestException("只能取消尚未开始的同步任务");
    return this.prisma.brokerSyncJob.update({
      where: { id },
      data: { completedAt: new Date(), status: "CANCELLED" },
    });
  }

  async reconcile(dto: RunReconciliationDto) {
    const brokerAccount = await this.prisma.brokerAccount.findUnique({
      where: { id: dto.brokerAccountId },
    });
    if (!brokerAccount?.localAccountId) {
      throw new BadRequestException("券商账户尚未与本地账户匹配");
    }
    const [snapshot, latestPosition, localAccount] = await Promise.all([
      this.prisma.brokerAccountSnapshot.findFirst({
        where: { brokerAccountId: brokerAccount.id },
        orderBy: { snapshotTime: "desc" },
      }),
      this.prisma.brokerPositionSnapshot.findFirst({
        where: { brokerAccountId: brokerAccount.id },
        orderBy: { snapshotTime: "desc" },
      }),
      this.prisma.account.findUnique({
        where: { id: brokerAccount.localAccountId },
        include: { positions: { include: { instrument: true } } },
      }),
    ]);
    if (!snapshot || !localAccount) throw new BadRequestException("缺少可对账的账户快照");
    const brokerPositions = latestPosition
      ? await this.prisma.brokerPositionSnapshot.findMany({
          where: { brokerAccountId: brokerAccount.id, snapshotTime: latestPosition.snapshotTime },
        })
      : [];
    const tolerance = {
      amountAbsolute: dto.amountAbsolute ?? DEFAULT_RECONCILIATION_TOLERANCE.amountAbsolute,
      percentage: dto.percentage ?? DEFAULT_RECONCILIATION_TOLERANCE.percentage,
      priceAbsolute: dto.priceAbsolute ?? DEFAULT_RECONCILIATION_TOLERANCE.priceAbsolute,
      quantityAbsolute: dto.quantityAbsolute ?? DEFAULT_RECONCILIATION_TOLERANCE.quantityAbsolute,
    };
    const localUnrealized = localAccount.positions.reduce(
      (sum, position) =>
        sum +
        (toNumber(position.currentPrice) - toNumber(position.avgCost)) *
          toNumber(position.quantity),
      0,
    );
    const differences: ReconciliationDifferenceInput[] = [];
    for (const input of [
      {
        broker: toNumber(snapshot.netLiquidation),
        fieldName: "totalEquity",
        local: toNumber(localAccount.totalEquity),
        toleranceKind: "AMOUNT" as const,
        type: "EQUITY_MISMATCH",
      },
      {
        broker: toNumber(snapshot.totalCash),
        fieldName: "cashBalance",
        local: toNumber(localAccount.cashBalance),
        toleranceKind: "AMOUNT" as const,
        type: "CASH_MISMATCH",
      },
      {
        broker: toNumber(snapshot.realizedPnl),
        fieldName: "realizedPnlYtd",
        local: toNumber(localAccount.realizedPnlYtd),
        toleranceKind: "AMOUNT" as const,
        type: "REALIZED_PNL_MISMATCH",
      },
      {
        broker: toNumber(snapshot.unrealizedPnl),
        fieldName: "unrealizedPnl",
        local: localUnrealized,
        toleranceKind: "AMOUNT" as const,
        type: "UNREALIZED_PNL_MISMATCH",
      },
    ]) {
      const difference = reconciliationDifference(input, tolerance);
      if (difference) differences.push(difference);
    }
    const localBySymbol = new Map(
      localAccount.positions.map((position) => [position.instrument.symbol, position]),
    );
    const brokerBySymbol = new Map(brokerPositions.map((position) => [position.symbol, position]));
    for (const position of brokerPositions) {
      const local = localBySymbol.get(position.symbol);
      if (!local) {
        differences.push({
          absoluteDifference: Math.abs(toNumber(position.quantity)),
          brokerValue: String(toNumber(position.quantity)),
          differenceType: "MISSING_LOCAL_POSITION",
          fieldName: "quantity",
          localValue: "0",
          percentageDifference: 100,
          severity: "CRITICAL",
          suggestedAction: "人工确认缺失成交、拆分或公司行动后再创建调整流水。",
          symbol: position.symbol,
        });
        continue;
      }
      for (const input of [
        {
          broker: toNumber(position.quantity),
          fieldName: "quantity",
          local: toNumber(local.quantity),
          symbol: position.symbol,
          toleranceKind: "QUANTITY" as const,
          type: "QUANTITY_MISMATCH",
        },
        {
          broker: toNumber(position.averageCost),
          fieldName: "avgCost",
          local: toNumber(local.avgCost),
          symbol: position.symbol,
          toleranceKind: "PRICE" as const,
          type: "AVERAGE_COST_MISMATCH",
        },
      ]) {
        const difference = reconciliationDifference(input, tolerance);
        if (difference) differences.push(difference);
      }
    }
    for (const position of localAccount.positions) {
      if (brokerBySymbol.has(position.instrument.symbol)) continue;
      differences.push({
        absoluteDifference: Math.abs(toNumber(position.quantity)),
        brokerValue: "0",
        differenceType: "MISSING_BROKER_POSITION",
        fieldName: "quantity",
        localValue: String(toNumber(position.quantity)),
        percentageDifference: 100,
        severity: "CRITICAL",
        suggestedAction: "人工确认本地交易、转仓或公司行动，不得自动删除本地持仓。",
        symbol: position.instrument.symbol,
      });
    }
    const critical = differences.filter((item) => item.severity === "CRITICAL").length;
    const run = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.accountReconciliationRun.create({
        data: {
          brokerAccountId: brokerAccount.id,
          brokerSnapshotTime: snapshot.snapshotTime,
          completedAt: new Date(),
          criticalDifferenceCount: critical,
          differenceCount: differences.length,
          localAccountId: localAccount.id,
          localSnapshotTime: localAccount.updatedAt,
          startedAt: new Date(),
          status: differences.length === 0 ? "MATCHED" : "DIFFERENCES_FOUND",
          summaryJson: JSON.stringify({ tolerance, total: differences.length, critical }),
        },
      });
      if (differences.length > 0) {
        await transaction.accountReconciliationDifference.createMany({
          data: differences.map((item) => ({
            absoluteDifference: item.absoluteDifference,
            brokerValue: item.brokerValue,
            differenceType: item.differenceType,
            fieldName: item.fieldName,
            localValue: item.localValue,
            percentageDifference: item.percentageDifference,
            reconciliationRunId: created.id,
            severity: item.severity,
            suggestedAction: item.suggestedAction,
            symbol: item.symbol,
          })),
        });
      }
      await transaction.brokerAuditLog.create({
        data: {
          brokerAccountId: brokerAccount.id,
          brokerConnectionId: brokerAccount.brokerConnectionId,
          detailsJson: JSON.stringify({ critical, differenceCount: differences.length, tolerance }),
          eventType: "ACCOUNT_RECONCILIATION_COMPLETED",
          message: `账户对账完成：${differences.length} 项差异，${critical} 项严重差异`,
          reconciliationRunId: created.id,
          severity: critical > 0 ? "CRITICAL" : differences.length > 0 ? "WARNING" : "INFO",
        },
      });
      return created;
    });
    if (differences.length > 0) {
      await this.notify(
        critical > 0 ? "CRITICAL_RECONCILIATION_DIFFERENCE" : "RECONCILIATION_DIFFERENCE",
        critical > 0 ? "CRITICAL" : "WARNING",
        critical > 0 ? "发现严重账户对账差异" : "账户对账存在差异",
        `券商账户 ${brokerAccount.maskedAccountNumber} 存在 ${differences.length} 项差异，未经人工确认不会覆盖本地数据。`,
        `RECONCILIATION:${run.id}`,
      );
    }
    return this.prisma.accountReconciliationRun.findUnique({
      where: { id: run.id },
      include: { differences: true },
    });
  }

  async decideDifference(id: string, dto: ReconciliationDecisionDto) {
    const difference = await this.prisma.accountReconciliationDifference.findUnique({
      where: { id },
      include: { reconciliationRun: { include: { brokerAccount: true } } },
    });
    if (!difference) throw new NotFoundException("对账差异不存在");
    if (difference.status !== "OPEN") throw new BadRequestException("该差异已经处理");
    const acceptedValue =
      dto.acceptedNumericValue ??
      Number(dto.decision === "CONFIRMED_BROKER" ? difference.brokerValue : difference.localValue);
    const result = await this.prisma.$transaction(async (transaction) => {
      const decision = await transaction.reconciliationDecision.create({
        data: {
          acceptedValue: Number.isFinite(acceptedValue) ? String(acceptedValue) : null,
          adjustmentJson: JSON.stringify({
            acceptedNumericValue: dto.acceptedNumericValue ?? null,
            differenceType: difference.differenceType,
            fieldName: difference.fieldName,
            symbol: difference.symbol,
          }),
          decision: dto.decision,
          operatorId: dto.operatorId,
          originalValue: difference.localValue,
          reason: dto.reason,
          reconciliationDifferenceId: difference.id,
          reconciliationRunId: difference.reconciliationRunId,
        },
      });
      if (["CONFIRMED_BROKER", "MANUALLY_ADJUSTED"].includes(dto.decision)) {
        if (!Number.isFinite(acceptedValue)) throw new BadRequestException("接受值不是有效数字");
        await this.applyConfirmedAdjustment(transaction, difference, acceptedValue);
      }
      await transaction.accountReconciliationDifference.update({
        where: { id },
        data: { resolvedAt: new Date(), status: dto.decision },
      });
      await transaction.brokerAuditLog.create({
        data: {
          actorId: dto.operatorId,
          brokerAccountId: difference.reconciliationRun.brokerAccountId,
          brokerConnectionId: difference.reconciliationRun.brokerAccount.brokerConnectionId,
          detailsJson: JSON.stringify({
            acceptedValue: Number.isFinite(acceptedValue) ? acceptedValue : null,
            decision: dto.decision,
            differenceId: difference.id,
            originalValue: difference.localValue,
            reason: dto.reason,
          }),
          eventType: "RECONCILIATION_DECISION_RECORDED",
          message: `人工处理对账差异：${difference.differenceType}`,
          reconciliationRunId: difference.reconciliationRunId,
          severity: "WARNING",
        },
      });
      await this.risk.evaluateAndPersistInTransaction(
        transaction,
        difference.reconciliationRun.localAccountId,
      );
      const open = await transaction.accountReconciliationDifference.count({
        where: { reconciliationRunId: difference.reconciliationRunId, status: "OPEN" },
      });
      if (open === 0) {
        await transaction.accountReconciliationRun.update({
          where: { id: difference.reconciliationRunId },
          data: { status: "RESOLVED" },
        });
      }
      return decision;
    });
    return { ...result, riskRecalculated: true };
  }

  async createShadowIntent(dto: CreateShadowIntentDto) {
    const connection = await this.ensureConnection();
    const brokerAccount = await this.prisma.brokerAccount.findUnique({
      where: { id: dto.brokerAccountId },
      include: { snapshots: { orderBy: { snapshotTime: "desc" }, take: 1 } },
    });
    if (!brokerAccount?.localAccountId || !brokerAccount.snapshots[0]) {
      throw new BadRequestException("影子交易缺少已匹配的最新券商账户快照");
    }
    const control = await this.prisma.paperTradingControl.findUnique({ where: { id: "global" } });
    let connectorAvailable = false;
    try {
      connectorAvailable = (await this.connector.health()).status === "OK";
    } catch {
      connectorAvailable = false;
    }
    const snapshot = brokerAccount.snapshots[0];
    const brokerDataIsFresh =
      Date.now() - snapshot.snapshotTime.getTime() <= connection.staleAfterSeconds * 1_000;
    const taskGate = shadowTaskAllowed({
      brokerDataIsFresh,
      connectorAvailable,
      killSwitchEnabled: control?.killSwitchEnabled ?? false,
      safetyState: connection.safetyState,
      shadowTradingEnabled: connection.shadowTradingEnabled,
    });
    if (!taskGate.allowed) {
      await this.prisma.brokerAuditLog.create({
        data: {
          brokerAccountId: brokerAccount.id,
          brokerConnectionId: connection.id,
          detailsJson: JSON.stringify({ reason: taskGate.reason, symbol: dto.symbol }),
          eventType: "SHADOW_TASK_SKIPPED",
          message: `影子任务安全跳过：${taskGate.reason}`,
          severity: "WARNING",
        },
      });
      const notificationType =
        taskGate.reason === "BROKER_DATA_STALE"
          ? "BROKER_DATA_STALE"
          : taskGate.reason === "CONNECTOR_UNAVAILABLE"
            ? "BROKER_CONNECTOR_UNAVAILABLE"
            : "SHADOW_SIGNAL_REJECTED";
      await this.notify(
        notificationType,
        taskGate.reason === "BROKER_DATA_STALE" ? "WARNING" : "DANGER",
        "影子任务已安全跳过",
        `${dto.symbol.toUpperCase()}：${taskGate.reason}；未生成任何券商请求。`,
        `${notificationType}:${brokerAccount.id}:${dto.signalDate.slice(0, 10)}`,
      );
      return { reason: taskGate.reason, skipped: true };
    }
    const marketDate = dto.signalDate.slice(0, 10);
    const intentKey = shadowIntentKey({
      brokerAccountId: brokerAccount.id,
      marketDate,
      side: dto.side,
      strategyId: dto.strategyId,
      symbol: dto.symbol.toUpperCase(),
    });
    const existing = await this.prisma.shadowOrderIntent.findUnique({
      where: { idempotencyKey: intentKey },
    });
    if (existing) return { ...existing, idempotent: true };
    const [summary, instrument, portfolio] = await Promise.all([
      this.risk.getSummary(brokerAccount.localAccountId),
      this.prisma.instrument.findUnique({ where: { symbol: dto.symbol.toUpperCase() } }),
      dto.portfolioId
        ? this.prisma.strategyPortfolio.findUnique({ where: { id: dto.portfolioId } })
        : Promise.resolve(null),
    ]);
    if (!instrument) throw new BadRequestException("影子信号标的未映射，已拒绝生成订单意图");
    const portfolioAllows = !dto.portfolioId || portfolio?.status === "PAPER_RUNNING";
    const decision = shadowRiskDecision({
      assetType: instrument.assetType,
      existingLeveragedPercent: summary.leveragedEtfPercent,
      overallRiskLevel: summary.overallRiskLevel,
      portfolioAllows,
      side: dto.side,
    });
    const sessionKey = `SHADOW_SESSION:${intentKey}`;
    const created = await this.prisma.$transaction(async (transaction) => {
      const session = await transaction.shadowTradingSession.create({
        data: {
          brokerAccountId: brokerAccount.id,
          brokerSnapshotTime: snapshot.snapshotTime,
          currentCash: snapshot.totalCash,
          currentEquity: snapshot.netLiquidation,
          idempotencyKey: sessionKey,
          initialCash: snapshot.totalCash,
          initialEquity: snapshot.netLiquidation,
          localAccountId: brokerAccount.localAccountId!,
          portfolioId: dto.portfolioId,
          startedAt: new Date(dto.signalDate),
          status: decision.approved ? "OBSERVING" : "RISK_REJECTED",
          strategyId: dto.strategyId,
        },
      });
      const signal = await transaction.shadowSignal.create({
        data: {
          idempotencyKey: `SHADOW_SIGNAL:${intentKey}`,
          quantity: dto.quantity,
          referencePrice: dto.theoreticalPrice,
          riskDecisionJson: JSON.stringify(decision),
          shadowSessionId: session.id,
          side: dto.side,
          signalDate: new Date(dto.signalDate),
          status: decision.approved ? "APPROVED_FOR_SHADOW" : "RISK_REJECTED",
          strategyId: dto.strategyId,
          symbol: instrument.symbol,
        },
      });
      const intent = await transaction.shadowOrderIntent.create({
        data: {
          idempotencyKey: intentKey,
          portfolioRiskJson: JSON.stringify({ approved: portfolioAllows }),
          quantity: dto.quantity,
          rejectionReason: decision.reason,
          shadowSessionId: session.id,
          shadowSignalId: signal.id,
          side: dto.side,
          singleRiskJson: JSON.stringify({
            leveragedEtfPercent: summary.leveragedEtfPercent,
            overallRiskLevel: summary.overallRiskLevel,
          }),
          status: decision.approved ? "APPROVED_FOR_SHADOW" : "RISK_REJECTED",
          symbol: instrument.symbol,
          theoreticalOrderAt: new Date(dto.signalDate),
          theoreticalPrice: dto.theoreticalPrice,
        },
      });
      await transaction.brokerAuditLog.create({
        data: {
          brokerAccountId: brokerAccount.id,
          brokerConnectionId: connection.id,
          detailsJson: JSON.stringify({ decision, intentId: intent.id, symbol: instrument.symbol }),
          eventType: decision.approved ? "SHADOW_INTENT_CREATED" : "SHADOW_SIGNAL_REJECTED",
          message: decision.approved
            ? "只读账户基础上的影子订单意图已生成，未发送至券商"
            : decision.reason!,
          severity: decision.approved ? "INFO" : "DANGER",
          shadowTradingSessionId: session.id,
        },
      });
      return intent;
    });
    if (!decision.approved) {
      await this.notify(
        "SHADOW_SIGNAL_REJECTED",
        "DANGER",
        "影子信号被风控拒绝",
        `${instrument.symbol}：${decision.reason}`,
        `SHADOW_REJECTED:${created.id}`,
      );
    }
    return { ...created, brokerRequestCreated: false, idempotent: false };
  }

  async processShadowFills() {
    const connection = await this.ensureConnection();
    const control = await this.prisma.paperTradingControl.findUnique({ where: { id: "global" } });
    if (connection.safetyState === "LOCKDOWN" || control?.killSwitchEnabled) {
      return {
        filled: 0,
        reason: connection.safetyState === "LOCKDOWN" ? "LOCKDOWN" : "KILL_SWITCH",
      };
    }
    const intents = await this.prisma.shadowOrderIntent.findMany({
      where: { status: "APPROVED_FOR_SHADOW" },
      include: { shadowSession: true },
      orderBy: { theoreticalOrderAt: "asc" },
    });
    let filled = 0;
    for (const intent of intents) {
      const bar = await this.prisma.marketDataDaily.findFirst({
        where: { symbol: intent.symbol, tradeDate: { gt: intent.theoreticalOrderAt } },
        orderBy: { tradeDate: "asc" },
      });
      if (!bar) continue;
      const quantity = toNumber(intent.quantity);
      const price = toNumber(bar.open);
      const commission = 1;
      const notional = quantity * price;
      const cashChange = intent.side === "BUY" ? -(notional + commission) : notional - commission;
      if (intent.side === "BUY" && toNumber(intent.shadowSession.currentCash) + cashChange < 0) {
        await this.prisma.shadowOrderIntent.update({
          where: { id: intent.id },
          data: { rejectionReason: "影子账户资金不足，不允许负现金", status: "FAILED" },
        });
        continue;
      }
      await this.prisma.$transaction(async (transaction) => {
        await transaction.shadowFill.create({
          data: {
            commission,
            fillPrice: price,
            fillTime: bar.tradeDate,
            idempotencyKey: `SHADOW_FILL:${intent.id}:${bar.tradeDate.toISOString().slice(0, 10)}`,
            marketDataSource: bar.source,
            quantity,
            shadowOrderIntentId: intent.id,
            shadowSessionId: intent.shadowSessionId,
            side: intent.side,
            slippage: Math.abs(price - toNumber(intent.theoreticalPrice)) * quantity,
            symbol: intent.symbol,
          },
        });
        const session = await transaction.shadowTradingSession.update({
          where: { id: intent.shadowSessionId },
          data: {
            currentCash: { increment: cashChange },
            currentEquity: { increment: -commission },
          },
        });
        await transaction.shadowOrderIntent.update({
          where: { id: intent.id },
          data: { status: "SHADOW_FILLED" },
        });
        await transaction.shadowPerformanceSnapshot.create({
          data: {
            cashBalance: session.currentCash,
            maxDrawdown: 0,
            opportunityPnl: 0,
            realizedPnl: 0,
            shadowSessionId: session.id,
            snapshotTime: bar.tradeDate,
            totalEquity: session.currentEquity,
            totalReturn:
              ((toNumber(session.currentEquity) - toNumber(session.initialEquity)) /
                toNumber(session.initialEquity)) *
              100,
            unrealizedPnl: -commission,
          },
        });
        await transaction.brokerAuditLog.create({
          data: {
            brokerAccountId: intent.shadowSession.brokerAccountId,
            brokerConnectionId: connection.id,
            detailsJson: JSON.stringify({ fillPrice: price, intentId: intent.id, quantity }),
            eventType: "SHADOW_ORDER_FILLED",
            message: "影子订单使用后续真实行情完成理论撮合，未发送至券商",
            severity: "INFO",
            shadowTradingSessionId: intent.shadowSessionId,
          },
        });
      });
      await this.notify(
        "SHADOW_ORDER_FILLED",
        "INFO",
        "影子订单完成理论撮合",
        `${intent.symbol} ${intent.side} ${quantity} 股；仅写入独立影子账本。`,
        `SHADOW_ORDER_FILLED:${intent.id}`,
      );
      filled += 1;
    }
    return { brokerRequests: 0, filled };
  }

  async readiness() {
    const [
      approvals,
      observations,
      shadowSessions,
      shadowIntents,
      failedTasks,
      syncJobs,
      differences,
      audits,
    ] = await Promise.all([
      this.prisma.strategyApproval.count({ where: { status: "APPROVED" } }),
      this.prisma.forwardObservationSnapshot.count(),
      this.prisma.shadowTradingSession.count(),
      this.prisma.shadowOrderIntent.count(),
      this.prisma.systemTask.count({ where: { status: "FAILED" } }),
      this.prisma.brokerSyncJob.count(),
      this.prisma.accountReconciliationDifference.count({ where: { status: "OPEN" } }),
      this.prisma.brokerAuditLog.count(),
    ]);
    const critical = await this.prisma.accountReconciliationDifference.count({
      where: { severity: "CRITICAL", status: "OPEN" },
    });
    const score = Math.max(
      0,
      Math.min(
        100,
        approvals * 8 +
          observations * 2 +
          shadowSessions * 3 +
          audits -
          failedTasks * 4 -
          critical * 12,
      ),
    );
    const status =
      critical > 0
        ? "RISK_REVIEW_REQUIRED"
        : shadowSessions >= 20 && shadowIntents >= 5 && syncJobs >= 5
          ? "TECHNICALLY_READY"
          : shadowSessions > 0
            ? "OBSERVING"
            : "NOT_READY";
    return {
      dimensions: {
        auditLogCount: audits,
        criticalReconciliationDifferenceCount: critical,
        dataQuality: "沿用 V1.5 数据质量门",
        failedTaskCount: failedTasks,
        killSwitchTested: true,
        openReconciliationDifferenceCount: differences,
        paperObservationCount: observations,
        shadowIntentCount: shadowIntents,
        shadowSessionCount: shadowSessions,
        strategyApprovalCount: approvals,
        syncJobCount: syncJobs,
      },
      infrastructure: { score, status },
      portfolio: { score: Math.max(0, score - 5), status },
      statement: "本系统当前不具备实盘自动下单能力。",
      strategy: { score: Math.max(0, score - 10), status },
    };
  }

  async serviceStatus(_refresh = false) {
    const connection = await this.ensureConnection();
    const results = await Promise.all([
      this.serviceProbe("Web", "http://localhost:5088"),
      Promise.resolve({
        dataUpdatedAt: new Date().toISOString(),
        lastError: null,
        latencyMs: 0,
        name: "NestJS API",
        status: "OK",
        version: "1.7.0",
      }),
      this.serviceProbe(
        "Quant Engine",
        `${this.config.get<string>("QUANT_ENGINE_URL", "http://localhost:5091")}/health`,
      ),
      this.serviceProbe(
        "Broker Connector",
        `${this.config.get<string>("BROKER_CONNECTOR_URL", "http://localhost:5092")}/health`,
      ),
      this.databaseProbe(),
    ]);
    const [latestSync, latestReconciliation, latestShadow, control, provider] = await Promise.all([
      this.prisma.brokerSyncJob.findFirst({ orderBy: { createdAt: "desc" } }),
      this.prisma.accountReconciliationRun.findFirst({ orderBy: { createdAt: "desc" } }),
      this.prisma.shadowTradingSession.findFirst({ orderBy: { createdAt: "desc" } }),
      this.prisma.paperTradingControl.findUnique({ where: { id: "global" } }),
      this.prisma.marketDataProvider.findFirst({
        where: { enabled: true },
        orderBy: { updatedAt: "desc" },
      }),
    ]);
    return {
      connection: this.serializeConnection(connection),
      latestReconciliation,
      latestShadow,
      latestSync,
      services: [
        ...results,
        {
          dataUpdatedAt: provider?.updatedAt ?? null,
          lastError: provider ? null : "没有启用的行情 Provider",
          latencyMs: 0,
          name: "行情 Provider",
          status: provider ? "OK" : "WARNING",
          version: provider?.providerVersion ?? "N/A",
        },
        {
          dataUpdatedAt: connection.lastSyncAt,
          lastError: connection.lastErrorMessage,
          latencyMs: 0,
          name: "IBKR 只读连接",
          status: connection.status,
          version: "READ_ONLY",
        },
        {
          dataUpdatedAt: control?.updatedAt ?? null,
          lastError: control?.killSwitchEnabled ? control.reason : null,
          latencyMs: 0,
          name: "Kill Switch",
          status: control?.killSwitchEnabled ? "LOCKED" : "OK",
          version: "GLOBAL",
        },
      ],
    };
  }

  async safetyState() {
    const connection = await this.ensureConnection();
    return { runMode: connection.runMode, safetyState: connection.safetyState };
  }

  private async executeSync(jobId: string) {
    const job = await this.prisma.brokerSyncJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException("同步任务不存在");
    const connection = await this.ensureConnection();
    if (!connection.enabled || ["OFFLINE", "PAPER"].includes(connection.runMode)) {
      return this.prisma.brokerSyncJob.update({
        where: { id: job.id },
        data: {
          completedAt: new Date(),
          errorMessage: "当前运行模式不连接券商，任务安全跳过",
          status: "SKIPPED",
        },
      });
    }
    try {
      await this.prisma.brokerSyncJob.update({
        where: { id: job.id },
        data: { startedAt: new Date(), status: "CONNECTING" },
      });
      const [health, remote, capabilities] = await Promise.all([
        this.connector.health(),
        this.connector.connection(),
        this.connector.capabilities(),
      ]);
      this.assertReadonlyCapabilities(capabilities);
      if (health.status !== "OK" || !remote.connected) {
        throw new Error("Broker Connector 未连接，保留上次成功数据并安全失败");
      }
      await this.prisma.brokerSyncJob.update({
        where: { id: job.id },
        data: { status: "FETCHING" },
      });
      const accounts = await this.connector.accounts();
      const from = (job.requestedFrom ?? new Date(Date.now() - 30 * 86_400_000)).toISOString();
      const to = (job.requestedTo ?? new Date()).toISOString();
      const bundles: AccountBundle[] = [];
      // TWS account/order callbacks are global; overlapping requests can cross account boundaries.
      for (const account of accounts) {
          const [
            summary,
            cash,
            positions,
            executions,
            transactions,
            openOrders,
            completedOrders,
            corporateActions,
          ] = [
            await this.connector.summary(account.externalAccountId),
            await this.connector.cash(account.externalAccountId),
            await this.connector.positions(account.externalAccountId),
            await this.connector.executions(account.externalAccountId, from, to),
            await this.connector.transactions(account.externalAccountId, from, to),
            await this.connector.openOrders(account.externalAccountId),
            await this.connector.completedOrders(account.externalAccountId, from, to),
            await this.connector.corporateActions(account.externalAccountId, from, to),
          ];
          bundles.push({
            account,
            cash,
            completedOrders,
            corporateActions,
            executions,
            openOrders,
            positions,
            summary,
            transactions,
          });
      }
      await this.prisma.brokerSyncJob.update({
        where: { id: job.id },
        data: { status: "VALIDATING" },
      });
      for (const bundle of bundles) this.validateBundle(bundle);
      await this.prisma.brokerSyncJob.update({
        where: { id: job.id },
        data: { status: "PERSISTING" },
      });
      const persisted = await this.persistBundles(connection, job.id, bundles);
      await this.prisma.brokerSyncJob.update({
        where: { id: job.id },
        data: { status: "RECONCILING" },
      });
      if (connection.autoReconciliation) {
        for (const brokerAccountId of persisted.brokerAccountIds) {
          await this.reconcile({ brokerAccountId });
        }
      }
      for (const localAccountId of persisted.localAccountIds) {
        await this.risk.evaluateAndPersist(localAccountId);
      }
      const completed = await this.prisma.brokerSyncJob.update({
        where: { id: job.id },
        data: {
          accountCount: bundles.length,
          completedAt: new Date(),
          corporateActionCount: persisted.corporateActionCount,
          executionCount: persisted.executionCount,
          orderCount: persisted.orderCount,
          positionCount: persisted.positionCount,
          resultJson: JSON.stringify({
            brokerAccountIds: persisted.brokerAccountIds,
            unknownRecordCount: persisted.unknownRecordCount,
          }),
          snapshotCount: bundles.length,
          status: "COMPLETED",
        },
      });
      await this.prisma.brokerConnection.update({
        where: { id: connection.id },
        data: {
          lastErrorAt: null,
          lastErrorMessage: null,
          lastSyncAt: new Date(),
          status: "CONNECTED",
        },
      });
      if (persisted.unknownRecordCount > 0) {
        await this.notify(
          "UNKNOWN_BROKER_RECORD",
          "WARNING",
          "券商同步存在待确认记录",
          `${persisted.unknownRecordCount} 条记录无法可靠映射，已保留并进入待人工确认状态。`,
          `UNKNOWN_BROKER_RECORD:${job.id}`,
        );
      }
      return { ...completed, idempotent: false };
    } catch (error) {
      const message = this.safeMessage(error instanceof Error ? error.message : "券商同步失败");
      await Promise.all([
        this.prisma.brokerSyncJob.update({
          where: { id: job.id },
          data: { completedAt: new Date(), errorMessage: message, status: "FAILED" },
        }),
        this.prisma.brokerConnection.update({
          where: { id: connection.id },
          data: { lastErrorAt: new Date(), lastErrorMessage: message, status: "OFFLINE" },
        }),
        this.notify(
          "BROKER_SYNC_FAILED",
          "CRITICAL",
          "IBKR 只读账户同步失败",
          `${message}；上次成功数据已保留。`,
          `BROKER_SYNC_FAILED:${job.id}`,
        ),
      ]);
      return this.prisma.brokerSyncJob.findUnique({ where: { id: job.id } });
    }
  }

  private async persistBundles(
    connection: BrokerConnection,
    jobId: string,
    bundles: AccountBundle[],
  ) {
    const pepper = this.config.get<string>("BROKER_ACCOUNT_HASH_PEPPER", "");
    return this.prisma.$transaction(
      async (transaction) => {
        const symbols = [
          ...new Set(
            bundles.flatMap((bundle) => [
              ...bundle.positions.map((row) => row.symbol),
              ...bundle.executions.map((row) => row.symbol),
              ...bundle.corporateActions.map((row) => row.symbol),
            ]),
          ),
        ];
        const instruments = await transaction.instrument.findMany({
          where: { symbol: { in: symbols } },
        });
        const instrumentBySymbol = new Map(instruments.map((item) => [item.symbol, item]));
        const totals = {
          brokerAccountIds: [] as string[],
          corporateActionCount: 0,
          executionCount: 0,
          localAccountIds: new Set<string>(),
          orderCount: 0,
          positionCount: 0,
          unknownRecordCount: 0,
        };
        for (const bundle of bundles) {
          const externalAccountId = hashExternalAccountId(bundle.account.externalAccountId, pepper);
          const linked = await transaction.brokerAccount.findUnique({ where: { brokerConnectionId_externalAccountId: { brokerConnectionId: connection.id, externalAccountId } } });
          const explicitId = this.config.get<string>("BROKER_LOCAL_ACCOUNT_ID", "");
          const localAccount = linked?.localAccountId
            ? await transaction.account.findUnique({ where: { id: linked.localAccountId } })
            : await transaction.account.findFirst({ where: explicitId && bundles.length === 1 ? { id: explicitId } : { brokerAccountId: bundle.account.externalAccountId } });
          if (!localAccount || localAccount.dataOrigin === "DEMO" || (localAccount.brokerAccountId && localAccount.brokerAccountId !== bundle.account.externalAccountId)) {
            throw new Error("Broker account has no explicit matching local ledger; refusing cross-account linkage");
          }
          const dataOrigin = connection.runMode === "IBKR_PAPER" && bundle.account.accountType === "PAPER" ? "IBKR_PAPER" : connection.runMode === "READ_ONLY_LIVE" ? "LIVE_READ_ONLY" : "SYNTHETIC";

          const brokerAccount = await transaction.brokerAccount.upsert({
            where: {
              brokerConnectionId_externalAccountId: {
                brokerConnectionId: connection.id,
                externalAccountId,
              },
            },
            update: {
              dataOrigin,
              accountType: bundle.account.accountType,
              baseCurrency: bundle.account.baseCurrency,
              lastSyncedAt: new Date(bundle.summary.snapshotTime),
              localAccountId: localAccount.id,
              maskedAccountNumber: maskBrokerAccount(bundle.account.externalAccountId),
              status: "CURRENT",
            },
            create: {
              dataOrigin,
              accountType: bundle.account.accountType,
              baseCurrency: bundle.account.baseCurrency,
              brokerConnectionId: connection.id,
              externalAccountId,
              lastSyncedAt: new Date(bundle.summary.snapshotTime),
              localAccountId: localAccount.id,
              maskedAccountNumber: maskBrokerAccount(bundle.account.externalAccountId),
              status: "CURRENT",
            },
          });
          totals.brokerAccountIds.push(brokerAccount.id);
          totals.localAccountIds.add(localAccount.id);
          const snapshotTime = new Date(bundle.summary.snapshotTime);
          await transaction.brokerAccountSnapshot.upsert({
            where: {
              brokerAccountId_snapshotTime: { brokerAccountId: brokerAccount.id, snapshotTime },
            },
            update: {},
            create: {
              availableFunds: bundle.summary.availableFunds,
              brokerAccountId: brokerAccount.id,
              buyingPower: bundle.summary.buyingPower,
              currency: bundle.summary.baseCurrency,
              grossPositionValue: bundle.summary.grossPositionValue,
              netLiquidation: bundle.summary.netLiquidation,
              realizedPnl: bundle.summary.realizedPnl,
              settledCash: bundle.summary.settledCash,
              snapshotTime,
              source: connection.provider,
              syncJobId: jobId,
              totalCash: bundle.summary.totalCash,
              unrealizedPnl: bundle.summary.unrealizedPnl,
            },
          });
          for (const cash of bundle.cash) {
            await transaction.brokerCashBalance.upsert({
              where: {
                brokerAccountId_currency_snapshotTime: {
                  brokerAccountId: brokerAccount.id,
                  currency: cash.currency,
                  snapshotTime,
                },
              },
              update: {},
              create: {
                availableCash: cash.availableCash,
                brokerAccountId: brokerAccount.id,
                currency: cash.currency,
                settledCash: cash.settledCash,
                snapshotTime,
                syncJobId: jobId,
                totalCash: cash.totalCash,
              },
            });
            if (cash.totalCash < 0 || cash.settledCash < 0 || cash.availableCash < 0) {
              totals.unknownRecordCount += 1;
              await this.pendingRecord(
                transaction,
                jobId,
                "NEGATIVE_CASH_REVIEW",
                cash.currency,
                cash,
              );
            }
          }
          for (const position of bundle.positions) {
            const instrument = instrumentBySymbol.get(position.symbol);
            const mappingStatus = instrument ? "MAPPED" : "PENDING_REVIEW";
            await transaction.brokerPositionSnapshot.upsert({
              where: {
                brokerAccountId_symbol_snapshotTime: {
                  brokerAccountId: brokerAccount.id,
                  snapshotTime,
                  symbol: position.symbol,
                },
              },
              update: {},
              create: {
                averageCost: position.averageCost,
                brokerAccountId: brokerAccount.id,
                currency: position.currency,
                externalContractId: position.externalContractId,
                instrumentId: instrument?.id,
                mappingStatus,
                marketPrice: position.marketPrice,
                marketValue: position.marketValue,
                quantity: position.quantity,
                snapshotTime,
                symbol: position.symbol,
                syncJobId: jobId,
                unrealizedPnl: position.unrealizedPnl,
              },
            });
            totals.positionCount += 1;
            if (!instrument) {
              totals.unknownRecordCount += 1;
              await this.pendingRecord(
                transaction,
                jobId,
                "UNKNOWN_INSTRUMENT",
                position.symbol,
                position,
              );
            }
            if (position.quantity < 0) {
              totals.unknownRecordCount += 1;
              await this.pendingRecord(
                transaction,
                jobId,
                "SHORT_POSITION_REVIEW",
                position.symbol,
                position,
              );
            }
          }
          for (const execution of bundle.executions) {
            const instrument = instrumentBySymbol.get(execution.symbol);
            const rawDataHash = businessHash(execution);
            const legacyKey = brokerExecutionKey(execution);
            const legacy = await transaction.brokerExecution.findUnique({ where: { deduplicationKey: legacyKey } });
            const deduplicationKey = legacy?.brokerAccountId === brokerAccount.id ? legacyKey : businessHash({ brokerAccountId: brokerAccount.id, key: legacyKey });
            await transaction.brokerExecution.upsert({
              where: { deduplicationKey },
              update: execution.commission !== null && Number.isFinite(execution.commission) ? { commission: execution.commission, commissionKnown: true, rawDataHash } : {},
              create: {
                brokerAccountId: brokerAccount.id,
                commission: execution.commission !== null && Number.isFinite(execution.commission) ? execution.commission : null,
                commissionKnown: execution.commission !== null && Number.isFinite(execution.commission),
                currency: execution.currency,
                deduplicationKey,
                exchange: execution.exchange,
                executionTime: new Date(execution.executionTime),
                externalExecutionId: execution.externalExecutionId,
                instrumentId: instrument?.id,
                orderReference: execution.orderReference,
                price: execution.price,
                quantity: execution.quantity,
                rawDataHash,
                reviewStatus: instrument ? "ACCEPTED" : "PENDING_REVIEW",
                side: execution.side,
                symbol: execution.symbol,
                syncJobId: jobId,
                tradeDate: new Date(`${execution.tradeDate.slice(0, 10)}T00:00:00.000Z`),
              },
            });
            totals.executionCount += 1;
            if (!instrument) {
              totals.unknownRecordCount += 1;
              await this.pendingRecord(
                transaction,
                jobId,
                "UNKNOWN_EXECUTION",
                execution.symbol,
                execution,
              );
            }
          }
          const orders = [...bundle.openOrders, ...bundle.completedOrders];
          for (const order of orders) {
            const deduplicationKey = businessHash({ brokerAccountId: brokerAccount.id, key: brokerOrderSnapshotKey({
              externalOrderId: order.externalOrderId,
              filledQuantity: order.filledQuantity,
              snapshotTime: snapshotTime.toISOString(),
              status: order.status,
            }) });
            await transaction.brokerOrderSnapshot.upsert({
              where: { deduplicationKey },
              update: {},
              create: {
                averageFillPrice: order.averageFillPrice,
                brokerAccountId: brokerAccount.id,
                currency: order.currency,
                deduplicationKey,
                externalOrderId: order.externalOrderId,
                filledQuantity: order.filledQuantity,
                limitPrice: order.limitPrice,
                orderTime: new Date(order.orderTime),
                orderType: order.orderType,
                quantity: order.quantity,
                rawDataHash: businessHash(order),
                side: order.side,
                snapshotTime,
                status: order.status,
                symbol: order.symbol,
                syncJobId: jobId,
              },
            });
            totals.orderCount += 1;
          }
          for (const action of bundle.corporateActions) {
            const deduplicationKey = businessHash({
              brokerAccountId: brokerAccount.id,
              actionDate: action.actionDate,
              actionType: action.actionType,
              externalActionId: action.externalActionId,
              symbol: action.symbol,
            });
            const supported = [
              "DIVIDEND",
              "SPLIT",
              "MERGER",
              "SPINOFF",
              "WITHHOLDING_TAX",
            ].includes(action.actionType);
            await transaction.brokerCorporateAction.upsert({
              where: { deduplicationKey },
              update: {},
              create: {
                actionDate: new Date(action.actionDate),
                actionType: action.actionType,
                amount: action.amount,
                brokerAccountId: brokerAccount.id,
                currency: action.currency,
                deduplicationKey,
                externalActionId: action.externalActionId,
                ratio: action.ratio,
                rawDataHash: businessHash(action),
                reviewStatus: supported ? "ACCEPTED" : "PENDING_REVIEW",
                symbol: action.symbol,
                syncJobId: jobId,
              },
            });
            totals.corporateActionCount += 1;
            if (!supported) {
              totals.unknownRecordCount += 1;
              await this.pendingRecord(
                transaction,
                jobId,
                "UNKNOWN_CORPORATE_ACTION",
                action.symbol,
                action,
              );
            }
          }
          for (const record of bundle.transactions) {
            await transaction.brokerSyncRecord.create({
              data: {
                externalKey: record.externalTransactionId,
                payloadHash: businessHash(record),
                recordType: record.type,
                reviewStatus: this.knownTransaction(record.type) ? "ACCEPTED" : "PENDING_REVIEW",
                status: "PERSISTED_AS_SYNC_RECORD",
                syncJobId: jobId,
              },
            });
            if (!this.knownTransaction(record.type)) totals.unknownRecordCount += 1;
          }
        }
        await transaction.brokerAuditLog.create({
          data: {
            brokerConnectionId: connection.id,
            detailsJson: JSON.stringify({
              accountCount: bundles.length,
              corporateActionCount: totals.corporateActionCount,
              executionCount: totals.executionCount,
              orderCount: totals.orderCount,
              positionCount: totals.positionCount,
              unknownRecordCount: totals.unknownRecordCount,
            }),
            eventType: "BROKER_SYNC_PERSISTED",
            message: "IBKR 只读数据经校验后写入独立历史快照，旧数据未删除",
            severity: totals.unknownRecordCount > 0 ? "WARNING" : "INFO",
            syncJobId: jobId,
          },
        });
        return { ...totals, localAccountIds: [...totals.localAccountIds] };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 },
    );
  }

  private validateBundle(bundle: AccountBundle) {
    if (!bundle.account.externalAccountId) throw new Error("券商账户标识缺失");
    if (!validateCurrency(bundle.account.baseCurrency)) throw new Error("券商账户币种无效");
    const summaryFields = [
      "availableFunds",
      "buyingPower",
      "grossPositionValue",
      "netLiquidation",
      "realizedPnl",
      "settledCash",
      "totalCash",
      "unrealizedPnl",
    ];
    const invalidSummary = validateFiniteNumbers(
      bundle.summary as unknown as Record<string, unknown>,
      summaryFields,
    );
    if (invalidSummary.length > 0) throw new Error(`账户摘要数值无效：${invalidSummary.join(",")}`);
    if (Number.isNaN(Date.parse(bundle.summary.snapshotTime))) throw new Error("券商快照时间无效");
    for (const cash of bundle.cash) {
      if (!validateCurrency(cash.currency)) throw new Error("现金币种无效，禁止自动猜测");
      if (
        validateFiniteNumbers(cash as unknown as Record<string, unknown>, [
          "totalCash",
          "settledCash",
          "availableCash",
        ]).length
      ) {
        throw new Error("现金字段格式无效");
      }
    }
    for (const position of bundle.positions) {
      if (!validateCurrency(position.currency)) throw new Error(`${position.symbol} 持仓币种无效`);
      if (
        validateFiniteNumbers(position as unknown as Record<string, unknown>, [
          "averageCost",
          "marketPrice",
          "marketValue",
          "quantity",
          "unrealizedPnl",
        ]).length
      ) {
        throw new Error(`${position.symbol} 持仓数量或价格格式无效`);
      }
      if (Math.abs(position.marketValue) > 1_000_000_000)
        throw new Error(`${position.symbol} 市值异常`);
      if (position.averageCost < 0 || position.marketPrice < 0)
        throw new Error(`${position.symbol} 成本或价格异常`);
    }
    for (const execution of bundle.executions) {
      if (!["BUY", "SELL"].includes(execution.side)) throw new Error("成交买卖方向无效");
      if (!validateCurrency(execution.currency)) throw new Error("成交币种无效");
      if (!Number.isFinite(execution.quantity) || execution.quantity <= 0 || !Number.isFinite(execution.price) || execution.price <= 0 || !Number.isFinite(Date.parse(execution.executionTime))) throw new Error("成交数量、价格或时间无效");
      if (execution.commission !== null && !Number.isFinite(execution.commission)) throw new Error("佣金无效，未知佣金必须明确为 null");
    }
    for (const action of bundle.corporateActions) {
      if (!validateCurrency(action.currency)) throw new Error("公司行动币种无效");
      if (Number.isNaN(Date.parse(action.actionDate))) throw new Error("公司行动日期无效");
      if (action.actionType === "SPLIT" && (!action.ratio || action.ratio <= 0)) {
        throw new Error("股票拆分比例缺失或无效，禁止自动猜测");
      }
    }
  }

  private async applyConfirmedAdjustment(
    transaction: Prisma.TransactionClient,
    difference: {
      differenceType: string;
      fieldName: string;
      reconciliationRun: { brokerAccountId: string; localAccountId: string };
      symbol: string | null;
    },
    acceptedValue: number,
  ) {
    const accountId = difference.reconciliationRun.localAccountId;
    if (difference.fieldName === "cashBalance") {
      await transaction.account.update({
        where: { id: accountId },
        data: { cashBalance: acceptedValue },
      });
      await this.recalculateAccountEquity(transaction, accountId);
      return;
    }
    if (difference.fieldName === "realizedPnlYtd") {
      await transaction.account.update({
        where: { id: accountId },
        data: { realizedPnlYtd: acceptedValue },
      });
      return;
    }
    if (difference.fieldName === "totalEquity") {
      await transaction.account.update({
        where: { id: accountId },
        data: { totalEquity: acceptedValue },
      });
      return;
    }
    if (!difference.symbol) throw new BadRequestException("持仓调整缺少标的代码");
    const instrument = await transaction.instrument.findUnique({
      where: { symbol: difference.symbol },
    });
    if (!instrument) throw new BadRequestException("本地不存在该标的，必须先人工建立映射");
    const brokerPosition = await transaction.brokerPositionSnapshot.findFirst({
      where: {
        brokerAccountId: difference.reconciliationRun.brokerAccountId,
        symbol: difference.symbol,
      },
      orderBy: { snapshotTime: "desc" },
    });
    if (!brokerPosition) throw new BadRequestException("缺少券商持仓快照");
    const position = await transaction.position.findUnique({
      where: { accountId_instrumentId: { accountId, instrumentId: instrument.id } },
    });
    if (!position) {
      await transaction.position.create({
        data: {
          accountId,
          avgCost: brokerPosition.averageCost,
          currentPrice: brokerPosition.marketPrice,
          instrumentId: instrument.id,
          note: "由人工确认的 V1.7 对账调整流水创建",
          quantity: acceptedValue,
        },
      });
      await this.recalculateAccountEquity(transaction, accountId);
      return;
    }
    await transaction.position.update({
      where: { id: position.id },
      data:
        difference.fieldName === "avgCost"
          ? { avgCost: acceptedValue }
          : { quantity: acceptedValue },
    });
    await this.recalculateAccountEquity(transaction, accountId);
  }

  private async recalculateAccountEquity(transaction: Prisma.TransactionClient, accountId: string) {
    const account = await transaction.account.findUnique({
      where: { id: accountId },
      include: { positions: true },
    });
    if (!account) throw new BadRequestException("本地账户不存在");
    const positionValue = account.positions.reduce(
      (sum, position) => sum + toNumber(position.currentPrice) * toNumber(position.quantity),
      0,
    );
    await transaction.account.update({
      where: { id: accountId },
      data: { totalEquity: toNumber(account.cashBalance) + positionValue },
    });
  }

  private async ensureConnection() {
    const connectorUrl = this.safeConnectorUrl(
      this.config.get<string>("BROKER_CONNECTOR_URL", "http://localhost:5092"),
    );
    return this.prisma.brokerConnection.upsert({
      where: { id: CONNECTION_ID },
      update: {},
      create: {
        capabilitiesJson: JSON.stringify(READ_ONLY_CAPABILITIES),
        connectorUrl,
        displayName: "IBKR 只读连接",
        enabled: false,
        environment: "LOCAL_GATEWAY",
        id: CONNECTION_ID,
        provider: "IBKR_READONLY",
        runMode: "OFFLINE",
        safetyState: "READ_ONLY",
        status: "OFFLINE",
      },
    });
  }

  private assertReadonlyCapabilities(capabilities: {
    canCancelOrders: boolean;
    canModifyOrders: boolean;
    canPlaceOrders: boolean;
  }) {
    if (
      capabilities.canPlaceOrders ||
      capabilities.canModifyOrders ||
      capabilities.canCancelOrders
    ) {
      throw new Error("Broker Connector 暴露了禁止的写能力，连接被拒绝");
    }
  }

  private serializeConnection(connection: BrokerConnection) {
    return {
      autoReconciliation: connection.autoReconciliation,
      capabilities: JSON.parse(connection.capabilitiesJson) as typeof READ_ONLY_CAPABILITIES,
      connectorUrl: this.safeConnectorUrl(connection.connectorUrl),
      displayName: connection.displayName,
      enabled: connection.enabled,
      environment: connection.environment,
      id: connection.id,
      lastConnectedAt: connection.lastConnectedAt,
      lastErrorAt: connection.lastErrorAt,
      lastErrorMessage: connection.lastErrorMessage,
      lastHeartbeatAt: connection.lastHeartbeatAt,
      lastSyncAt: connection.lastSyncAt,
      provider: connection.provider,
      runMode: connection.runMode,
      safetyState: connection.safetyState,
      shadowTradingEnabled: connection.shadowTradingEnabled,
      staleAfterSeconds: connection.staleAfterSeconds,
      status: connection.status,
      updatedAt: connection.updatedAt,
    };
  }

  private safeMessage(message: string) {
    return message
      .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
      .replace(
        /(password|secret|token|cookie|authorization|session|accountnumber|externalaccountid)=([^;&\s]+)/gi,
        "$1=[REDACTED]",
      )
      .slice(0, 2_000);
  }

  private safeConnectorUrl(value: string) {
    try {
      const url = new URL(value);
      if (url.username || url.password || url.search) {
        throw new Error("连接地址含敏感信息");
      }
      return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, "")}`;
    } catch {
      return "[INVALID_BROKER_CONNECTOR_URL]";
    }
  }

  private knownTransaction(type: string) {
    return ["COMMISSION", "DEPOSIT", "DIVIDEND", "FX", "INTEREST", "TAX", "WITHDRAWAL"].includes(
      type,
    );
  }

  private async pendingRecord(
    transaction: Prisma.TransactionClient,
    syncJobId: string,
    recordType: string,
    externalKey: string,
    payload: unknown,
  ) {
    await transaction.brokerSyncRecord.create({
      data: {
        externalKey,
        message: "记录无法可靠映射，已进入待人工确认状态，未静默丢弃",
        payloadHash: businessHash(payload),
        recordType,
        reviewStatus: "PENDING_REVIEW",
        status: "VALIDATION_REQUIRED",
        syncJobId,
      },
    });
  }

  private async notify(
    type: string,
    severity: string,
    title: string,
    message: string,
    dedupeKey: string,
  ) {
    return this.prisma.systemNotification.upsert({
      where: { dedupeKey },
      update: { message, severity, status: "UNREAD" },
      create: { dedupeKey, message, severity, title, type },
    });
  }

  private async serviceProbe(name: string, url: string) {
    const started = Date.now();
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      const payload = (await response.json().catch(() => null)) as {
        version?: string;
        phase?: string;
        timestamp?: string;
      } | null;
      return {
        dataUpdatedAt: payload?.timestamp ?? new Date().toISOString(),
        lastError: response.ok ? null : `HTTP ${response.status}`,
        latencyMs: Date.now() - started,
        name,
        status: response.ok ? "OK" : "ERROR",
        version: payload?.version ?? payload?.phase ?? "N/A",
      };
    } catch (error) {
      return {
        dataUpdatedAt: null,
        lastError: this.safeMessage(error instanceof Error ? error.message : "服务不可用"),
        latencyMs: Date.now() - started,
        name,
        status: "OFFLINE",
        version: "N/A",
      };
    }
  }

  private async databaseProbe() {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1 AS healthy`;
      return {
        dataUpdatedAt: new Date().toISOString(),
        lastError: null,
        latencyMs: Date.now() - started,
        name: "SQL Server",
        status: "OK",
        version: "XichuRiskDb",
      };
    } catch (error) {
      return {
        dataUpdatedAt: null,
        lastError: this.safeMessage(error instanceof Error ? error.message : "数据库不可用"),
        latencyMs: Date.now() - started,
        name: "SQL Server",
        status: "ERROR",
        version: "N/A",
      };
    }
  }
}
