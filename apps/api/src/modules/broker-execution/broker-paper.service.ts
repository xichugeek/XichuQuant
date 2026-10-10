import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type BrokerOrderProposal, type BrokerPaperOrder } from "@prisma/client";
import { Cron } from "@nestjs/schedule";

import { toNumber } from "../../common/decimal";
import { PrismaService } from "../../prisma/prisma.service";
import { BrokerSyncService } from "../broker-sync/broker-sync.service";
import { UsMarketCalendarService } from "../market-data/us-market-calendar.service";
import { RiskEngineService } from "../risk/risk-engine.service";
import type { RiskPositionInput } from "../risk/risk.types";
import {
  calculateEffectiveExposure,
  calculateProfitGiveback,
  disciplineLimits,
  evaluateOrderDiscipline,
  evaluateRiskAmendment,
  riskDisciplineEventKey,
} from "../risk-discipline/risk-discipline.rules";
import type {
  InstrumentRiskMetadata,
  OrderDisciplineDecision,
  ProfitGivebackResult,
  ScalePlanSnapshot,
} from "../risk-discipline/risk-discipline.types";
import type {
  CancelBrokerPaperOrderDto,
  ConfirmBrokerPaperReplyDto,
  ConfigureBrokerPaperExecutionDto,
  CreateBrokerOrderProposalDto,
  DecideBrokerOrderProposalDto,
  ModifyBrokerPaperOrderDto,
  RecordBackupRecoveryDto,
  SubmitBrokerPaperOrderDto,
  UpdateExecutionKillSwitchDto,
} from "./broker-paper.dto";
import {
  evaluateBrokerPaperDeploymentEligibility,
  evaluateExecutionGuard,
  evaluateSubmissionGate,
  executionKey,
  killSwitchAllowsOrder,
  orderLifecycleStatus,
  matchBrokerOrderIdentity,
  paperReadinessAllowsObservation,
  paperOrderKey,
  paperProposalKey,
  stableHash,
  verifiedRealtimeQuote,
  protectiveStopCompliant,
  weightedAverageFills,
} from "./broker-paper.rules";
import {
  PaperBrokerConnectorClient,
  SubmissionUnknownError,
  type ConnectorPaperAccountSummary,
  type ConnectorPaperOrderInput,
  type ConnectorPaperOrderState,
  type ConnectorPaperPosition,
} from "./paper-broker-connector.client";

const CONNECTION_ID = "broker-connection-ibkr-readonly";
const CONTROL_ID = "broker-paper-execution-global";
const ACTIVE_ORDER_STATUSES = [
  "APPROVED",
  "BROKER_CONFIRMATION_REQUIRED",
  "CREATED",
  "PARTIALLY_FILLED",
  "PENDING_CANCEL",
  "PRE_SUBMITTED",
  "SUBMITTING",
  "SUBMITTED",
  "SUBMISSION_UNKNOWN",
  "UNKNOWN",
  "VALIDATING",
  "WAITING_APPROVAL",
];

type ProposalSnapshot = {
  accountSnapshotTime: string | null;
  dataQualityPassed: boolean;
  estimatedCashAfter: number;
  estimatedPositionAfter: number;
  marketDataTime: string | null;
  portfolioRiskApproved: boolean;
  portfolioRiskDecisionId: string | null;
  referencePrice: number;
  riskApproved: boolean;
  riskDisciplineApproved: boolean;
  riskDisciplineDecision: OrderDisciplineDecision;
  riskDecisionId: string;
  riskResult: unknown;
  source: "IBKR_PAPER_PROPOSAL";
};

@Injectable()
export class BrokerPaperService {
  private readonly logger = new Logger(BrokerPaperService.name);
  private paperSyncInFlight = false;
  private syncPromise: ReturnType<BrokerPaperService["syncPaperOrdersOnce"]> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly connector: PaperBrokerConnectorClient,
    private readonly brokerSync: BrokerSyncService,
    private readonly riskEngine: RiskEngineService,
    private readonly marketCalendar: UsMarketCalendarService,
  ) {}

  async dashboard() {
    const control = await this.ensureControl();
    const [accounts, proposals, orders, reconciliations, incidents, backups, connectorStatus, connection] =
      await Promise.all([
        this.prisma.brokerAccount.findMany({
          where: { accountType: "PAPER" },
          include: {
            snapshots: { orderBy: { snapshotTime: "desc" }, take: 1 },
            positionSnapshots: { orderBy: { snapshotTime: "desc" }, take: 50 },
          },
          orderBy: { createdAt: "asc" },
        }),
        this.prisma.brokerOrderProposal.findMany({
          include: {
            approvals: { orderBy: { createdAt: "desc" }, take: 5 },
            guardDecisions: { orderBy: { createdAt: "desc" }, take: 5 },
            paperOrder: true,
          },
          orderBy: { createdAt: "desc" },
          take: 80,
        }),
        this.prisma.brokerPaperOrder.findMany({
          include: {
            events: { orderBy: { eventTime: "desc" }, take: 20 },
            executions: {
              include: { commissions: { orderBy: { reportTime: "asc" } } },
              orderBy: { executionTime: "asc" },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 80,
        }),
        this.prisma.brokerPaperReconciliationRun.findMany({
          include: { differences: { orderBy: [{ severity: "desc" }, { createdAt: "desc" }] } },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
        this.prisma.executionIncident.findMany({
          orderBy: { occurredAt: "desc" },
          take: 100,
        }),
        this.prisma.backupRecoveryRun.findMany({ orderBy: { startedAt: "desc" }, take: 50 }),
        this.connectorStatus(),
        this.prisma.brokerConnection.findUnique({ where: { id: CONNECTION_ID } }),
      ]);
    const accountViews = accounts.map((account) => ({
      accountType: account.accountType,
      baseCurrency: account.baseCurrency,
      id: account.id,
      lastSyncedAt: account.lastSyncedAt,
      maskedAccountNumber: account.maskedAccountNumber,
      snapshot: account.snapshots[0]
        ? this.serializeDecimalRecord(account.snapshots[0] as unknown as Record<string, unknown>)
        : null,
      status: account.status,
    }));
    return {
      accounts: accountViews,
      backups,
      connector: connectorStatus,
      configuration: connection
        ? {
            enabled: connection.enabled,
            environment: connection.environment,
            runMode: connection.runMode,
            status: connection.status,
          }
        : null,
      control,
      incidents,
      isolation: {
        brokerPaperTablesOnly: true,
        internalPaperUnchanged: true,
        liveAccountWrites: false,
        shadowUnchanged: true,
      },
      orders: orders.map((order) => this.serializeOrder(order)),
      proposals: proposals.map((proposal) => this.serializeProposal(proposal)),
      reconciliations,
      safetyStatement:
        "仅允许人工审批后的 IBKR Paper 订单；READ_ONLY_LIVE 和真实账户在 Connector 层不可调用写接口。",
      supportedOrderTypes: ["LIMIT", "MARKET", "STOP", "STOP_LIMIT"],
    };
  }

  async configurePaperExecution(dto: ConfigureBrokerPaperExecutionDto) {
    const expected = dto.enabled ? "ENABLE IBKR PAPER" : "DISABLE IBKR PAPER";
    if (dto.confirmationText !== expected) {
      throw new BadRequestException("Paper 执行配置二次确认文本不匹配");
    }
    const connection = await this.prisma.brokerConnection.findUnique({ where: { id: CONNECTION_ID } });
    if (!connection) throw new BadRequestException("Broker Connection 不存在");
    if (dto.enabled) {
      const [capabilities, health] = await Promise.all([
        this.connector.capabilities(),
        this.connector.health(),
      ]);
      this.assertPaperCapabilities(capabilities);
      if (health.status !== "OK") throw new BadRequestException("Broker Connector Paper 环境未就绪");
      const allowlist = this.config
        .get<string>("BROKER_PAPER_ACCOUNT_HASH_ALLOWLIST", "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const matchingAccounts = await this.prisma.brokerAccount.count({
        where: { accountType: "PAPER", externalAccountId: { in: allowlist } },
      });
      if (allowlist.length !== 1 || matchingAccounts !== 1) {
        throw new BadRequestException("启用前必须且只能配置一个匹配的 Paper 账户哈希白名单");
      }
    }
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.brokerConnection.update({
        where: { id: CONNECTION_ID },
        data: dto.enabled
          ? {
              enabled: true,
              environment: "PAPER",
              runMode: "IBKR_PAPER",
              status: "CONNECTED",
            }
          : {
              enabled: false,
              environment: "LOCAL_GATEWAY",
              runMode: "OFFLINE",
              status: "OFFLINE",
            },
      });
      await this.audit(transaction, {
        actorId: dto.actorId,
        correlationId: stableHash({ enabled: dto.enabled, time: new Date().toISOString() }),
        eventType: dto.enabled ? "BROKER_PAPER_EXECUTION_ENABLED" : "BROKER_PAPER_EXECUTION_DISABLED",
        message: `${expected}：${dto.reason}`,
        severity: "CRITICAL",
      });
      return {
        enabled: updated.enabled,
        environment: updated.environment,
        runMode: updated.runMode,
        safetyStatement: "仅更改 IBKR Paper 专用运行状态；Live 写能力保持 false",
      };
    });
  }

  async createProposal(dto: CreateBrokerOrderProposalDto) {
    const symbol = dto.symbol.trim().toUpperCase();
    const [account, deployment, strategy, instruments, latestMarket, quality, rules] =
      await Promise.all([
        this.prisma.brokerAccount.findUnique({
          where: { id: dto.brokerAccountId },
          include: {
            positionSnapshots: { orderBy: { snapshotTime: "desc" }, take: 100 },
            snapshots: { orderBy: { snapshotTime: "desc" }, take: 1 },
          },
        }),
        this.prisma.strategyDeployment.findUnique({ where: { id: dto.strategyDeploymentId } }),
        this.prisma.strategy.findUnique({ where: { id: dto.strategyId } }),
        this.prisma.instrument.findMany({ where: { isActive: true } }),
        this.prisma.marketDataDaily.findFirst({ where: { symbol }, orderBy: { tradeDate: "desc" } }),
        this.prisma.dataQualityReport.findFirst({ where: { symbol }, orderBy: { analysisDate: "desc" } }),
        this.prisma.riskRule.findMany({ where: { enabled: true } }),
      ]);
    const instrument = instruments.find((item) => item.symbol === symbol);
    if (!account || account.accountType !== "PAPER" || account.dataOrigin !== "IBKR_PAPER") {
      await this.environmentMismatch(dto.brokerAccountId, "订单建议账户不是明确的 PAPER 账户");
      throw new BadRequestException("仅允许为明确标记的 IBKR PAPER 账户创建建议");
    }
    if (!deployment || !strategy || deployment.strategyId !== dto.strategyId) {
      const reasons = [
        ...(!strategy ? [{ code: "STRATEGY_NOT_FOUND", message: "没有可用的策略证据" }] : []),
        ...(!deployment
          ? [{ code: "DEPLOYMENT_NOT_FOUND", message: "没有可用的策略部署" }]
          : deployment.strategyId !== dto.strategyId
            ? [{ code: "STRATEGY_DEPLOYMENT_MISMATCH", message: "策略部署与策略来源不一致" }]
            : []),
      ];
      await this.persistProposalPreflightBlock(account.id, dto, symbol, reasons);
      throw new BadRequestException(reasons.map((item) => item.message).join("；"));
    }
    if (!new Set(["PAPER_APPROVED", "PAPER_OBSERVING", "PAPER_RUNNING"]).has(deployment.status)) {
      await this.persistProposalPreflightBlock(account.id, dto, symbol, [
        { code: "DEPLOYMENT_STATUS", message: "策略部署状态不允许生成 IBKR Paper 建议" },
      ]);
      throw new BadRequestException("策略部署状态不允许生成 IBKR Paper 建议");
    }
    if (!instrument || !latestMarket) {
      const reasons = [
        ...(!instrument ? [{ code: "INSTRUMENT_NOT_FOUND", message: "标的元数据不存在" }] : []),
        ...(!latestMarket
          ? [{ code: "MARKET_CONTEXT_MISSING", message: "标的缺少已验证行情上下文" }]
          : []),
      ];
      await this.persistProposalPreflightBlock(account.id, dto, symbol, reasons);
      throw new BadRequestException("策略、标的或行情上下文不完整；默认拒绝");
    }
    const deploymentEligibility = evaluateBrokerPaperDeploymentEligibility({
      deploymentRiskConfigJson: deployment.paperRiskConfigJson,
      deploymentSymbolUniverseJson: deployment.symbolUniverseJson,
      strategySymbolUniverseJson: strategy.symbolUniverse,
      symbol,
    });
    if (!deploymentEligibility.allowed) {
      const failedChecks = deploymentEligibility.checks.filter((item) => !item.passed);
      await this.persistProposalPreflightBlock(account.id, dto, symbol, failedChecks);
      throw new BadRequestException(
        `策略部署不允许该 IBKR Paper 订单：${failedChecks.map((item) => item.message).join("；")}`,
      );
    }
    this.validateOrderType(dto);
    const referencePrice = dto.limitPrice ?? dto.stopPrice ?? toNumber(latestMarket.close);
    const estimatedValue = referencePrice * dto.quantity;
    const estimatedCommission = Math.max(1, dto.quantity * 0.005);
    const latestSnapshot = account.snapshots[0];
    if (!latestSnapshot) throw new BadRequestException("IBKR Paper 账户缺少只读快照");
    const currentPositions = this.latestPositions(account.positionSnapshots);
    const projectedPositions = this.projectPositions(
      currentPositions,
      instrument,
      dto.side,
      dto.quantity,
      referencePrice,
      instruments,
    );
    const cashAfter =
      toNumber(latestSnapshot.totalCash) +
      (dto.side === "BUY" ? -(estimatedValue + estimatedCommission) : estimatedValue - estimatedCommission);
    const riskResult = this.riskEngine.evaluate(
      {
        cashBalance: cashAfter,
        id: account.id,
        name: `IBKR Paper ${account.maskedAccountNumber}`,
        realizedPnlYtd: toNumber(latestSnapshot.realizedPnl),
        totalEquity: toNumber(latestSnapshot.netLiquidation),
      },
      projectedPositions,
      rules.map((rule) => ({
        code: rule.code,
        enabled: rule.enabled,
        level: rule.level,
        limitValue: toNumber(rule.limitValue),
      })),
    );
    const limits = disciplineLimits(
      rules.map((rule) => ({
        code: rule.code,
        enabled: rule.enabled,
        limitValue: toNumber(rule.limitValue),
      })),
    );
    const [scalePlanRecord, firstFill, peakPnl] = await Promise.all([
      dto.predefinedScalePlanId
        ? this.prisma.predefinedScalePlan.findUnique({ where: { id: dto.predefinedScalePlanId } })
        : null,
      this.prisma.brokerExecution.findFirst({
        where: { brokerAccountId: account.id, symbol },
        orderBy: { executionTime: "asc" },
        select: { executionTime: true },
      }),
      this.prisma.profitGivebackSnapshot.findFirst({ where: { accountId: account.id, pnlYear: new Date().getUTCFullYear(), pnlCoverage: "VERIFIED_YEARLY_STATEMENT" }, orderBy: { snapshotDate: "desc" } }),
    ]);
    if (
      scalePlanRecord &&
      (scalePlanRecord.brokerAccountId !== account.id || scalePlanRecord.symbol !== symbol)
    ) {
      throw new BadRequestException("Predefined Scale Plan 与账户或标的不匹配");
    }
    const currentPosition = currentPositions.find((position) => position.symbol === symbol);
    const projectedPosition = projectedPositions.find((position) => position.symbol === symbol);
    const accountEquity = toNumber(latestSnapshot.netLiquidation);
    const profitGiveback = this.profitGiveback(
      toNumber(peakPnl?.peakYtdPnl),
      toNumber(peakPnl?.currentYtdPnl),
      rules,
    );
    const exposureAfter = calculateEffectiveExposure(
      accountEquity,
      projectedPositions.map((position) => this.exposurePosition(position)),
    );
    const riskDisciplineDecision = evaluateOrderDiscipline({
      accountEquity,
      allowOvernight: dto.allowOvernight,
      currentPositionQuantity: currentPosition ? toNumber(currentPosition.quantity) : 0,
      entryPrice: referencePrice,
      estimatedFees: estimatedCommission,
      estimatedSlippage: estimatedValue * (dto.maxSlippage / 100),
      exitCondition: dto.exitCondition,
      exposureAfter,
      firstFillAt: firstFill?.executionTime ?? null,
      increasesExposure: dto.side === "BUY",
      instrument: this.instrumentMetadata(instrument),
      killSwitchLevel: (await this.ensureControl()).killSwitchLevel,
      limits,
      positionUnrealizedPnl: currentPosition
        ? (toNumber(currentPosition.marketPrice) - toNumber(currentPosition.averageCost)) *
          toNumber(currentPosition.quantity)
        : 0,
      profitGivebackState: profitGiveback.state,
      projectedPositionQuantity: projectedPosition?.quantity ?? 0,
      quantity: dto.quantity,
      scalePlan: this.scalePlanSnapshot(scalePlanRecord),
      stopPrice: dto.plannedStopPrice,
    });
    const riskApproved =
      cashAfter >= 0 &&
      riskDisciplineDecision.allowed &&
      !riskResult.alerts.some((alert) => ["DANGER", "VIOLATION"].includes(alert.level));
    const portfolioRiskApproved = await this.portfolioRiskApproved(dto);
    const dataQualityPassed = quality?.allowStrategyRun ?? false;
    const snapshot: ProposalSnapshot = {
      accountSnapshotTime: latestSnapshot.snapshotTime.toISOString(),
      dataQualityPassed,
      estimatedCashAfter: cashAfter,
      estimatedPositionAfter:
        projectedPositions.find((position) => position.symbol === symbol)?.quantity ?? 0,
      marketDataTime: latestMarket.tradeDate.toISOString(),
      portfolioRiskApproved,
      portfolioRiskDecisionId: dto.portfolioRiskDecisionId ?? null,
      referencePrice,
      riskApproved,
      riskDisciplineApproved: riskDisciplineDecision.allowed,
      riskDisciplineDecision,
      riskDecisionId: dto.riskDecisionId,
      riskResult,
      source: "IBKR_PAPER_PROPOSAL",
    };
    const proposalSnapshotJson = JSON.stringify({
      ...dto,
      estimatedCommission,
      estimatedValue,
      exposureAfter,
      profitGiveback,
      snapshot,
      symbol,
    });
    const proposalHash = stableHash(JSON.parse(proposalSnapshotJson));
    const idempotencyKey = paperProposalKey({
      brokerAccountId: dto.brokerAccountId,
      proposalVersion: dto.proposalVersion,
      side: dto.side,
      signalTradeDate: dto.signalTradeDate,
      strategyDeploymentId: dto.strategyDeploymentId,
      strategyVersion: dto.strategyVersion,
      symbol,
    });
    const existing = await this.prisma.brokerOrderProposal.findUnique({
      where: { idempotencyKey },
      include: { approvals: true, guardDecisions: true, paperOrder: true },
    });
    if (existing) return { ...this.serializeProposal(existing), idempotent: true };
    const correlationId = stableHash({ idempotencyKey, timestamp: new Date().toISOString() });
    const initialGuard = evaluateExecutionGuard({
      accountSnapshotFresh: this.isFresh(latestSnapshot.snapshotTime, 900),
      approvalValid: false,
      brokerHealthy: false,
      criticalReconciliationDifference: false,
      dailyLossExceeded: false,
      dailyNotionalExceeded: false,
      dailyOrderCountExceeded: false,
      dataQualityPassed,
      databaseHealthy: true,
      duplicateOrder: false,
      estimatedSlippageExceeded: false,
      killSwitchLevel: "LEVEL_0_NORMAL",
      losingStreakExceeded: false,
      marketDataFresh: this.matchesLatestCompletedMarketSession(latestMarket.tradeDate),
      marketDataRealtime: false,
      orderNotionalExceeded: estimatedValue > 50_000,
      paperEnvironmentPassed: account.accountType === "PAPER",
      quantEngineHealthy: false,
      spreadExceeded: false,
      submissionUnknownExists: false,
      systemLockdown: false,
    });
    const status = riskApproved && portfolioRiskApproved ? "WAITING_APPROVAL" : "RISK_REJECTED";
    const proposal = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.brokerOrderProposal.create({
        data: {
          allowPartialFill: dto.allowPartialFill,
          brokerAccountId: dto.brokerAccountId,
          contractId: dto.contractId,
          correlationId,
          estimatedCommission,
          estimatedValue,
          entryPrice: referencePrice,
          exitCondition: dto.exitCondition,
          plannedLoss: Number.isFinite(riskDisciplineDecision.budget.plannedLoss)
            ? riskDisciplineDecision.budget.plannedLoss
            : null,
          plannedLossPct: Number.isFinite(riskDisciplineDecision.budget.plannedLossPct)
            ? riskDisciplineDecision.budget.plannedLossPct
            : null,
          plannedStopPrice: dto.plannedStopPrice,
          allowOvernight: dto.allowOvernight,
          gapStressJson: riskDisciplineDecision.gapStress
            ? JSON.stringify(riskDisciplineDecision.gapStress)
            : null,
          predefinedScalePlanId: scalePlanRecord?.id,
          predefinedScaleVersion: scalePlanRecord?.version,
          expirationTime: new Date(dto.expirationTime),
          expiresAt: new Date(dto.expirationTime),
          idempotencyKey,
          limitPrice: dto.limitPrice,
          maxSlippage: dto.maxSlippage,
          orderType: dto.orderType,
          outsideRth: dto.outsideRth,
          portfolioId: dto.portfolioId,
          portfolioRiskDecisionId: dto.portfolioRiskDecisionId,
          proposalHash,
          proposalSnapshotJson,
          proposalVersion: dto.proposalVersion,
          quantity: dto.quantity,
          riskDecisionId: dto.riskDecisionId,
          side: dto.side,
          signalId: dto.signalId,
          status,
          stopPrice: dto.stopPrice,
          strategyDeploymentId: dto.strategyDeploymentId,
          strategyId: dto.strategyId,
          strategyVersion: dto.strategyVersion,
          symbol,
          timeInForce: dto.timeInForce,
        },
      });
      await transaction.executionGuardDecision.create({
        data: {
          accountSnapshotTime: latestSnapshot.snapshotTime,
          checksJson: JSON.stringify(initialGuard.checks),
          correlationId,
          decision: status === "RISK_REJECTED" ? "REJECTED" : "PENDING_APPROVAL",
          marketDataTime: latestMarket.tradeDate,
          proposalId: created.id,
          reason: status === "RISK_REJECTED" ? "RiskEngine 或 PortfolioRiskEngine 拒绝" : null,
        },
      });
      await this.audit(transaction, {
        accountId: account.id,
        actorId: "system",
        correlationId,
        eventType: status === "RISK_REJECTED" ? "BROKER_PROPOSAL_RISK_REJECTED" : "BROKER_PROPOSAL_CREATED",
        message: `${symbol} ${dto.side} IBKR Paper 订单建议已创建`,
        severity: status === "RISK_REJECTED" ? "CRITICAL" : "INFO",
      });
      const disciplineEvents = riskDisciplineDecision.allowed
        ? [{ code: "ORDER_DISCIPLINE_APPROVED", message: "Risk Discipline 硬门禁全部通过" }]
        : riskDisciplineDecision.hardBlockReasons;
      for (const reason of disciplineEvents) {
        const eventKey = riskDisciplineEventKey({
          decision: riskDisciplineDecision.allowed ? "APPROVED" : "BLOCKED",
          proposalKey: idempotencyKey,
          ruleCode: reason.code,
        });
        await transaction.riskDisciplineEvent.upsert({
          where: { idempotencyKey: eventKey },
          update: {},
          create: {
            actorId: "system",
            brokerAccountId: account.id,
            decision: riskDisciplineDecision.allowed ? "APPROVED" : "BLOCKED",
            eventType: riskDisciplineDecision.allowed
              ? "ORDER_DISCIPLINE_APPROVED"
              : "ORDER_DISCIPLINE_BLOCKED",
            idempotencyKey: eventKey,
            newValueJson: JSON.stringify({
              budget: riskDisciplineDecision.budget,
              exposureAfter,
              gapStress: riskDisciplineDecision.gapStress,
            }),
            occurredAt: new Date(),
            proposalId: created.id,
            reason: reason.message,
            ruleCode: reason.code,
            severity: riskDisciplineDecision.allowed ? "INFO" : "CRITICAL",
          },
        });
      }
      return created;
    });
    return this.serializeProposal({ ...proposal, approvals: [], guardDecisions: [], paperOrder: null });
  }

  async decideProposal(id: string, dto: DecideBrokerOrderProposalDto) {
    const proposal = await this.prisma.brokerOrderProposal.findUnique({ where: { id } });
    if (!proposal) throw new BadRequestException("订单建议不存在");
    if (!new Set(["WAITING_APPROVAL", "APPROVED"]).has(proposal.status)) {
      throw new BadRequestException("当前状态不允许审批");
    }
    const expected = `${dto.decision === "APPROVE" ? "APPROVE" : "REJECT"} IBKR PAPER ${proposal.symbol}`;
    if (dto.confirmationText !== expected) throw new BadRequestException("二次确认文本不匹配");
    if (proposal.expiresAt <= new Date()) throw new BadRequestException("订单建议已过期");
    const decisionStatus = dto.decision === "APPROVE" ? "APPROVED" : "REJECTED";
    return this.prisma.$transaction(async (transaction) => {
      const approval = await transaction.brokerOrderApproval.create({
        data: {
          actorId: dto.actorId,
          approvedAt: dto.decision === "APPROVE" ? new Date() : null,
          confirmationHash: stableHash(dto.confirmationText),
          decision: dto.decision,
          expiresAt: proposal.expiresAt,
          proposalId: proposal.id,
          proposalSnapshotHash: proposal.proposalHash,
          reason: dto.reason,
        },
      });
      await transaction.brokerOrderProposal.update({
        where: { id },
        data: { status: decisionStatus },
      });
      await this.audit(transaction, {
        accountId: proposal.brokerAccountId,
        actorId: dto.actorId,
        correlationId: proposal.correlationId,
        eventType: `BROKER_PROPOSAL_${decisionStatus}`,
        message: `${proposal.symbol} IBKR Paper 建议已由人工${dto.decision === "APPROVE" ? "批准" : "拒绝"}`,
        severity: dto.decision === "APPROVE" ? "INFO" : "WARNING",
      });
      return approval;
    });
  }

  async submitProposal(id: string, dto: SubmitBrokerPaperOrderDto) {
    const proposal = await this.prisma.brokerOrderProposal.findUnique({
      where: { id },
      include: {
        approvals: { orderBy: { createdAt: "desc" } },
        guardDecisions: { orderBy: { createdAt: "desc" } },
        paperOrder: true,
      },
    });
    if (!proposal) throw new BadRequestException("订单建议不存在");
    if (dto.confirmationText !== `SEND IBKR PAPER ${proposal.symbol}`) {
      throw new BadRequestException("发送 Paper 订单的二次确认文本不匹配");
    }
    if (proposal.paperOrder) {
      if (new Set(["SUBMISSION_UNKNOWN", "UNKNOWN"]).has(proposal.paperOrder.status)) {
        throw new BadRequestException("订单提交结果未知，必须先恢复查询，禁止直接重试");
      }
      return { idempotent: true, order: this.serializeOrder(proposal.paperOrder) };
    }
    const [connection, account, control, readiness, capabilities, health] = await Promise.all([
      this.prisma.brokerConnection.findUnique({ where: { id: CONNECTION_ID } }),
      this.prisma.brokerAccount.findUnique({
        where: { id: proposal.brokerAccountId },
        include: {
          snapshots: { orderBy: { snapshotTime: "desc" }, take: 1 },
          positionSnapshots: { orderBy: { snapshotTime: "desc" }, take: 100 },
        },
      }),
      this.ensureControl(),
      this.brokerSync.readiness(),
      this.connector.capabilities(),
      this.connector.health(),
    ]);
    if (!connection || !account) throw new BadRequestException("Paper 连接或账户不存在");
    this.assertPaperCapabilities(capabilities);
    const currentDiscipline = await this.currentProposalDiscipline(
      proposal,
      control.killSwitchLevel,
    );
    if (!currentDiscipline.allowed) {
      await this.persistBlockedDisciplineDecision(
        proposal,
        currentDiscipline,
        dto.actorId,
        "SUBMIT_REVALIDATION",
      );
    }
    const approval = proposal.approvals.find((item) => item.decision === "APPROVE");
    const approvalValid = Boolean(
      approval &&
        approval.approvedAt &&
        approval.expiresAt > new Date() &&
        approval.proposalSnapshotHash === proposal.proposalHash,
    );
    const snapshot = JSON.parse(proposal.proposalSnapshotJson) as {
      snapshot: ProposalSnapshot;
    };
    const allowedHashes = new Set(
      this.config
        .get<string>("BROKER_PAPER_ACCOUNT_HASH_ALLOWLIST", "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
    const input = this.connectorInput(proposal, account.externalAccountId);
    const preview = await this.connector.preview(input).catch(() => null);
    const duplicate = await this.prisma.brokerPaperOrder.findFirst({
      where: {
        brokerAccountId: proposal.brokerAccountId,
        idempotencyKey: paperOrderKey(proposal.idempotencyKey),
        status: { in: ACTIVE_ORDER_STATUSES },
      },
    });
    const unknownExists = await this.prisma.brokerPaperOrder.count({
      where: {
        brokerAccountId: proposal.brokerAccountId,
        status: { in: ["BROKER_CONFIRMATION_REQUIRED", "SUBMISSION_UNKNOWN", "UNKNOWN"] },
      },
    });
    const criticalDifference = await this.prisma.brokerPaperReconciliationDifference.count({
      where: { severity: "CRITICAL", status: "OPEN", paperOrder: { brokerAccountId: proposal.brokerAccountId } },
    });
    const [databaseHealthy, quantEngineHealthy] = await Promise.all([
      this.databaseHealthy(),
      this.serviceHealthy(this.config.get<string>("QUANT_ENGINE_URL", "http://localhost:5091") + "/health"),
    ]);
    const latestQuality = await this.prisma.dataQualityReport.findFirst({
      where: { symbol: proposal.symbol },
      orderBy: { analysisDate: "desc" },
    });
    const latestMarket = await this.prisma.marketDataDaily.findFirst({
      where: { symbol: proposal.symbol },
      orderBy: { tradeDate: "desc" },
    });
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const [dailyOrders, dailyExecutions, recentCommissions] = await Promise.all([
      this.prisma.brokerPaperOrder.count({ where: { brokerAccountId: proposal.brokerAccountId, createdAt: { gte: todayStart } } }),
      this.prisma.brokerPaperExecution.findMany({
        where: { paperOrder: { brokerAccountId: proposal.brokerAccountId }, executionTime: { gte: todayStart } },
        select: { price: true, quantity: true },
      }),
      this.prisma.brokerPaperCommission.findMany({
        where: { execution: { paperOrder: { brokerAccountId: proposal.brokerAccountId } }, realizedPnl: { not: null } },
        orderBy: { reportTime: "desc" },
        select: { realizedPnl: true, reportTime: true },
        take: 20,
      }),
    ]);
    const estimatedDailyNotional = dailyExecutions.reduce(
      (total, execution) => total + toNumber(execution.quantity) * toNumber(execution.price),
      0,
    );
    const dailyRealizedPnl = recentCommissions
      .filter((commission) => commission.reportTime >= todayStart)
      .reduce((total, commission) => total + toNumber(commission.realizedPnl), 0);
    let consecutiveLosses = 0;
    for (const commission of recentCommissions) {
      if (toNumber(commission.realizedPnl) >= 0) break;
      consecutiveLosses += 1;
    }
    const protectedOrders = await this.prisma.brokerPaperOrder.findMany({
      where: { brokerAccountId: proposal.brokerAccountId, side: "BUY", filledQuantity: { gt: 0 } }, include: { executions: true },
    });
    const unsafeProtection = protectedOrders.some((order) => !protectiveStopCompliant({
      filledQuantity: toNumber(order.filledQuantity),
      closedQuantity: order.executions.filter((fill) => fill.executionRole === "PROTECTION").reduce((sum, fill) => sum + toNumber(fill.quantity), 0),
      stopQuantity: order.protectiveStopQuantity === null ? null : toNumber(order.protectiveStopQuantity),
      stopStatus: order.protectiveStopStatus, stopPrice: order.protectiveStopPrice === null ? null : toNumber(order.protectiveStopPrice),
      stopObservedAt: order.protectiveStopLatestStatusAt,
    }));
    const annualEvidence = await this.prisma.profitGivebackSnapshot.findFirst({ where: { accountId: proposal.brokerAccountId, pnlYear: new Date().getUTCFullYear(), pnlCoverage: "VERIFIED_YEARLY_STATEMENT" }, orderBy: { snapshotDate: "desc" } });
    const guard = evaluateExecutionGuard({
      annualProfitContextKnown: Boolean(annualEvidence),
      accountSnapshotFresh: Boolean(account.snapshots[0] && this.isFresh(account.snapshots[0].snapshotTime, 900)),
      approvalValid,
      brokerHealthy: health.status === "OK",
      criticalReconciliationDifference: criticalDifference > 0 || unsafeProtection,
      dailyLossExceeded: dailyRealizedPnl <= -5_000,
      dailyNotionalExceeded: estimatedDailyNotional + toNumber(proposal.estimatedValue) > 100_000,
      dailyOrderCountExceeded: dailyOrders >= 20,
      dataQualityPassed: latestQuality?.allowStrategyRun ?? false,
      databaseHealthy,
      duplicateOrder: Boolean(duplicate),
      estimatedSlippageExceeded:
        !preview || preview.estimatedSlippagePercent > toNumber(proposal.maxSlippage),
      killSwitchLevel: control.killSwitchLevel,
      losingStreakExceeded: consecutiveLosses >= 5,
      marketDataFresh: Boolean(
        latestMarket &&
          this.matchesLatestCompletedMarketSession(latestMarket.tradeDate) &&
          preview &&
          this.isFresh(new Date(preview.marketDataTime), 60),
      ),
      marketDataRealtime: verifiedRealtimeQuote(preview ?? {}),
      orderNotionalExceeded: toNumber(proposal.estimatedValue) > 50_000,
      paperEnvironmentPassed:
        connection.runMode === "IBKR_PAPER" &&
        connection.environment === "PAPER" &&
        account.accountType === "PAPER" && account.dataOrigin === "IBKR_PAPER" &&
        allowedHashes.has(account.externalAccountId),
      quantEngineHealthy,
      spreadExceeded: !preview || preview.spreadPercent > 1,
      submissionUnknownExists: unknownExists > 0,
      systemLockdown:
        connection.safetyState === "LOCKDOWN" || control.killSwitchLevel === "LEVEL_4_LOCKDOWN",
    });
    const readinessApproved = paperReadinessAllowsObservation(
      String((readiness as { infrastructure?: { status?: string } }).infrastructure?.status ?? ""),
    );
    const gate = evaluateSubmissionGate({
      accountAllowlisted: allowedHashes.has(account.externalAccountId),
      accountType: account.accountType,
      approvalSnapshotMatches: approval?.proposalSnapshotHash === proposal.proposalHash,
      approvalValid,
      connectorEnvironment: connection.environment,
      executionGuardApproved: guard.allowed,
      killSwitchLevel: control.killSwitchLevel,
      portfolioRiskApproved: snapshot.snapshot.portfolioRiskApproved,
      readinessApproved,
      riskApproved: snapshot.snapshot.riskApproved && currentDiscipline.allowed,
      runMode: connection.runMode,
      safetyState: connection.safetyState,
    });
    await this.prisma.executionGuardDecision.create({
      data: {
        accountSnapshotTime: account.snapshots[0]?.snapshotTime,
        checksJson: JSON.stringify([...guard.checks, ...gate.checks]),
        correlationId: proposal.correlationId,
        decision: gate.allowed ? "APPROVED" : "REJECTED",
        marketDataTime: latestMarket?.tradeDate,
        proposalId: proposal.id,
        reason: gate.allowed
          ? null
          : [...guard.checks, ...gate.checks]
              .filter((item) => !item.passed)
              .map((item) => item.message)
              .join("；"),
      },
    });
    if (!gate.allowed || !killSwitchAllowsOrder({ isClosing: dto.isClosing, isNewEntry: !dto.isClosing, level: control.killSwitchLevel })) {
      await this.incident({
        accountId: proposal.brokerAccountId,
        correlationId: proposal.correlationId,
        impact: "订单未发送至 IBKR Paper",
        incidentType: "EXECUTION_GUARD_FAILURE",
        proposalId: proposal.id,
        severity: "CRITICAL",
      });
      throw new BadRequestException("ExecutionGuard 或 Paper 双重环境门禁拒绝订单");
    }
    const order = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.brokerPaperOrder.create({
        data: {
          allowPartialFill: proposal.allowPartialFill,
          brokerAccountId: proposal.brokerAccountId,
          correlationId: proposal.correlationId,
          idempotencyKey: paperOrderKey(proposal.idempotencyKey),
          limitPrice: proposal.limitPrice,
          orderType: proposal.orderType,
          outsideRth: proposal.outsideRth,
          protectiveStopPrice: proposal.plannedStopPrice,
          proposalId: proposal.id,
          quantity: proposal.quantity,
          remainingQuantity: proposal.quantity,
          side: proposal.side,
          status: "SUBMITTING",
          stopPrice: proposal.stopPrice,
          submissionAttempt: 1,
          symbol: proposal.symbol,
          timeInForce: proposal.timeInForce,
        },
      });
      await transaction.brokerOrderProposal.update({ where: { id }, data: { status: "SUBMITTING" } });
      await this.audit(transaction, {
        accountId: proposal.brokerAccountId,
        actorId: dto.actorId,
        correlationId: proposal.correlationId,
        eventType: "BROKER_PAPER_SUBMITTING",
        message: "人工批准的 IBKR Paper 订单开始提交",
        severity: "INFO",
      });
      return created;
    });
    let remote: ConnectorPaperOrderState;
    try {
      remote = await this.connector.placePaperOrder(input);
    } catch (error) {
      if (error instanceof SubmissionUnknownError) {
        await this.markSubmissionUnknown(order.id, proposal, error.message);
        throw new ServiceUnavailableException(error.message);
      }
      const message = this.safeMessage(error);
      await this.prisma.$transaction(async (transaction) => {
        await transaction.brokerPaperOrder.update({
          where: { id: order.id },
          data: { errorMessage: message, status: "FAILED" },
        });
        await transaction.brokerOrderProposal.update({ where: { id }, data: { status: "FAILED" } });
      });
      await this.incident({
        accountId: proposal.brokerAccountId,
        correlationId: proposal.correlationId,
        impact: "Paper 订单提交失败且未写入任何真实账户账本",
        incidentType: "ORDER_REJECTED",
        orderId: order.id,
        proposalId: proposal.id,
        severity: "CRITICAL",
      });
      throw new ServiceUnavailableException(message);
    }
    let updated: BrokerPaperOrder;
    try {
      updated = await this.persistRemoteState(order.id, remote, dto.actorId);
    } catch {
      await this.markSubmissionUnknown(
        order.id,
        proposal,
        "券商已响应订单提交，但本地持久化结果未知，禁止重提",
      );
      throw new ServiceUnavailableException("券商已响应，但本地订单状态未知，必须先对账");
    }
    if (remote.externalOrderId) {
      try {
        await this.reconcileOrder(updated.id, remote);
      } catch {
        await this.incident({
          accountId: proposal.brokerAccountId,
          correlationId: proposal.correlationId,
          impact: "Paper 订单已保存，但首次对账失败；禁止重提订单",
          incidentType: "RECONCILIATION_MISMATCH",
          orderId: order.id,
          proposalId: proposal.id,
          severity: "CRITICAL",
        });
        throw new ServiceUnavailableException("Paper 订单已提交但首次对账失败，禁止重提");
      }
    }
    return { idempotent: false, order: this.serializeOrder(updated) };
  }

  async confirmBrokerReply(id: string, dto: ConfirmBrokerPaperReplyDto) {
    const order = await this.orderBundle(id);
    if (
      order.status !== "BROKER_CONFIRMATION_REQUIRED" ||
      !order.brokerReplyId ||
      !order.brokerReplyMessage
    ) {
      throw new BadRequestException("当前订单没有待人工确认的 IBKR 警告");
    }
    const expected = `CONFIRM IBKR WARNING ${order.symbol}`;
    if (dto.confirmationText !== expected) {
      throw new BadRequestException("IBKR 警告确认文本不匹配");
    }
    const approval = await this.prisma.brokerOrderApproval.findFirst({
      where: {
        decision: "APPROVE",
        proposalId: order.proposalId,
        proposalSnapshotHash: order.proposal.proposalHash,
      },
      orderBy: { createdAt: "desc" },
    });
    if (!approval?.approvedAt || approval.expiresAt <= new Date()) {
      throw new BadRequestException("原订单人工审批已经失效，禁止确认券商警告");
    }
    const account = await this.paperAccount(order.brokerAccountId);
    await this.assertPaperOperationContext(account, false);
    const input = this.connectorInput(order.proposal, account.externalAccountId);
    const claimed = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.brokerPaperOrder.updateMany({
        where: {
          brokerReplyId: order.brokerReplyId,
          id: order.id,
          status: "BROKER_CONFIRMATION_REQUIRED",
        },
        data: {
          errorMessage: "IBKR 警告确认请求正在发送；进程中断时按提交结果未知处理",
          status: "SUBMISSION_UNKNOWN",
          submissionAttempt: { increment: 1 },
        },
      });
      if (result.count === 1) {
        await this.audit(transaction, {
          accountId: order.brokerAccountId,
          actorId: dto.actorId,
          correlationId: order.correlationId,
          eventType: "BROKER_PAPER_REPLY_CONFIRMING",
          message: "操作者已阅读 IBKR 警告，确认请求开始发送",
          severity: "WARNING",
        });
      }
      return result.count;
    });
    if (claimed !== 1) throw new BadRequestException("IBKR 警告已被其他请求处理，禁止重复确认");
    let remote: ConnectorPaperOrderState;
    try {
      remote = await this.connector.confirmPaperOrderReply(order.brokerReplyId, input);
    } catch (error) {
      if (error instanceof SubmissionUnknownError) {
        await this.markSubmissionUnknown(order.id, order.proposal, error.message);
        throw new ServiceUnavailableException(error.message);
      }
      const message = this.safeMessage(error);
      if (message.includes("IBKR Paper 拒绝订单")) {
        await this.prisma.$transaction(async (transaction) => {
          await transaction.brokerPaperOrder.update({
            where: { id: order.id },
            data: { brokerReplyId: null, errorMessage: message, status: "REJECTED" },
          });
          await transaction.brokerOrderProposal.update({
            where: { id: order.proposalId },
            data: { status: "FAILED" },
          });
        });
        await this.incident({
          accountId: order.brokerAccountId,
          correlationId: order.correlationId,
          impact: "人工确认警告后订单被 IBKR Paper 明确拒绝",
          incidentType: "ORDER_REJECTED",
          orderId: order.id,
          proposalId: order.proposalId,
          severity: "CRITICAL",
        });
        throw new ServiceUnavailableException(message);
      }
      await this.prisma.brokerPaperOrder.updateMany({
        where: { id: order.id, status: "SUBMISSION_UNKNOWN" },
        data: {
          errorMessage: "IBKR 返回额外警告，必须人工阅读并单独确认",
          status: "BROKER_CONFIRMATION_REQUIRED",
        },
      });
      throw error;
    }
    let updated: BrokerPaperOrder;
    try {
      updated = await this.persistRemoteState(
        order.id,
        remote,
        dto.actorId,
        "人工阅读 IBKR 警告后独立确认",
      );
    } catch {
      await this.markSubmissionUnknown(
        order.id,
        order.proposal,
        "券商已响应警告确认，但本地持久化结果未知，禁止再次确认",
      );
      throw new ServiceUnavailableException("IBKR 警告确认后的本地状态未知，必须先对账");
    }
    if (remote.externalOrderId) await this.reconcileOrder(updated.id, remote);
    return { order: this.serializeOrder(updated) };
  }

  async modifyOrder(id: string, dto: ModifyBrokerPaperOrderDto) {
    const order = await this.orderBundle(id);
    if (!order.externalOrderId) throw new BadRequestException("券商订单 ID 缺失，禁止修改");
    if (dto.confirmationText !== `MODIFY IBKR PAPER ${order.symbol}`) {
      throw new BadRequestException("改单二次确认文本不匹配");
    }
    const currentPosition = await this.prisma.brokerPositionSnapshot.findFirst({
      where: { brokerAccountId: order.brokerAccountId, symbol: order.symbol },
      orderBy: { snapshotTime: "desc" },
    });
    const positionQuantity = currentPosition ? toNumber(currentPosition.quantity) : 0;
    const bracketProtectiveStop =
      positionQuantity !== 0 && Boolean(order.protectiveStopExternalOrderId);
    const protectiveStop =
      bracketProtectiveStop ||
      positionQuantity !== 0 &&
      order.side === "SELL" &&
      new Set(["STOP", "STOP_LIMIT"]).has(order.orderType);
    const amendment = evaluateRiskAmendment({
      cancelStop: dto.cancelStop ?? false,
      currentQuantity: toNumber(order.quantity),
      currentStopPrice: bracketProtectiveStop
        ? order.protectiveStopPrice === null
          ? null
          : toNumber(order.protectiveStopPrice)
        : order.stopPrice === null
          ? null
          : toNumber(order.stopPrice),
      increasesExposure: bracketProtectiveStop ? false : order.side === "BUY",
      newQuantity: dto.quantity,
      newStopPrice: dto.cancelStop ? null : dto.stopPrice,
      positionDirection: positionQuantity < 0 ? "SHORT" : "LONG",
      protectiveStop,
      unrealizedPnl: currentPosition ? toNumber(currentPosition.unrealizedPnl) : 0,
    });
    if (!amendment.allowed) {
      const idempotencyKey = riskDisciplineEventKey({
        amendment: {
          cancelStop: dto.cancelStop ?? false,
          quantity: dto.quantity,
          stopPrice: dto.stopPrice ?? null,
        },
        orderId: order.id,
        ruleCode: amendment.code,
      });
      await this.prisma.riskDisciplineEvent.upsert({
        where: { idempotencyKey },
        update: {},
        create: {
          actorId: dto.actorId,
          brokerAccountId: order.brokerAccountId,
          brokerPaperOrderId: order.id,
          decision: "BLOCKED",
          eventType: "RISK_INCREASING_AMENDMENT",
          idempotencyKey,
          newValueJson: JSON.stringify({
            cancelStop: dto.cancelStop ?? false,
            quantity: dto.quantity,
            stopPrice: dto.stopPrice ?? null,
          }),
          occurredAt: new Date(),
          oldValueJson: JSON.stringify({
            quantity: toNumber(order.quantity),
            stopPrice: bracketProtectiveStop
              ? order.protectiveStopPrice === null
                ? null
                : toNumber(order.protectiveStopPrice)
              : order.stopPrice === null
                ? null
                : toNumber(order.stopPrice),
          }),
          reason: amendment.reasons.join("；"),
          ruleCode: amendment.code,
          severity: "CRITICAL",
        },
      });
      throw new BadRequestException(`RISK_INCREASING_AMENDMENT：${amendment.reasons.join("；")}`);
    }
    const account = await this.paperAccount(order.brokerAccountId);
    await this.assertPaperOperationContext(account, false);
    if (bracketProtectiveStop) {
      if (!order.protectiveStopExternalOrderId || !(Number(dto.stopPrice) > 0)) {
        throw new BadRequestException("保护性 Stop 改单必须提供新的止损价");
      }
      const input = this.connectorInput(
        {
          ...order.proposal,
          limitPrice: null,
          plannedStopPrice: null,
          quantity: new Prisma.Decimal(dto.quantity),
          orderType: "STOP",
          parentOrderId: order.externalOrderId,
          side: "SELL",
          stopPrice: dto.stopPrice!,
        },
        account.externalAccountId,
      );
      const remote = await this.connector.modifyPaperOrder(
        order.protectiveStopExternalOrderId,
        input,
      );
      return this.persistProtectiveStopState(
        order.id,
        { ...remote, protectiveStopPrice: dto.stopPrice },
        dto.actorId,
      );
    }
    const input = this.connectorInput(
      {
        ...order.proposal,
        limitPrice: dto.limitPrice ?? order.limitPrice,
        quantity: new Prisma.Decimal(dto.quantity),
        stopPrice: dto.stopPrice ?? order.stopPrice,
      },
      account.externalAccountId,
    );
    const remote = await this.connector.modifyPaperOrder(order.externalOrderId, input);
    return this.persistRemoteState(order.id, remote, dto.actorId);
  }

  async cancelOrder(id: string, dto: CancelBrokerPaperOrderDto) {
    const order = await this.orderBundle(id);
    if (!order.externalOrderId) throw new BadRequestException("券商订单 ID 缺失，禁止撤单");
    if (dto.confirmationText !== `CANCEL IBKR PAPER ${order.symbol}`) {
      throw new BadRequestException("撤单二次确认文本不匹配");
    }
    const currentPosition = await this.prisma.brokerPositionSnapshot.findFirst({
      where: { brokerAccountId: order.brokerAccountId, symbol: order.symbol },
      orderBy: { snapshotTime: "desc" },
    });
    if (
      currentPosition &&
      toNumber(currentPosition.quantity) !== 0 &&
      (Boolean(order.protectiveStopExternalOrderId) ||
        (order.side === "SELL" && new Set(["STOP", "STOP_LIMIT"]).has(order.orderType)))
    ) {
      const idempotencyKey = riskDisciplineEventKey({
        orderId: order.id,
        phase: "CANCEL_PROTECTIVE_STOP",
        ruleCode: "RISK_INCREASING_AMENDMENT",
      });
      await this.prisma.riskDisciplineEvent.upsert({
        where: { idempotencyKey },
        update: {},
        create: {
          actorId: dto.actorId,
          brokerAccountId: order.brokerAccountId,
          brokerPaperOrderId: order.id,
          decision: "BLOCKED",
          eventType: "RISK_INCREASING_AMENDMENT",
          idempotencyKey,
          newValueJson: JSON.stringify({ cancelled: true }),
          occurredAt: new Date(),
          oldValueJson: JSON.stringify({
            orderType: order.orderType,
            quantity: toNumber(order.quantity),
            stopPrice:
              order.protectiveStopPrice === null
                ? order.stopPrice === null
                  ? null
                  : toNumber(order.stopPrice)
                : toNumber(order.protectiveStopPrice),
          }),
          reason: `成交后禁止取消保护性 Stop：${dto.reason}`,
          ruleCode: "RISK_INCREASING_AMENDMENT",
          severity: "CRITICAL",
        },
      });
      throw new BadRequestException("RISK_INCREASING_AMENDMENT：成交后禁止取消保护性 Stop");
    }
    const account = await this.paperAccount(order.brokerAccountId);
    await this.assertPaperOperationContext(account, true);
    await this.prisma.brokerPaperOrder.update({ where: { id }, data: { status: "PENDING_CANCEL" } });
    const remote = await this.connector.cancelPaperOrder(order.externalOrderId, {
      accountRef: account.externalAccountId,
      accountType: "PAPER",
      correlationId: order.correlationId,
    });
    return this.persistRemoteState(order.id, remote, dto.actorId, dto.reason);
  }

  async syncPaperOrders() {
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this.syncPaperOrdersOnce();
    try { return await this.syncPromise; } finally { this.syncPromise = null; }
  }

  private async syncPaperOrdersOnce() {
    const connection = await this.prisma.brokerConnection.findUnique({ where: { id: CONNECTION_ID } });
    if (!connection?.enabled || connection.environment !== "PAPER" || connection.runMode !== "IBKR_PAPER") {
      throw new BadRequestException("Paper synchronization requires an explicitly enabled Paper connection");
    }
    const hashes = this.config.get<string>("BROKER_PAPER_ACCOUNT_HASH_ALLOWLIST", "").split(",").map((v) => v.trim()).filter(Boolean);
    const accounts = await this.prisma.brokerAccount.findMany({ where: { brokerConnectionId: CONNECTION_ID, accountType: "PAPER", dataOrigin: "IBKR_PAPER", externalAccountId: { in: hashes } } });
    if (accounts.length !== 1) throw new BadRequestException("Paper identity is ambiguous, unknown or synthetic");
    const brokerAccountId = accounts[0]!.id;
    // TWS open/completed order callbacks have no request IDs. Keep these reads sequential.
    const openOrders = await this.connector.openOrders();
    const completedOrders = await this.connector.completedOrders();
    const executions = await this.connector.executions();
    const accountSummary = await this.connector.accountSummary();
    const positions = await this.connector.positions();
    await this.persistExecutions(executions as Array<Record<string, unknown>>, brokerAccountId);
    const remoteOrders = [...openOrders, ...completedOrders] as Array<Record<string, unknown>>;
    const localOrders = await this.prisma.brokerPaperOrder.findMany({
      where: { brokerAccountId, externalOrderId: { not: null } },
      include: { proposal: true },
    });
    const results: unknown[] = [];
    for (const order of localOrders) {
      const remote = matchBrokerOrderIdentity(remoteOrders, { socketId: order.externalOrderId, permanentId: order.externalPermanentId, orderRef: order.idempotencyKey });
      if (remote) {
        const state = this.stateFromUnknown(remote, order.externalOrderId!);
        results.push(await this.persistRemoteState(order.id, state, "system-sync"));
        await this.reconcileOrder(order.id, state);
      }
      if (order.protectiveStopExternalOrderId) {
        const protectiveRemote = matchBrokerOrderIdentity(remoteOrders, { socketId: order.protectiveStopExternalOrderId, permanentId: order.protectiveStopPermanentId, orderRef: `${order.idempotencyKey}:PROTECTIVE_STOP` });
        if (protectiveRemote) {
          const state = this.stateFromUnknown(
            protectiveRemote,
            order.protectiveStopExternalOrderId,
          );
          results.push(await this.persistProtectiveStopState(order.id, state, "system-sync"));
        }
      }
    }
    await this.persistPaperAccountSnapshot(accountSummary, positions);
    return {
      completedCount: completedOrders.length,
      executionCount: executions.length,
      openCount: openOrders.length,
      positionCount: positions.length,
      results,
    };
  }

  @Cron("0 * * * * *")
  async scheduledPaperAccountSync() {
    if (process.env.PUBLIC_DEMO_READ_ONLY === "true") return;
    if (this.paperSyncInFlight) return;
    const connection = await this.prisma.brokerConnection.findUnique({
      where: { id: CONNECTION_ID },
      select: { enabled: true, environment: true, runMode: true },
    });
    if (
      !connection?.enabled ||
      connection.environment !== "PAPER" ||
      connection.runMode !== "IBKR_PAPER"
    ) {
      return;
    }
    this.paperSyncInFlight = true;
    try {
      await this.syncPaperOrders();
    } catch (error) {
      this.logger.warn(
        `IBKR Paper 自动同步失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.paperSyncInFlight = false;
    }
  }

  private async persistPaperAccountSnapshot(
    summary: ConnectorPaperAccountSummary,
    positions: ConnectorPaperPosition[],
  ) {
    const allowedHashes = new Set(
      this.config
        .get<string>("BROKER_PAPER_ACCOUNT_HASH_ALLOWLIST", "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
    const accounts = await this.prisma.brokerAccount.findMany({
      where: { brokerConnectionId: CONNECTION_ID, dataOrigin: "IBKR_PAPER", accountType: "PAPER", externalAccountId: { in: [...allowedHashes] } },
    });
    if (accounts.length !== 1) {
      throw new BadRequestException("Paper 账户白名单必须且只能匹配一个本地 BrokerAccount");
    }
    const account = accounts[0]!;
    const snapshotTime = new Date(summary.snapshotTime);
    if (
      Number.isNaN(snapshotTime.getTime()) ||
      Date.now() - snapshotTime.getTime() > 90_000 || snapshotTime.getTime() - Date.now() > 5_000
    ) {
      throw new BadRequestException("IBKR Paper 账户快照时间无效或过期");
    }
    const numericSummary = [
      summary.availableFunds,
      summary.buyingPower,
      summary.grossPositionValue,
      summary.netLiquidation,
      summary.realizedPnl,
      summary.settledCash,
      summary.totalCash,
      summary.unrealizedPnl,
    ];
    if (numericSummary.some((value) => !Number.isFinite(value)) || summary.totalCash < 0) {
      throw new BadRequestException("IBKR Paper 账户摘要包含无效数值或负现金");
    }
    for (const position of positions) {
      if (
        !position.symbol ||
        !position.externalContractId ||
        [
          position.averageCost,
          position.marketPrice,
          position.marketValue,
          position.quantity,
          position.unrealizedPnl,
        ].some((value) => !Number.isFinite(value))
      ) {
        throw new BadRequestException("IBKR Paper 持仓包含未知标的或无效数值");
      }
    }
    const instruments = await this.prisma.instrument.findMany({
      where: { symbol: { in: positions.map((position) => position.symbol.toUpperCase()) } },
    });
    const instrumentBySymbol = new Map(
      instruments.map((instrument) => [instrument.symbol, instrument]),
    );
    const idempotencyKey = `BROKER_PAPER_ACCOUNT_SYNC:${account.id}:${snapshotTime.toISOString()}`;
    await this.prisma.$transaction(async (transaction) => {
      const job = await transaction.brokerSyncJob.upsert({
        where: { idempotencyKey },
        update: {},
        create: {
          accountCount: 1,
          brokerConnectionId: CONNECTION_ID,
          completedAt: new Date(),
          idempotencyKey,
          positionCount: positions.length,
          requestedFrom: snapshotTime,
          requestedTo: snapshotTime,
          resultJson: JSON.stringify({ source: "IBKR_PAPER_EXECUTION_SYNC" }),
          snapshotCount: 1,
          startedAt: new Date(),
          status: "COMPLETED",
        },
      });
      await transaction.brokerAccountSnapshot.upsert({
        where: {
          brokerAccountId_snapshotTime: { brokerAccountId: account.id, snapshotTime },
        },
        update: {},
        create: {
          availableFunds: summary.availableFunds,
          brokerAccountId: account.id,
          buyingPower: summary.buyingPower,
          currency: summary.baseCurrency,
          grossPositionValue: summary.grossPositionValue,
          netLiquidation: summary.netLiquidation,
          realizedPnl: summary.realizedPnl,
          settledCash: summary.settledCash,
          snapshotTime,
          source: "IBKR_PAPER_EXECUTION_SYNC",
          syncJobId: job.id,
          totalCash: summary.totalCash,
          unrealizedPnl: summary.unrealizedPnl,
        },
      });
      await transaction.brokerCashBalance.upsert({
        where: {
          brokerAccountId_currency_snapshotTime: {
            brokerAccountId: account.id,
            currency: summary.baseCurrency,
            snapshotTime,
          },
        },
        update: {},
        create: {
          availableCash: summary.availableFunds,
          brokerAccountId: account.id,
          currency: summary.baseCurrency,
          settledCash: summary.settledCash,
          snapshotTime,
          syncJobId: job.id,
          totalCash: summary.totalCash,
        },
      });
      for (const position of positions) {
        const symbol = position.symbol.toUpperCase();
        const instrument = instrumentBySymbol.get(symbol);
        await transaction.brokerPositionSnapshot.upsert({
          where: {
            brokerAccountId_symbol_snapshotTime: {
              brokerAccountId: account.id,
              snapshotTime,
              symbol,
            },
          },
          update: {},
          create: {
            averageCost: position.averageCost,
            brokerAccountId: account.id,
            currency: position.currency,
            externalContractId: position.externalContractId,
            instrumentId: instrument?.id,
            mappingStatus: instrument ? "MAPPED" : "PENDING_REVIEW",
            marketPrice: position.marketPrice,
            marketValue: position.marketValue,
            quantity: position.quantity,
            snapshotTime,
            symbol,
            syncJobId: job.id,
            unrealizedPnl: position.unrealizedPnl,
          },
        });
      }
      await transaction.brokerAccount.update({
        where: { id: account.id },
        data: { lastSyncedAt: snapshotTime, status: "CURRENT" },
      });
      await this.audit(transaction, {
        accountId: account.id,
        actorId: "system-sync",
        correlationId: stableHash(idempotencyKey),
        eventType: "BROKER_PAPER_ACCOUNT_SNAPSHOT_SYNCED",
        message: "IBKR Paper 账户现金与持仓快照已按券商事实幂等回写",
        severity: "INFO",
      });
    });
  }

  async recover() {
    const health = await this.connector.health();
    if (health.status !== "OK") throw new ServiceUnavailableException("Broker Connector 尚未恢复");
    const capabilities = await this.connector.capabilities();
    this.assertPaperCapabilities(capabilities);
    const result = await this.syncPaperOrders();
    const unknown = await this.prisma.brokerPaperOrder.findMany({
      where: { status: { in: ["SUBMISSION_UNKNOWN", "UNKNOWN"] } },
    });
    for (const order of unknown) {
      if (!order.externalOrderId) continue;
      try {
        const remote = await this.connector.orderStatus(order.externalOrderId);
        await this.persistRemoteState(order.id, remote, "system-recovery", "恢复连接后以券商状态修复");
      } catch {
        // 未确认状态继续保持阻塞，不重新提交。
      }
    }
    return { ...result, recoveryRule: "先查询、对账和风控重算，绝不自动重提失败订单" };
  }

  async updateKillSwitch(dto: UpdateExecutionKillSwitchDto) {
    if (dto.confirmationText !== `SET ${dto.level}`) {
      throw new BadRequestException("Kill Switch 二次确认文本不匹配");
    }
    const current = await this.ensureControl();
    const updated = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.brokerExecutionControl.update({
        where: { id: CONTROL_ID },
        data: {
          confirmationHash: stableHash(dto.confirmationText),
          killSwitchLevel: dto.level,
          operatorId: dto.actorId,
          previousStateJson: JSON.stringify(current),
          reason: dto.reason,
          safetyState: dto.level === "LEVEL_4_LOCKDOWN" ? "LOCKDOWN" : "READ_ONLY",
        },
      });
      if (dto.level === "LEVEL_4_LOCKDOWN") {
        await transaction.brokerConnection.update({
          where: { id: CONNECTION_ID },
          data: { safetyState: "LOCKDOWN" },
        });
      }
      if (dto.level === "LEVEL_0_NORMAL") {
        await transaction.brokerConnection.update({
          where: { id: CONNECTION_ID },
          data: { safetyState: "READ_ONLY" },
        });
      }
      await this.audit(transaction, {
        actorId: dto.actorId,
        correlationId: stableHash({ level: dto.level, time: new Date().toISOString() }),
        eventType: "EXECUTION_KILL_SWITCH_CHANGED",
        message: `执行 Kill Switch 已调整为 ${dto.level}：${dto.reason}`,
        severity: dto.level === "LEVEL_0_NORMAL" ? "INFO" : "CRITICAL",
      });
      return result;
    });
    if (dto.level === "LEVEL_2_CANCEL_OPEN_ORDERS") await this.cancelAllOpenOrders(dto.actorId);
    const closeSuggestions =
      dto.level === "LEVEL_3_CLOSE_PAPER_POSITIONS"
        ? await this.connector.positions().catch(() => [])
        : [];
    return { control: updated, closeSuggestions, requiresManualApproval: dto.level === "LEVEL_3_CLOSE_PAPER_POSITIONS" };
  }

  async recordBackupRecovery(dto: RecordBackupRecoveryDto) {
    const referenceHash = dto.backupReference ? stableHash(dto.backupReference) : null;
    return this.prisma.backupRecoveryRun.create({
      data: {
        actorId: dto.actorId,
        backupReferenceHash: referenceHash,
        completedAt: new Set(["FAILED", "SUCCEEDED", "VERIFIED"]).has(dto.status) ? new Date() : null,
        errorMessage: dto.errorMessage ? this.safeMessage(dto.errorMessage) : null,
        operation: dto.operation,
        startedAt: new Date(),
        status: dto.status,
        targetDatabase: dto.targetDatabase,
        verificationJson: dto.verificationJson,
      },
    });
  }

  async monitor() {
    const started = Date.now();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1_000);
    const [
      connector,
      quant,
      database,
      pendingUnknown,
      incidentCount,
      reconciliation,
      recentIncidents,
      latestMarket,
      latestOrder,
      submittedOrders,
      taskTotal,
      taskFailures,
      auditCount,
      control,
    ] = await Promise.all([
      this.connectorStatus(),
      this.serviceHealthy(
        this.config.get<string>("QUANT_ENGINE_URL", "http://localhost:5091") + "/health",
      ),
      this.databaseHealthy(),
      this.prisma.brokerPaperOrder.count({
        where: { status: { in: ["SUBMISSION_UNKNOWN", "UNKNOWN"] } },
      }),
      this.prisma.executionIncident.count({ where: { status: "OPEN" } }),
      this.prisma.brokerPaperReconciliationDifference.count({ where: { status: "OPEN" } }),
      this.prisma.executionIncident.findMany({ orderBy: { occurredAt: "desc" }, take: 8 }),
      this.prisma.marketDataDaily.findFirst({ orderBy: { tradeDate: "desc" } }),
      this.prisma.brokerPaperOrder.findFirst({ orderBy: { latestStatusAt: "desc" } }),
      this.prisma.brokerPaperOrder.findMany({
        where: { submittedAt: { not: null } },
        orderBy: { submittedAt: "desc" },
        select: { createdAt: true, submittedAt: true },
        take: 50,
      }),
      this.prisma.systemTask.count({ where: { createdAt: { gte: since } } }),
      this.prisma.systemTask.count({ where: { createdAt: { gte: since }, status: "FAILED" } }),
      this.prisma.brokerAuditLog.count({ where: { createdAt: { gte: since } } }),
      this.ensureControl(),
    ]);
    const submissionDurations = submittedOrders
      .filter((order) => order.submittedAt)
      .map((order) => Math.max(0, order.submittedAt!.getTime() - order.createdAt.getTime()));
    const averageSubmissionLatencyMs = submissionDurations.length
      ? Math.round(
          submissionDurations.reduce((total, duration) => total + duration, 0) /
            submissionDurations.length,
        )
      : null;
    const requestErrorRate =
      auditCount + incidentCount > 0 ? incidentCount / (auditCount + incidentCount) : 0;
    return {
      apiLatencyMs: Date.now() - started,
      averageSubmissionLatencyMs,
      brokerConnector: connector,
      correlationTracking: true,
      database: { latencyMs: Date.now() - started, status: database ? "OK" : "ERROR" },
      executionIncidents: incidentCount,
      ibkrHeartbeatAt: connector.health.checkedAt ?? null,
      killSwitchLevel: control.killSwitchLevel,
      latestOrderStatusAt: latestOrder?.latestStatusAt ?? null,
      marketDataLatencyHours: latestMarket
        ? Math.max(0, (Date.now() - latestMarket.tradeDate.getTime()) / 3_600_000)
        : null,
      openReconciliationDifferences: reconciliation,
      quantEngine: { status: quant ? "OK" : "ERROR" },
      recentIncidents,
      requestErrorRate,
      safetyState: control.safetyState,
      submissionUnknown: pendingUnknown,
      taskFailureRate: taskTotal > 0 ? taskFailures / taskTotal : 0,
    };
  }

  private async portfolioRiskApproved(dto: CreateBrokerOrderProposalDto) {
    if (!dto.portfolioId) return true;
    if (!dto.portfolioRiskDecisionId) return false;
    const [portfolio, member, run] = await Promise.all([
      this.prisma.strategyPortfolio.findUnique({ where: { id: dto.portfolioId } }),
      this.prisma.portfolioStrategy.findFirst({
        where: { portfolioId: dto.portfolioId, strategyId: dto.strategyId, status: "ACTIVE" },
      }),
      this.prisma.portfolioRebalanceRun.findUnique({ where: { id: dto.portfolioRiskDecisionId } }),
    ]);
    if (!portfolio || !member || !run || run.portfolioId !== dto.portfolioId) return false;
    if (!new Set(["PAPER_APPROVED", "PAPER_RUNNING"]).has(portfolio.status)) return false;
    try {
      return Boolean((JSON.parse(run.riskResultJson) as { allowed?: boolean }).allowed);
    } catch {
      return false;
    }
  }

  private async currentProposalDiscipline(
    proposal: BrokerOrderProposal,
    killSwitchLevel: string,
  ): Promise<OrderDisciplineDecision> {
    const [account, instruments, rules, scalePlanRecord, firstFill, peakPnl] = await Promise.all([
      this.prisma.brokerAccount.findUnique({
        where: { id: proposal.brokerAccountId },
        include: {
          positionSnapshots: { orderBy: { snapshotTime: "desc" }, take: 100 },
          snapshots: { orderBy: { snapshotTime: "desc" }, take: 1 },
        },
      }),
      this.prisma.instrument.findMany({ where: { isActive: true } }),
      this.prisma.riskRule.findMany({ where: { enabled: true } }),
      proposal.predefinedScalePlanId
        ? this.prisma.predefinedScalePlan.findUnique({
            where: { id: proposal.predefinedScalePlanId },
          })
        : null,
      this.prisma.brokerExecution.findFirst({
        where: { brokerAccountId: proposal.brokerAccountId, symbol: proposal.symbol },
        orderBy: { executionTime: "asc" },
        select: { executionTime: true },
      }),
      this.prisma.profitGivebackSnapshot.findFirst({
        where: { accountId: proposal.brokerAccountId, pnlYear: new Date().getUTCFullYear(), pnlCoverage: "VERIFIED_YEARLY_STATEMENT" }, orderBy: { snapshotDate: "desc" },
      }),
    ]);
    const latestSnapshot = account?.snapshots[0];
    const instrument = instruments.find((item) => item.symbol === proposal.symbol);
    if (!account || !latestSnapshot || !instrument) {
      return {
        allowed: false,
        budget: {
          allowed: false,
          limitPct: 0,
          plannedLoss: Number.POSITIVE_INFINITY,
          plannedLossPct: Number.POSITIVE_INFINITY,
          reasons: ["MISSING_RISK_CONTEXT"],
        },
        gapStress: null,
        hardBlockReasons: [
          { code: "MISSING_RISK_CONTEXT", message: "发送前风险上下文不完整，默认拒绝。" },
        ],
      };
    }
    const entryPrice = toNumber(
      proposal.entryPrice ?? proposal.limitPrice ?? proposal.stopPrice ?? new Prisma.Decimal(0),
    );
    const currentPositions = this.latestPositions(account.positionSnapshots);
    const projectedPositions = this.projectPositions(
      currentPositions,
      instrument,
      proposal.side,
      toNumber(proposal.quantity),
      entryPrice,
      instruments,
    );
    const currentPosition = currentPositions.find((position) => position.symbol === proposal.symbol);
    const projectedPosition = projectedPositions.find((position) => position.symbol === proposal.symbol);
    const accountEquity = toNumber(latestSnapshot.netLiquidation);
    const limits = disciplineLimits(
      rules.map((rule) => ({
        code: rule.code,
        enabled: rule.enabled,
        limitValue: toNumber(rule.limitValue),
      })),
    );
    const profitGiveback = this.profitGiveback(
      toNumber(peakPnl?.peakYtdPnl),
      toNumber(peakPnl?.currentYtdPnl),
      rules,
    );
    return evaluateOrderDiscipline({
      accountEquity,
      allowOvernight: proposal.allowOvernight ?? undefined,
      currentPositionQuantity: currentPosition ? toNumber(currentPosition.quantity) : 0,
      entryPrice,
      estimatedFees: toNumber(proposal.estimatedCommission),
      estimatedSlippage:
        toNumber(proposal.estimatedValue) * (toNumber(proposal.maxSlippage) / 100),
      exitCondition: proposal.exitCondition,
      exposureAfter: calculateEffectiveExposure(
        accountEquity,
        projectedPositions.map((position) => this.exposurePosition(position)),
      ),
      firstFillAt: firstFill?.executionTime ?? null,
      increasesExposure: proposal.side === "BUY",
      instrument: this.instrumentMetadata(instrument),
      killSwitchLevel,
      limits,
      positionUnrealizedPnl: currentPosition
        ? (toNumber(currentPosition.marketPrice) - toNumber(currentPosition.averageCost)) *
          toNumber(currentPosition.quantity)
        : 0,
      profitGivebackState: profitGiveback.state,
      projectedPositionQuantity: projectedPosition?.quantity ?? 0,
      quantity: toNumber(proposal.quantity),
      scalePlan: this.scalePlanSnapshot(scalePlanRecord),
      stopPrice:
        proposal.plannedStopPrice === null ? undefined : toNumber(proposal.plannedStopPrice),
    });
  }

  private async persistBlockedDisciplineDecision(
    proposal: BrokerOrderProposal,
    decision: OrderDisciplineDecision,
    actorId: string,
    phase: string,
  ) {
    for (const reason of decision.hardBlockReasons) {
      const idempotencyKey = riskDisciplineEventKey({
        phase,
        proposalId: proposal.id,
        ruleCode: reason.code,
        snapshotHash: proposal.proposalHash,
      });
      await this.prisma.riskDisciplineEvent.upsert({
        where: { idempotencyKey },
        update: {},
        create: {
          actorId,
          brokerAccountId: proposal.brokerAccountId,
          decision: "BLOCKED",
          eventType: "ORDER_DISCIPLINE_BLOCKED",
          idempotencyKey,
          newValueJson: JSON.stringify({ budget: decision.budget, gapStress: decision.gapStress }),
          occurredAt: new Date(),
          proposalId: proposal.id,
          reason: reason.message,
          ruleCode: reason.code,
          severity: "CRITICAL",
        },
      });
    }
  }

  private latestPositions(
    rows: Array<{
      averageCost: Prisma.Decimal;
      instrumentId: string | null;
      marketPrice: Prisma.Decimal;
      quantity: Prisma.Decimal;
      symbol: string;
    }>,
  ) {
    const seen = new Set<string>();
    return rows.filter((row) => {
      if (seen.has(row.symbol)) return false;
      seen.add(row.symbol);
      return true;
    });
  }

  private instrumentMetadata(instrument: {
    direction: string;
    industry: string | null;
    leveragedETF: boolean;
    leverageMultiplier: Prisma.Decimal;
    riskTheme: string | null;
    sector: string | null;
    symbol: string;
    theme: string | null;
    underlyingSymbol: string | null;
  }): InstrumentRiskMetadata {
    return {
      direction: instrument.direction,
      industry: instrument.industry,
      leveragedETF: instrument.leveragedETF,
      leverageMultiplier: toNumber(instrument.leverageMultiplier),
      riskTheme: instrument.riskTheme ?? instrument.theme,
      sector: instrument.sector,
      symbol: instrument.symbol,
      underlyingSymbol: instrument.underlyingSymbol ?? instrument.symbol,
    };
  }

  private exposurePosition(position: RiskPositionInput) {
    return {
      direction: position.direction ?? "LONG",
      industry: position.industry ?? position.category,
      leveragedETF: position.leveragedETF ?? position.assetType === "LEVERAGED_ETF",
      leverageMultiplier: position.leverageMultiplier ?? 1,
      marketValue: position.quantity * position.currentPrice,
      riskTheme: position.riskTheme ?? position.theme,
      sector: position.sector ?? position.category,
      symbol: position.symbol,
      underlyingSymbol: position.underlyingSymbol ?? position.symbol,
    };
  }

  private scalePlanSnapshot(
    plan:
      | {
          allowOvernight: boolean;
          approvedAt: Date;
          createdAt: Date;
          expiresAt: Date | null;
          finalStopPrice: Prisma.Decimal;
          firstFilledAt: Date | null;
          id: string;
          maxAccountRiskPct: Prisma.Decimal;
          maxPrincipalPercent: Prisma.Decimal;
          maxTotalQuantity: Prisma.Decimal;
          status: string;
          tranchesJson: string;
          version: number;
        }
      | null,
  ): ScalePlanSnapshot | null {
    if (!plan) return null;
    let tranches: Array<{ price: number; quantity: number }> = [];
    try {
      const parsed = JSON.parse(plan.tranchesJson) as Array<{ price?: unknown; quantity?: unknown }>;
      if (Array.isArray(parsed)) {
        tranches = parsed
          .map((item) => ({ price: Number(item.price), quantity: Number(item.quantity) }))
          .filter((item) => item.price > 0 && item.quantity > 0);
      }
    } catch {
      tranches = [];
    }
    return {
      allowOvernight: plan.allowOvernight,
      approvedAt: plan.approvedAt,
      createdAt: plan.createdAt,
      expiresAt: plan.expiresAt,
      finalStopPrice: toNumber(plan.finalStopPrice),
      firstFilledAt: plan.firstFilledAt,
      id: plan.id,
      maxAccountRiskPct: toNumber(plan.maxAccountRiskPct),
      maxPrincipalPercent: toNumber(plan.maxPrincipalPercent),
      maxTotalQuantity: toNumber(plan.maxTotalQuantity),
      status: plan.status,
      tranches,
      version: plan.version,
    };
  }

  private profitGiveback(
    peakYtdPnl: number,
    currentYtdPnl: number,
    rules: Array<{ code: string; enabled: boolean; limitValue: Prisma.Decimal }>,
  ): ProfitGivebackResult {
    const enabled = new Map(
      rules.filter((rule) => rule.enabled).map((rule) => [rule.code, toNumber(rule.limitValue)]),
    );
    return calculateProfitGiveback({
      currentYtdPnl,
      defensivePct: enabled.get("PROFIT_GIVEBACK_DEFENSIVE_PCT") ?? 25,
      killSwitchPct: enabled.get("PROFIT_GIVEBACK_KILL_SWITCH_PCT") ?? 40,
      peakYtdPnl: Math.max(peakYtdPnl, currentYtdPnl),
      reducedRiskPct: enabled.get("PROFIT_GIVEBACK_REDUCED_RISK_PCT") ?? 15,
    });
  }

  private projectPositions(
    rows: ReturnType<BrokerPaperService["latestPositions"]>,
    instrument: {
      assetType: string;
      category: string | null;
      direction: string;
      id: string;
      industry: string | null;
      leveragedETF: boolean;
      leverageMultiplier: Prisma.Decimal;
      name: string | null;
      riskTheme: string | null;
      sector: string | null;
      symbol: string;
      theme: string | null;
      underlyingSymbol: string | null;
    },
    side: string,
    quantity: number,
    referencePrice: number,
    instruments: Array<{
      assetType: string;
      category: string | null;
      direction: string;
      id: string;
      industry: string | null;
      leveragedETF: boolean;
      leverageMultiplier: Prisma.Decimal;
      name: string | null;
      riskTheme: string | null;
      sector: string | null;
      symbol: string;
      theme: string | null;
      underlyingSymbol: string | null;
    }>,
  ): RiskPositionInput[] {
    const instrumentBySymbol = new Map(instruments.map((item) => [item.symbol, item]));
    const positions: RiskPositionInput[] = rows.map((row) => {
      const metadata = instrumentBySymbol.get(row.symbol);
      return {
        assetType: metadata?.assetType ?? "STOCK",
        avgCost: toNumber(row.averageCost),
        category: metadata?.category ?? null,
        currentPrice: toNumber(row.marketPrice),
        direction: metadata?.direction ?? "LONG",
        id: row.instrumentId ?? metadata?.id ?? `broker-${row.symbol}`,
        industry: metadata?.industry ?? null,
        leveragedETF: metadata?.leveragedETF ?? false,
        leverageMultiplier: metadata ? toNumber(metadata.leverageMultiplier) : 1,
        name: metadata?.name ?? row.symbol,
        quantity: toNumber(row.quantity),
        riskTheme: metadata?.riskTheme ?? metadata?.theme ?? null,
        sector: metadata?.sector ?? metadata?.category ?? null,
        symbol: row.symbol,
        theme: metadata?.theme ?? null,
        underlyingSymbol: metadata?.underlyingSymbol ?? row.symbol,
      };
    });
    const existing = positions.find((row) => row.symbol === instrument.symbol);
    const delta = side === "BUY" ? quantity : -quantity;
    if (!existing) {
      if (delta < 0) throw new BadRequestException("禁止裸空");
      positions.push({
        assetType: instrument.assetType,
        avgCost: referencePrice,
        category: instrument.category,
        currentPrice: referencePrice,
        direction: instrument.direction,
        id: instrument.id,
        industry: instrument.industry,
        leveragedETF: instrument.leveragedETF,
        leverageMultiplier: toNumber(instrument.leverageMultiplier),
        name: instrument.name ?? instrument.symbol,
        quantity: delta,
        riskTheme: instrument.riskTheme ?? instrument.theme,
        sector: instrument.sector ?? instrument.category,
        symbol: instrument.symbol,
        theme: instrument.theme,
        underlyingSymbol: instrument.underlyingSymbol ?? instrument.symbol,
      });
    } else {
      if (existing.quantity + delta < 0) throw new BadRequestException("禁止裸空");
      existing.quantity += delta;
      existing.currentPrice = referencePrice;
    }
    return positions.filter((row) => row.quantity > 0);
  }

  private connectorInput(
    proposal: {
      allowPartialFill: boolean;
      contractId: string;
      correlationId: string;
      idempotencyKey: string;
      limitPrice: Prisma.Decimal | number | null;
      maxSlippage: Prisma.Decimal;
      orderType: string;
      outsideRth: boolean;
      parentOrderId?: string;
      plannedStopPrice?: Prisma.Decimal | number | null;
      proposalHash: string;
      quantity: Prisma.Decimal;
      side: string;
      stopPrice: Prisma.Decimal | number | null;
      symbol: string;
      timeInForce: string;
    },
    accountRef: string,
  ): ConnectorPaperOrderInput {
    return {
      accountRef,
      accountType: "PAPER",
      allowPartialFill: proposal.allowPartialFill,
      approvalSnapshotHash: proposal.proposalHash,
      contractId: proposal.contractId,
      correlationId: proposal.correlationId,
      idempotencyKey: paperOrderKey(proposal.idempotencyKey),
      limitPrice: proposal.limitPrice === null ? undefined : toNumber(proposal.limitPrice),
      maxSlippage: toNumber(proposal.maxSlippage),
      orderType: proposal.orderType as ConnectorPaperOrderInput["orderType"],
      outsideRth: proposal.outsideRth,
      parentOrderId: proposal.parentOrderId,
      protectiveStopPrice:
        proposal.plannedStopPrice === null || proposal.plannedStopPrice === undefined
          ? undefined
          : toNumber(proposal.plannedStopPrice),
      quantity: toNumber(proposal.quantity),
      side: proposal.side as "BUY" | "SELL",
      stopPrice: proposal.stopPrice === null ? undefined : toNumber(proposal.stopPrice),
      symbol: proposal.symbol,
      timeInForce: proposal.timeInForce,
    };
  }

  private async persistRemoteState(
    id: string,
    remote: ConnectorPaperOrderState,
    actorId: string,
    reason?: string,
  ) {
    const order = await this.prisma.brokerPaperOrder.findUnique({
      where: { id },
      include: { proposal: true },
    });
    if (!order) throw new BadRequestException("Paper 订单不存在");
    const status = orderLifecycleStatus({
      current: order.status,
      externalStatus: remote.status,
      filledQuantity: remote.filledQuantity,
      quantity: toNumber(order.quantity),
    });
    return this.prisma.$transaction(async (transaction) => {
      const duplicateEvent = await transaction.brokerPaperOrderEvent.findFirst({
        where: { id: stableHash({ orderId: id, role: status.startsWith("PROTECTIVE_STOP_") ? "PROTECTION" : "ENTRY", externalOrderId: remote.externalOrderId, permanentId: remote.externalPermanentId, status, filled: remote.filledQuantity, remaining: remote.remainingQuantity, average: remote.averageFillPrice, stop: remote.protectiveStopPrice, reason: reason ?? remote.reason }) },
      });
      if (duplicateEvent) {
        await transaction.brokerPaperOrder.update({ where: { id }, data: {
          protectiveStopLatestStatusAt: status.startsWith("PROTECTIVE_STOP_") ? new Date() : undefined,
        } });
        return order;
      }
      if (!duplicateEvent) {
        await transaction.brokerPaperOrderEvent.create({
          data: {
            id: stableHash({ orderId: id, role: status.startsWith("PROTECTIVE_STOP_") ? "PROTECTION" : "ENTRY", externalOrderId: remote.externalOrderId, permanentId: remote.externalPermanentId, status, filled: remote.filledQuantity, remaining: remote.remainingQuantity, average: status.startsWith("PROTECTIVE_STOP_") ? undefined : remote.averageFillPrice, stop: remote.protectiveStopPrice, reason: status.startsWith("PROTECTIVE_STOP_") ? undefined : reason ?? remote.reason }),
            averageFillPrice: remote.averageFillPrice,
            brokerPaperOrderId: id,
            connectorVersion: "1.8.0",
            correlationId: order.correlationId,
            eventTime: new Date(remote.updatedAt),
            externalOrderId: remote.externalOrderId,
            externalPermanentId: remote.externalPermanentId,
            filledQuantity: remote.filledQuantity,
            lastFillPrice: remote.lastFillPrice,
            rawDataHash: remote.rawDataHash,
            reason: reason ?? remote.reason,
            remainingQuantity: remote.remainingQuantity,
            status,
          },
        });
      }
      const updated = await transaction.brokerPaperOrder.update({
        where: { id },
        data: {
          averageFillPrice: remote.averageFillPrice,
          brokerReplyId: status === "BROKER_CONFIRMATION_REQUIRED" ? remote.brokerReplyId : null,
          brokerReplyMessage:
            status === "BROKER_CONFIRMATION_REQUIRED"
              ? JSON.stringify({
                  messageIds: remote.brokerReplyMessageIds ?? [],
                  messages: remote.brokerReplyMessages ?? [],
                })
              : null,
          brokerReplyReceivedAt:
            status === "BROKER_CONFIRMATION_REQUIRED" ? new Date(remote.updatedAt) : null,
          errorMessage:
            status === "BROKER_CONFIRMATION_REQUIRED"
              ? "IBKR 返回额外警告，必须人工阅读并单独确认"
              : null,
          externalOrderId: remote.externalOrderId,
          externalPermanentId: remote.externalPermanentId,
          protectiveStopExternalOrderId: remote.protectiveStopExternalOrderId,
          protectiveStopLatestStatusAt: remote.protectiveStopStatus
            ? new Date(remote.updatedAt)
            : undefined,
          protectiveStopPermanentId: remote.protectiveStopPermanentId,
          protectiveStopPrice: remote.protectiveStopPrice,
          protectiveStopStatus: remote.protectiveStopStatus,
          protectiveStopQuantity: remote.protectiveStopQuantity,
          filledQuantity: remote.filledQuantity,
          lastFillPrice: remote.lastFillPrice,
          latestStatusAt: new Date(remote.updatedAt),
          remainingQuantity: remote.remainingQuantity,
          status,
          submittedAt:
            status === "BROKER_CONFIRMATION_REQUIRED" ? order.submittedAt : order.submittedAt ?? new Date(),
        },
      });
      await transaction.brokerOrderProposal.update({
        where: { id: order.proposalId },
        data: {
          status:
            status === "CANCELLED"
              ? "CANCELLED"
              : status === "BROKER_CONFIRMATION_REQUIRED"
                ? "BROKER_CONFIRMATION_REQUIRED"
                : "SUBMITTED_TO_PAPER",
        },
      });
      await this.audit(transaction, {
        idempotencyKey: stableHash({ orderId: id, status, filled: remote.filledQuantity, remaining: remote.remainingQuantity, price: remote.protectiveStopPrice, externalOrderId: remote.externalOrderId }),
        details: { oldValue: order, newValue: remote, reason: remote.reason, actorId },
        accountId: order.brokerAccountId,
        actorId,
        correlationId: order.correlationId,
        eventType: `BROKER_PAPER_ORDER_${status}`,
        message: `IBKR Paper 订单状态更新为 ${status}`,
        severity: new Set(["FAILED", "REJECTED", "UNKNOWN"]).has(status)
          ? "CRITICAL"
          : status === "BROKER_CONFIRMATION_REQUIRED"
            ? "WARNING"
            : "INFO",
      });
      return updated;
    });
  }

  private async persistProtectiveStopState(
    id: string,
    remote: ConnectorPaperOrderState,
    actorId: string,
  ) {
    const order = await this.prisma.brokerPaperOrder.findUnique({ where: { id } });
    if (!order) throw new BadRequestException("Paper 订单不存在");
    const status = `PROTECTIVE_STOP_${remote.status}`;
    return this.prisma.$transaction(async (transaction) => {
      const duplicateEvent = await transaction.brokerPaperOrderEvent.findFirst({
        where: { id: stableHash({ orderId: id, role: "PROTECTION", externalOrderId: remote.externalOrderId, permanentId: remote.externalPermanentId, status, filled: remote.filledQuantity, remaining: remote.remainingQuantity, average: undefined, stop: remote.protectiveStopPrice, reason: undefined }) },
      });
      if (duplicateEvent) {
        await transaction.brokerPaperOrder.update({ where: { id }, data: {
          protectiveStopLatestStatusAt: new Date(remote.updatedAt),
        } });
        return order;
      }
      if (!duplicateEvent) {
        await transaction.brokerPaperOrderEvent.create({
          data: {
            id: stableHash({ orderId: id, role: status.startsWith("PROTECTIVE_STOP_") ? "PROTECTION" : "ENTRY", externalOrderId: remote.externalOrderId, permanentId: remote.externalPermanentId, status, filled: remote.filledQuantity, remaining: remote.remainingQuantity, average: status.startsWith("PROTECTIVE_STOP_") ? undefined : remote.averageFillPrice, stop: remote.protectiveStopPrice, reason: undefined }),
            averageFillPrice: remote.averageFillPrice,
            brokerPaperOrderId: id,
            connectorVersion: "1.10.0",
            correlationId: order.correlationId,
            eventTime: new Date(remote.updatedAt),
            externalOrderId: remote.externalOrderId,
            externalPermanentId: remote.externalPermanentId,
            filledQuantity: remote.filledQuantity,
            lastFillPrice: remote.lastFillPrice,
            rawDataHash: remote.rawDataHash,
            reason: "原子括号订单的保护性 Stop 状态",
            remainingQuantity: remote.remainingQuantity,
            status,
          },
        });
      }
      const updated = await transaction.brokerPaperOrder.update({
        where: { id },
        data: {
          protectiveStopExternalOrderId: remote.externalOrderId,
          protectiveStopLatestStatusAt: new Date(remote.updatedAt),
          protectiveStopPermanentId: remote.externalPermanentId,
          protectiveStopPrice: remote.protectiveStopPrice ?? order.protectiveStopPrice,
          protectiveStopStatus: remote.status,
          protectiveStopQuantity: remote.remainingQuantity,
        },
      });
      await this.audit(transaction, {
        idempotencyKey: stableHash({ orderId: id, status, filled: remote.filledQuantity, remaining: remote.remainingQuantity, price: remote.protectiveStopPrice, externalOrderId: remote.externalOrderId }),
        details: { oldValue: order, newValue: remote, reason: remote.reason, actorId },
        accountId: order.brokerAccountId,
        actorId,
        correlationId: order.correlationId,
        eventType: status,
        message: `IBKR Paper 保护性 Stop 状态更新为 ${remote.status}`,
        severity: new Set(["CANCELLED", "FAILED", "INACTIVE", "REJECTED", "UNKNOWN"]).has(
          remote.status,
        )
          ? "CRITICAL"
          : "INFO",
      });
      return updated;
    });
  }

  private async persistExecutions(rows: Array<Record<string, unknown>>, brokerAccountId: string) {
    for (const row of rows) {
      const externalOrderId = String(row.externalOrderId ?? row.orderId ?? "");
      const orderRef = String(row.orderReference ?? "");
      const permanentId = String(row.externalPermanentId ?? "");
      const candidates = await this.prisma.brokerPaperOrder.findMany({ where: { brokerAccountId, OR: [
        ...(externalOrderId ? [{ externalOrderId }, { protectiveStopExternalOrderId: externalOrderId }] : []),
        ...(orderRef ? [{ idempotencyKey: orderRef.replace(/:PROTECTIVE_STOP$/, "") }] : []),
        ...(permanentId ? [{ externalPermanentId: permanentId }, { protectiveStopPermanentId: permanentId }] : []),
      ] }, include: { proposal: true } });
      if (candidates.length !== 1) {
        if (candidates.length > 1) throw new BadRequestException("Execution identity maps to multiple orders");
        continue;
      }
      const order = candidates[0]!;
      const protection = externalOrderId === order.protectiveStopExternalOrderId || orderRef.endsWith(":PROTECTIVE_STOP") || (permanentId && permanentId === order.protectiveStopPermanentId);
      const expectedSocketId = protection ? order.protectiveStopExternalOrderId : order.externalOrderId;
      const expectedPermanentId = protection ? order.protectiveStopPermanentId : order.externalPermanentId;
      const expectedRef = `${order.idempotencyKey}${protection ? ":PROTECTIVE_STOP" : ""}`;
      // Every supplied identity must agree, including after a reconnect reassigns a socket ID.
      if ((orderRef && orderRef !== expectedRef) ||
          (permanentId && expectedPermanentId && permanentId !== expectedPermanentId) ||
          (externalOrderId && expectedSocketId && externalOrderId !== expectedSocketId)) {
        throw new BadRequestException("Execution identifiers conflict; reconciliation required before ledger writes");
      }
      const executionTime = new Date(String(row.executionTime ?? row.time ?? ""));
      const quantity = Number(row.quantity), price = Number(row.price), side = String(row.side);
      if (!Number.isFinite(executionTime.getTime()) || !Number.isFinite(quantity) || !Number.isFinite(price) || !(quantity > 0) || !(price > 0) || !["BUY", "SELL"].includes(side) || String(row.symbol) !== order.symbol || side !== (protection ? (order.side === "BUY" ? "SELL" : "BUY") : order.side)) {
        throw new BadRequestException("Invalid or mismatched execution; no ledger writes permitted");
      }
      const key = stableHash({ brokerAccountId, key: executionKey({ externalExecutionId: String(row.externalExecutionId ?? row.executionId ?? "") || null, externalOrderId, price, quantity, side, symbol: String(row.symbol), time: executionTime.toISOString() }) });
      const previous = await this.prisma.brokerPaperExecution.findUnique({ where: { deduplicationKey: key } });
      if (previous && (previous.brokerPaperOrderId !== order.id || toNumber(previous.quantity) !== quantity || toNumber(previous.price) !== price || previous.side !== side || previous.executionTime.getTime() !== executionTime.getTime())) {
        throw new BadRequestException("Execution ID conflicts with persisted fill facts; no ledger overwrite permitted");
      }
      const execution = await this.prisma.brokerPaperExecution.upsert({ where: { deduplicationKey: key }, update: {}, create: {
        brokerPaperOrderId: order.id, executionRole: protection ? "PROTECTION" : "ENTRY", externalOrderId, externalPermanentId: permanentId || null,
        correlationId: order.correlationId, currency: String(row.currency ?? "USD"), deduplicationKey: key,
        exchange: String(row.exchange ?? "UNKNOWN"), executionTime, externalExecutionId: String(row.externalExecutionId ?? row.executionId ?? "") || null,
        price, quantity, rawDataHash: stableHash(row), side, symbol: String(row.symbol),
      } });
      if (row.commission !== null && row.commission !== undefined && Number.isFinite(Number(row.commission))) {
        const commissionKey = stableHash({ executionKey: key, role: "COMMISSION" });
        const commissionData = { amount: Number(row.commission), currency: String(row.currency ?? "USD"),
          realizedPnl: row.realizedPnl !== null && row.realizedPnl !== undefined && Number.isFinite(Number(row.realizedPnl)) ? Number(row.realizedPnl) : null,
          externalReportId: String(row.commissionReportId ?? row.externalExecutionId ?? "") || null, rawDataHash: stableHash({ commission: row.commission, realizedPnl: row.realizedPnl }) };
        await this.prisma.brokerPaperCommission.upsert({ where: { deduplicationKey: commissionKey }, update: commissionData, create: {
          ...commissionData, deduplicationKey: commissionKey, brokerPaperExecutionId: execution.id,
          correlationId: order.correlationId, reportTime: executionTime,
        } });
      }
      const fills = await this.prisma.brokerPaperExecution.findMany({ where: { brokerPaperOrderId: order.id, executionRole: "ENTRY" } });
      const average = weightedAverageFills(fills.map((fill) => ({ price: toNumber(fill.price), quantity: toNumber(fill.quantity) })));
      await this.prisma.brokerPaperOrder.update({ where: { id: order.id }, data: {
        averageFillPrice: average.averagePrice, filledQuantity: average.filledQuantity,
        remainingQuantity: Math.max(0, toNumber(order.quantity) - average.filledQuantity),
        status: average.filledQuantity >= toNumber(order.quantity) ? "FILLED" : average.filledQuantity > 0 ? "PARTIALLY_FILLED" : order.status,
      } });
      if (!protection && order.proposal.predefinedScalePlanId) await this.prisma.predefinedScalePlan.updateMany({
        where: { firstFilledAt: null, id: order.proposal.predefinedScalePlanId, status: "APPROVED" }, data: { firstFilledAt: executionTime, lockedAt: executionTime },
      });
    }
  }

  private async reconcileOrder(orderId: string, remote: ConnectorPaperOrderState) {
    const order = await this.prisma.brokerPaperOrder.findUnique({
      where: { id: orderId },
      include: { executions: { include: { commissions: true } } },
    });
    if (!order) return;
    const localFilled = order.executions.filter((fill) => fill.executionRole === "ENTRY").reduce((sum, item) => sum + toNumber(item.quantity), 0);
    const differences = [] as Array<{
      brokerValue: string;
      differenceType: string;
      differenceValue: string;
      fieldName: string;
      localValue: string;
      reason: string;
      severity: string;
      suggestedAction: string;
    }>;
    if (Math.abs(remote.filledQuantity - localFilled) > 0.0001) {
      differences.push({
        brokerValue: String(remote.filledQuantity),
        differenceType: "PARTIAL_FILL_QUANTITY",
        differenceValue: String(remote.filledQuantity - localFilled),
        fieldName: "filledQuantity",
        localValue: String(localFilled),
        reason: "券商成交回报与本地 Execution 汇总尚未一致",
        severity: "CRITICAL",
        suggestedAction: "暂停新订单，重新同步 Executions 与佣金报告",
      });
    }
    const runId = stableHash({ orderId, localFilled, remoteFilled: remote.filledQuantity, status: remote.status, differences });
    if (await this.prisma.brokerPaperReconciliationRun.findUnique({ where: { id: runId } })) return;
    const run = await this.prisma.brokerPaperReconciliationRun.create({
      data: {
        id: runId,
        brokerAccountId: order.brokerAccountId,
        brokerPaperOrderId: order.id,
        completedAt: new Date(),
        correlationId: order.correlationId,
        criticalDifferenceCount: differences.filter((item) => item.severity === "CRITICAL").length,
        differenceCount: differences.length,
        startedAt: new Date(),
        status: differences.length ? "MISMATCH" : "MATCHED",
        summaryJson: JSON.stringify({ localFilled, remoteFilled: remote.filledQuantity }),
      },
    });
    if (!differences.length) await this.prisma.brokerPaperReconciliationDifference.updateMany({ where: { brokerPaperOrderId: orderId, status: "OPEN" }, data: { status: "RESOLVED" } });
    for (const difference of differences) {
      await this.prisma.brokerPaperReconciliationDifference.create({
        data: { ...difference, brokerPaperOrderId: order.id, reconciliationRunId: run.id },
      });
    }
  }

  private async markSubmissionUnknown(
    orderId: string,
    proposal: { brokerAccountId: string; correlationId: string; id: string },
    message: string,
  ) {
    await this.prisma.brokerPaperOrder.update({
      where: { id: orderId },
      data: {
        brokerReplyId: null,
        errorMessage: message,
        status: "SUBMISSION_UNKNOWN",
      },
    });
    await this.incident({
      accountId: proposal.brokerAccountId,
      correlationId: proposal.correlationId,
      impact: "提交是否成功未知；系统已阻止任何自动重试",
      incidentType: "SUBMISSION_UNKNOWN",
      orderId,
      proposalId: proposal.id,
      severity: "CRITICAL",
    });
  }

  private async cancelAllOpenOrders(actorId: string) {
    const orders = await this.prisma.brokerPaperOrder.findMany({
      where: { status: { in: ["PARTIALLY_FILLED", "PRE_SUBMITTED", "SUBMITTED"] } },
    });
    for (const order of orders) {
      if (!order.externalOrderId || (order.side === "BUY" && toNumber(order.filledQuantity) > 0)) continue;
      try {
        const account = await this.paperAccount(order.brokerAccountId);
        await this.assertPaperOperationContext(account, true);
        const remote = await this.connector.cancelPaperOrder(order.externalOrderId, {
          accountRef: account.externalAccountId,
          accountType: "PAPER",
          correlationId: order.correlationId,
        });
        await this.persistRemoteState(order.id, remote, actorId, "LEVEL_2 批量撤销未成交 Paper 订单");
      } catch {
        await this.incident({
          accountId: order.brokerAccountId,
          correlationId: order.correlationId,
          impact: "LEVEL_2 撤单失败，订单保持阻塞并需人工核查",
          incidentType: "BROKER_DISCONNECTED",
          orderId: order.id,
          severity: "CRITICAL",
        });
      }
    }
  }

  private async ensureControl() {
    return this.prisma.brokerExecutionControl.upsert({
      where: { id: CONTROL_ID },
      update: {},
      create: { id: CONTROL_ID, killSwitchLevel: "LEVEL_0_NORMAL", safetyState: "READ_ONLY" },
    });
  }

  private async paperAccount(id: string) {
    const account = await this.prisma.brokerAccount.findUnique({ where: { id } });
    if (!account || account.accountType !== "PAPER" || account.dataOrigin !== "IBKR_PAPER") throw new BadRequestException("Paper 账户不存在");
    return account;
  }

  private async assertPaperOperationContext(
    account: { accountType: string; dataOrigin: string; externalAccountId: string; id: string },
    cancellation: boolean,
  ) {
    const [connection, control, capabilities] = await Promise.all([
      this.prisma.brokerConnection.findUnique({ where: { id: CONNECTION_ID } }),
      this.ensureControl(),
      this.connector.capabilities(),
    ]);
    this.assertPaperCapabilities(capabilities);
    const allowed = new Set(
      this.config
        .get<string>("BROKER_PAPER_ACCOUNT_HASH_ALLOWLIST", "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
    if (
      !connection ||
      connection.runMode !== "IBKR_PAPER" ||
      connection.environment !== "PAPER" ||
      account.accountType !== "PAPER" || account.dataOrigin !== "IBKR_PAPER" ||
      !allowed.has(account.externalAccountId)
    ) {
      await this.environmentMismatch(account.id, "Paper 改单/撤单双重环境校验失败");
      throw new BadRequestException("Paper 改单/撤单双重环境校验失败");
    }
    if (
      control.killSwitchLevel === "LEVEL_4_LOCKDOWN" ||
      connection.safetyState === "LOCKDOWN" ||
      (!cancellation && control.killSwitchLevel !== "LEVEL_0_NORMAL")
    ) {
      throw new BadRequestException("当前 Kill Switch 不允许此 Paper 订单操作");
    }
  }

  private async orderBundle(id: string) {
    const order = await this.prisma.brokerPaperOrder.findUnique({
      where: { id },
      include: { proposal: true },
    });
    if (!order) throw new BadRequestException("Paper 订单不存在");
    return order;
  }

  private validateOrderType(dto: CreateBrokerOrderProposalDto) {
    if (dto.orderType === "LIMIT" && !dto.limitPrice) throw new BadRequestException("限价单必须填写限价");
    if (dto.orderType === "STOP" && !dto.stopPrice) throw new BadRequestException("止损单必须填写止损价");
    if (dto.orderType === "STOP_LIMIT" && (!dto.limitPrice || !dto.stopPrice)) {
      throw new BadRequestException("止损限价单必须填写限价和止损价");
    }
  }

  private assertPaperCapabilities(capabilities: {
    canCancelLiveOrders: boolean;
    canModifyLiveOrders: boolean;
    canPlaceLiveOrders: boolean;
    canPlacePaperOrders: boolean;
  }) {
    if (
      !capabilities.canPlacePaperOrders ||
      capabilities.canPlaceLiveOrders ||
      capabilities.canModifyLiveOrders ||
      capabilities.canCancelLiveOrders
    ) {
      throw new BadRequestException("Broker Connector Paper/Live 能力边界不安全，默认拒绝");
    }
  }

  private async connectorStatus() {
    try {
      const [health, capabilities] = await Promise.all([
        this.connector.health(),
        this.connector.capabilities(),
      ]);
      return { capabilities, health };
    } catch (error) {
      return {
        capabilities: {
          canCancelLiveOrders: false,
          canCancelPaperOrders: false,
          canModifyLiveOrders: false,
          canModifyPaperOrders: false,
          canPlaceLiveOrders: false,
          canPlacePaperOrders: false,
        },
        health: {
          checkedAt: new Date().toISOString(),
          latencyMs: 0,
          message: this.safeMessage(error),
          status: "OFFLINE",
        },
      };
    }
  }

  private stateFromUnknown(row: Record<string, unknown>, fallbackId: string): ConnectorPaperOrderState {
    const quantity = Number(row.quantity ?? 0);
    const filled = Number(row.filledQuantity ?? 0);
    return {
      averageFillPrice: Number(row.averageFillPrice ?? 0) || undefined,
      externalOrderId: String(row.externalOrderId ?? row.orderId ?? fallbackId),
      externalPermanentId: String(row.externalPermanentId ?? row.permanentId ?? "") || undefined,
      filledQuantity: filled,
      protectiveStopPrice: Number(row.stopPrice ?? 0) || undefined,
      lastFillPrice: Number(row.lastFillPrice ?? 0) || undefined,
      rawDataHash: stableHash(row),
      reason: String(row.reason ?? "") || undefined,
      remainingQuantity: Number(row.remainingQuantity ?? Math.max(0, quantity - filled)),
      status: String(row.status ?? "UNKNOWN"),
      updatedAt: String(row.updatedAt ?? row.orderTime ?? new Date().toISOString()),
    };
  }

  private async databaseHealthy() {
    try {
      await this.prisma.$queryRaw`SELECT 1 AS ok`;
      return true;
    } catch {
      return false;
    }
  }

  private async serviceHealthy(url: string) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  private isFresh(value: Date, seconds: number) {
    return Date.now() - value.getTime() <= seconds * 1_000;
  }

  private matchesLatestCompletedMarketSession(value: Date) {
    return value.toISOString().slice(0, 10) === this.marketCalendar.latestCompletedSession().date;
  }

  private serializeProposal(proposal: Record<string, unknown>) {
    return this.serializeDecimalRecord(proposal);
  }

  private serializeOrder(order: Record<string, unknown>) {
    return this.serializeDecimalRecord(order);
  }

  private serializeDecimalRecord(value: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (item instanceof Prisma.Decimal) return [key, toNumber(item)];
        if (Array.isArray(item)) {
          return [
            key,
            item.map((row) =>
              row && typeof row === "object"
                ? this.serializeDecimalRecord(row as Record<string, unknown>)
                : row,
            ),
          ];
        }
        if (item && typeof item === "object" && !(item instanceof Date)) {
          return [key, this.serializeDecimalRecord(item as Record<string, unknown>)];
        }
        return [key, item];
      }),
    );
  }

  private async environmentMismatch(accountId: string, message: string) {
    const correlationId = stableHash({ accountId, message, time: new Date().toISOString() });
    await this.incident({
      accountId,
      correlationId,
      impact: "订单在 API 与 Connector 之前被拒绝",
      incidentType: "PAPER_ENVIRONMENT_MISMATCH",
      severity: "CRITICAL",
    });
  }

  private async persistProposalPreflightBlock(
    accountId: string,
    dto: CreateBrokerOrderProposalDto,
    symbol: string,
    reasons: Array<{ code: string; message: string }>,
  ) {
    const ruleCodes = reasons.map((item) => item.code);
    const idempotencyKey = riskDisciplineEventKey({
      brokerAccountId: accountId,
      decision: "BLOCKED",
      ruleCodes,
      signalTradeDate: dto.signalTradeDate.slice(0, 10),
      strategyDeploymentId: dto.strategyDeploymentId,
      symbol,
    });
    await this.prisma.riskDisciplineEvent.upsert({
      where: { idempotencyKey },
      update: {},
      create: {
        actorId: "system",
        brokerAccountId: accountId,
        decision: "BLOCKED",
        eventType: "BROKER_PROPOSAL_PREFLIGHT_BLOCKED",
        idempotencyKey,
        newValueJson: JSON.stringify({
          contractId: dto.contractId,
          deploymentId: dto.strategyDeploymentId,
          signalTradeDate: dto.signalTradeDate,
          strategyId: dto.strategyId,
          symbol,
        }),
        occurredAt: new Date(),
        reason: reasons.map((item) => item.message).join("；"),
        ruleCode: ruleCodes.join("+"),
        severity: "CRITICAL",
      },
    });
  }

  private async incident(input: {
    accountId?: string;
    correlationId: string;
    impact: string;
    incidentType: string;
    orderId?: string;
    proposalId?: string;
    severity: string;
  }) {
    return this.prisma.executionIncident.create({
      data: {
        brokerAccountId: input.accountId,
        brokerPaperOrderId: input.orderId,
        correlationId: input.correlationId,
        impact: input.impact,
        incidentType: input.incidentType,
        occurredAt: new Date(),
        proposalId: input.proposalId,
        severity: input.severity,
        status: "OPEN",
      },
    });
  }

  private async audit(
    transaction: Prisma.TransactionClient,
    input: {
      accountId?: string;
      idempotencyKey?: string;
      details?: unknown;
      actorId: string;
      correlationId: string;
      eventType: string;
      message: string;
      severity: string;
    },
  ) {
    const data = {
        actorId: input.actorId,
        brokerAccountId: input.accountId,
        brokerConnectionId: CONNECTION_ID,
        detailsJson: JSON.stringify({ correlationId: input.correlationId, paperOnly: true, changes: input.details }),
        eventType: input.eventType,
        message: input.message,
        severity: input.severity,
    };
    if (input.idempotencyKey) await transaction.brokerAuditLog.upsert({ where: { id: input.idempotencyKey }, update: {}, create: { ...data, id: input.idempotencyKey } });
    else await transaction.brokerAuditLog.create({ data });
  }

  private safeMessage(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return message
      .replace(/(password|secret|token|cookie|authorization|session|account)\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]")
      .slice(0, 500);
  }
}
