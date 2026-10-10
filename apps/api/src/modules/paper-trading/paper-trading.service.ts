import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, type PaperOrder } from "@prisma/client";

import { toNumber } from "../../common/decimal";
import { PrismaService } from "../../prisma/prisma.service";
import { QuantEngineClient } from "../quant-engine/quant-engine.client";
import { RiskEngineService } from "../risk/risk-engine.service";
import { StrategyEvidenceService } from "../strategy-evidence/strategy-evidence.service";
import type { RiskPositionInput, RiskRuleInput } from "../risk/risk.types";
import type {
  CreatePaperAccountDto,
  CreateStrategyDeploymentDto,
  KillSwitchDto,
  RunPaperDeploymentDto,
  UpdateDeploymentStatusDto,
} from "./paper-trading.dto";
import {
  canResumePaperExecution,
  canTransitionPaperDeployment,
  paperExecutionKey,
} from "./paper-trading.rules";

type PaperViolation = {
  code: string;
  currentValue: number | null;
  expectedValue: number | null;
  limitValue: number | null;
  reason: string;
};

type GeneratedSignal = {
  engineVersion: string;
  action: "BUY" | "SELL" | "HOLD";
  signalTradeDate: string;
  referencePrice: number;
  requestedAmount: number;
  reason: string;
  stopLossCondition: string | null;
  exitCondition: string | null;
};

@Injectable()
export class PaperTradingService {
  private readonly logger = new Logger(PaperTradingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quantEngine: QuantEngineClient,
    private readonly riskEngine: RiskEngineService,
    private readonly strategyEvidence: StrategyEvidenceService,
  ) {}

  async dashboard(accountId?: string) {
    const accounts = await this.prisma.paperAccount.findMany({
      where: accountId ? { id: accountId } : undefined,
      include: {
        deployments: {
          include: { strategy: { select: { approvalStatus: true, code: true, name: true } } },
          orderBy: { createdAt: "desc" },
        },
        positions: { orderBy: { marketValue: "desc" } },
        snapshots: { orderBy: { snapshotTime: "asc" }, take: 1000 },
      },
      orderBy: { createdAt: "asc" },
    });
    const accountIds = accounts.map((account) => account.id);
    const [control, orders, fills, events, decisions] = await Promise.all([
      this.getControl(),
      this.prisma.paperOrder.findMany({
        where: { paperAccountId: { in: accountIds } },
        include: { fills: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      this.prisma.paperFill.findMany({
        where: { paperOrder: { paperAccountId: { in: accountIds } } },
        include: {
          paperOrder: { select: { side: true, strategyDeploymentId: true, symbol: true } },
        },
        orderBy: { executionTime: "desc" },
        take: 100,
      }),
      this.prisma.paperTradingEvent.findMany({
        where: { paperAccountId: { in: accountIds } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      this.prisma.paperRiskDecision.findMany({
        where: { deployment: { paperAccountId: { in: accountIds } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);
    return {
      control,
      accounts: accounts.map((account) => ({
        ...this.serializePaperAccount(account),
        deployments: account.deployments.map((deployment) => ({
          ...deployment,
          capitalAllocation: toNumber(deployment.capitalAllocation),
          maxPositionPercent: toNumber(deployment.maxPositionPercent),
          parameters: JSON.parse(deployment.parameterSnapshot),
          universe: JSON.parse(deployment.symbolUniverseJson),
          riskConfig: JSON.parse(deployment.paperRiskConfigJson),
        })),
        positions: account.positions.map((position) => this.serializePosition(position)),
        snapshots: account.snapshots.map((snapshot) => ({
          ...snapshot,
          cashBalance: toNumber(snapshot.cashBalance),
          drawdown: toNumber(snapshot.drawdown),
          positionValue: toNumber(snapshot.positionValue),
          realizedPnl: toNumber(snapshot.realizedPnl),
          totalEquity: toNumber(snapshot.totalEquity),
          unrealizedPnl: toNumber(snapshot.unrealizedPnl),
        })),
      })),
      orders: orders.map((order) => this.serializeOrder(order)),
      fills: fills.map((fill) => ({
        ...fill,
        commission: toNumber(fill.commission),
        notional: toNumber(fill.notional),
        price: toNumber(fill.price),
        quantity: toNumber(fill.quantity),
        realizedPnl: fill.realizedPnl === null ? null : toNumber(fill.realizedPnl),
        slippage: toNumber(fill.slippage),
      })),
      events: events.map((event) => ({ ...event, payload: JSON.parse(event.payloadJson) })),
      riskDecisions: decisions.map((decision) => ({
        ...decision,
        result: JSON.parse(decision.resultJson),
        violations: JSON.parse(decision.violationsJson),
      })),
      safeguards: {
        autoBrokerOrders: false,
        nakedShorting: false,
        margin: false,
        nextOpenExecution: true,
        realAccountIsolation: true,
      },
    };
  }

  async createAccount(dto: CreatePaperAccountDto) {
    const account = await this.prisma.paperAccount.create({
      data: {
        name: dto.name,
        baseCurrency: (dto.baseCurrency ?? "USD").toUpperCase(),
        initialCapital: dto.initialCapital,
        cashBalance: dto.initialCapital,
        totalEquity: dto.initialCapital,
        peakEquity: dto.initialCapital,
      },
    });
    await this.prisma.paperAccountEquitySnapshot.create({
      data: {
        paperAccountId: account.id,
        snapshotTime: new Date(),
        totalEquity: dto.initialCapital,
        cashBalance: dto.initialCapital,
        positionValue: 0,
        realizedPnl: 0,
        unrealizedPnl: 0,
        drawdown: 0,
        source: "ACCOUNT_CREATED",
      },
    });
    return this.serializePaperAccount(account);
  }

  async createDeployment(dto: CreateStrategyDeploymentDto) {
    if (!dto.stopLossCondition.trim() || !dto.exitCondition.trim()) {
      throw new BadRequestException("模拟部署必须填写止损条件和退出条件");
    }
    const [strategy, account, control] = await Promise.all([
      this.prisma.strategy.findUnique({ where: { id: dto.strategyId } }),
      this.prisma.paperAccount.findUnique({ where: { id: dto.paperAccountId } }),
      this.getControl(),
    ]);
    if (!strategy || strategy.approvalStatus !== "PAPER_APPROVED") {
      throw new BadRequestException("策略尚未通过稳健性验证与人工审批");
    }
    if (!account || account.status !== "ACTIVE") throw new BadRequestException("模拟账户不可用");
    if (control.killSwitchEnabled || account.killSwitchEnabled) {
      throw new BadRequestException("Kill Switch 已启用，禁止创建模拟部署");
    }
    if (dto.capitalAllocation > toNumber(account.totalEquity)) {
      throw new BadRequestException("策略分配资金不能超过模拟账户权益");
    }
    const approval = await this.prisma.strategyApproval.findFirst({
      where: { strategyId: strategy.id, status: "APPROVED", userConfirmed: true },
      orderBy: { decidedAt: "desc" },
    });
    if (!approval) throw new BadRequestException("缺少已确认的策略审批记录");
    const deployment = await this.prisma.strategyDeployment.create({
      data: {
        strategyId: strategy.id,
        paperAccountId: account.id,
        approvalId: approval.id,
        name: dto.name,
        status: "PAPER_APPROVED",
        symbolUniverseJson: strategy.symbolUniverse,
        parameterSnapshot: strategy.parameters,
        strategyVersion: strategy.version,
        codeVersion: process.env.GIT_COMMIT ?? "v1.4.0-local",
        capitalAllocation: dto.capitalAllocation,
        maxPositionPercent: dto.maxPositionPercent,
        stopLossCondition: dto.stopLossCondition.trim(),
        exitCondition: dto.exitCondition.trim(),
        paperRiskConfigJson: JSON.stringify({
          dailyLossMaxPercent: 5,
          maxConsecutiveLosses: 5,
          maxDrawdownPercent: 20,
          maxOrdersPerDay: 10,
          maxPositions: 10,
        }),
      },
    });
    await this.event(
      account.id,
      "DEPLOYMENT_CREATED",
      { deploymentId: deployment.id },
      deployment.id,
    );
    return deployment;
  }

  async updateDeploymentStatus(id: string, dto: UpdateDeploymentStatusDto) {
    const deployment = await this.prisma.strategyDeployment.findUnique({
      where: { id },
      include: { paperAccount: true, strategy: true },
    });
    if (!deployment) throw new NotFoundException("模拟策略部署不存在");
    const control = await this.getControl();
    if (!canTransitionPaperDeployment(deployment.status, dto.action, control.killSwitchEnabled)) {
      throw new BadRequestException(`不允许从 ${deployment.status} 执行 ${dto.action}`);
    }
    if (
      dto.action === "START" &&
      (control.killSwitchEnabled || deployment.paperAccount.killSwitchEnabled)
    ) {
      throw new BadRequestException("Kill Switch 已启用，禁止启动策略");
    }
    if (
      dto.action === "START" &&
      !["PAPER_APPROVED", "PAPER_PAUSED", "PAPER_RUNNING", "PAPER_OBSERVING"].includes(
        deployment.strategy.approvalStatus,
      )
    ) {
      throw new BadRequestException("策略审批状态不允许启动模拟交易");
    }
    const status = {
      PAUSE: "PAPER_PAUSED",
      START: "PAPER_RUNNING",
      STOP: "PAPER_STOPPED",
    }[dto.action];
    const updated = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.strategyDeployment.update({
        where: { id },
        data: {
          status,
          startedAt: dto.action === "START" ? (deployment.startedAt ?? new Date()) : undefined,
          observationStartedAt:
            dto.action === "START" ? (deployment.observationStartedAt ?? new Date()) : undefined,
          pausedAt: dto.action === "PAUSE" ? new Date() : undefined,
          stoppedAt: dto.action === "STOP" ? new Date() : undefined,
        },
      });
      await transaction.strategy.update({
        where: { id: deployment.strategyId },
        data: { approvalStatus: dto.action === "START" ? "PAPER_OBSERVING" : status },
      });
      if (dto.action !== "START") {
        await transaction.paperOrder.updateMany({
          where: {
            strategyDeploymentId: id,
            status: { in: ["CREATED", "APPROVED", "WAITING_MARKET_DATA"] },
          },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(),
            rejectionReason: `部署已${dto.action}`,
          },
        });
      }
      return result;
    });
    await this.event(
      deployment.paperAccountId,
      `DEPLOYMENT_${dto.action}`,
      { deploymentId: id, status },
      id,
    );
    return updated;
  }

  async runDeployment(id: string, dto: RunPaperDeploymentDto) {
    const brokerSafety = await this.prisma.brokerConnection.findUnique({
      where: { id: "broker-connection-ibkr-readonly" },
      select: { safetyState: true },
    });
    if (brokerSafety?.safetyState === "LOCKDOWN") {
      throw new BadRequestException("全局安全状态为 LOCKDOWN，禁止运行自动模拟策略");
    }
    const deployment = await this.prisma.strategyDeployment.findUnique({
      where: { id },
      include: { paperAccount: true, positions: true, strategy: true },
    });
    if (!deployment) throw new NotFoundException("模拟策略部署不存在");
    if (deployment.status !== "PAPER_RUNNING")
      throw new BadRequestException("只有运行中的模拟策略可以执行");
    const control = await this.getControl();
    if (control.killSwitchEnabled || deployment.paperAccount.killSwitchEnabled) {
      throw new BadRequestException("Kill Switch 已启用，模拟执行已停止");
    }
    const universe = JSON.parse(deployment.symbolUniverseJson) as string[];
    const symbol = (dto.symbol ?? universe[0])?.toUpperCase();
    if (!symbol || !universe.includes(symbol))
      throw new BadRequestException("标的不在部署的策略池中");
    const latest = await this.prisma.marketDataDaily.findFirst({
      where: { symbol },
      orderBy: [{ tradeDate: "desc" }, { updatedAt: "desc" }],
    });
    if (!latest) throw new BadRequestException("缺少模拟执行行情");
    const signalTradeDate = dto.signalTradeDate
      ? this.utcDate(dto.signalTradeDate)
      : latest.tradeDate;
    const bars = await this.prisma.marketDataDaily.findMany({
      where: { symbol, source: latest.source, tradeDate: { lte: signalTradeDate } },
      orderBy: { tradeDate: "asc" },
      take: 5000,
    });
    if (bars.length < 2) throw new BadRequestException("没有足够的历史行情生成信号");
    const idempotencyKey = paperExecutionKey(
      deployment.id,
      symbol,
      signalTradeDate.toISOString().slice(0, 10),
      deployment.strategyVersion,
    );
    const existing = await this.prisma.strategyExecutionRun.findUnique({
      where: { idempotencyKey },
      include: { _count: { select: { orders: true } } },
    });
    let executionRun;
    if (
      existing &&
      canResumePaperExecution(
        existing.status,
        Boolean(existing.strategySignalId),
        existing._count.orders,
      )
    ) {
      executionRun = await this.prisma.strategyExecutionRun.update({
        where: { id: existing.id },
        data: {
          completedAt: null,
          errorMessage: null,
          resultJson: null,
          startedAt: new Date(),
          status: "RUNNING",
        },
      });
    } else if (existing) {
      return this.executionResult(existing.id, true);
    } else
      try {
        executionRun = await this.prisma.strategyExecutionRun.create({
          data: {
            strategyDeploymentId: deployment.id,
            symbol,
            signalTradeDate,
            idempotencyKey,
            strategyVersion: deployment.strategyVersion,
            status: "RUNNING",
            inputSnapshotJson: JSON.stringify({
              parameters: JSON.parse(deployment.parameterSnapshot),
              signalTradeDate: signalTradeDate.toISOString().slice(0, 10),
              symbol,
            }),
          },
        });
      } catch (error: unknown) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const duplicate = await this.prisma.strategyExecutionRun.findUnique({
            where: { idempotencyKey },
          });
          if (duplicate) return this.executionResult(duplicate.id, true);
        }
        throw error;
      }
    const position = deployment.positions.find((item) => item.symbol === symbol);
    try {
      const evidence =
        deployment.strategy.strategyType === "FundamentalLiquidityCrowding"
          ? await this.strategyEvidence.quantObservations(symbol, bars[0]!.tradeDate, signalTradeDate)
          : [];
      const signal = await this.quantEngine.generateSignal<GeneratedSignal>({
        strategyType: deployment.strategy.strategyType,
        parameters: JSON.parse(deployment.parameterSnapshot),
        evidence,
        bars: bars.map((bar) => this.mapBar(bar)),
        currentQuantity: position ? toNumber(position.quantity) : 0,
        targetAmount: toNumber(deployment.capitalAllocation),
      });
      if (signal.action === "HOLD") {
        await this.prisma.strategyExecutionRun.update({
          where: { id: executionRun.id },
          data: {
            status: "COMPLETED_NO_SIGNAL",
            completedAt: new Date(),
            quantEngineVersion: signal.engineVersion,
            resultJson: JSON.stringify(signal),
          },
        });
        return this.executionResult(executionRun.id, false);
      }
      const strategySignal = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.strategySignal.create({
          data: {
            strategyId: deployment.strategyId,
            paperAccountId: deployment.paperAccountId,
            signalContext: "PAPER_ACCOUNT",
            symbol,
            signalType: signal.action,
            signalTime: signalTradeDate,
            requestedAmount: signal.action === "BUY" ? signal.requestedAmount : null,
            requestedQuantity: signal.action === "SELL" ? toNumber(position?.quantity) : null,
            referencePrice: signal.referencePrice,
            stopLossCondition: deployment.stopLossCondition,
            exitCondition: deployment.exitCondition,
            triggerReason: signal.reason,
            status: "GENERATED",
          },
        });
        await transaction.strategyExecutionRun.update({
          where: { id: executionRun.id },
          data: { strategySignalId: created.id },
        });
        return created;
      });
      const review = await this.reviewPaperSignal(deployment.id, strategySignal.id);
      if (!review.approved) {
        await this.prisma.$transaction([
          this.prisma.strategySignal.update({
            where: { id: strategySignal.id },
            data: {
              status: "RISK_REJECTED",
              rejectionReason: review.violations.map((item) => item.reason).join("；"),
              reviewedAt: new Date(),
              riskResultJson: JSON.stringify(review),
            },
          }),
          this.prisma.strategyExecutionRun.update({
            where: { id: executionRun.id },
            data: {
              status: "RISK_REJECTED",
              completedAt: new Date(),
              strategySignalId: strategySignal.id,
              quantEngineVersion: signal.engineVersion,
              resultJson: JSON.stringify({ signal, review }),
            },
          }),
        ]);
        await this.prisma.systemNotification.upsert({
          where: { dedupeKey: `RISK_REJECTED:${executionRun.id}` },
          update: {
            message: review.violations.map((item) => item.reason).join("；"),
            status: "UNREAD",
          },
          create: {
            dedupeKey: `RISK_REJECTED:${executionRun.id}`,
            message: review.violations.map((item) => item.reason).join("；"),
            metadataJson: JSON.stringify({
              deploymentId: deployment.id,
              signalId: strategySignal.id,
              symbol,
            }),
            severity: "WARNING",
            title: `${symbol} 模拟信号被 RiskEngine 拒绝`,
            type: "RISK_ENGINE_REJECTED",
          },
        });
        return this.executionResult(executionRun.id, false);
      }
      const nextBar = await this.prisma.marketDataDaily.findFirst({
        where: { symbol, tradeDate: { gt: signalTradeDate } },
        orderBy: [{ tradeDate: "asc" }, { updatedAt: "desc" }],
      });
      const order = await this.prisma.paperOrder.create({
        data: {
          paperAccountId: deployment.paperAccountId,
          strategyDeploymentId: deployment.id,
          executionRunId: executionRun.id,
          strategySignalId: strategySignal.id,
          idempotencyKey: `${idempotencyKey}:order:${signal.action}`,
          symbol,
          side: signal.action,
          signalTradeDate,
          earliestFillDate: nextBar?.tradeDate,
          requestedAmount: signal.action === "BUY" ? signal.requestedAmount : null,
          requestedQuantity: signal.action === "SELL" ? toNumber(position?.quantity) : null,
          referencePrice: signal.referencePrice,
          commissionRate: toNumber(deployment.strategy.commissionRate),
          slippageRate: toNumber(deployment.strategy.slippageRate),
          status: nextBar ? "APPROVED" : "WAITING_MARKET_DATA",
        },
      });
      await this.prisma.$transaction([
        this.prisma.paperRiskDecision.update({
          where: { id: review.decisionId },
          data: { paperOrderId: order.id },
        }),
        this.prisma.strategySignal.update({
          where: { id: strategySignal.id },
          data: {
            status: "RISK_APPROVED",
            reviewedAt: new Date(),
            riskResultJson: JSON.stringify(review),
          },
        }),
        this.prisma.strategyExecutionRun.update({
          where: { id: executionRun.id },
          data: {
            status: nextBar ? "ORDER_APPROVED" : "WAITING_MARKET_DATA",
            completedAt: new Date(),
            strategySignalId: strategySignal.id,
            quantEngineVersion: signal.engineVersion,
            resultJson: JSON.stringify({ orderId: order.id, review, signal }),
          },
        }),
      ]);
      await this.event(
        deployment.paperAccountId,
        "ORDER_CREATED",
        { orderId: order.id },
        deployment.id,
        order.id,
      );
      if (nextBar) await this.processOrder(order.id);
      return this.executionResult(executionRun.id, false);
    } catch (error: unknown) {
      await this.prisma.strategyExecutionRun.update({
        where: { id: executionRun.id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : "模拟执行失败",
        },
      });
      throw error;
    }
  }

  async processPendingOrders() {
    const brokerSafety = await this.prisma.brokerConnection.findUnique({
      where: { id: "broker-connection-ibkr-readonly" },
      select: { safetyState: true },
    });
    if (brokerSafety?.safetyState === "LOCKDOWN") {
      return { blocked: true, processed: 0, reason: "LOCKDOWN", results: [] };
    }
    const orders = await this.prisma.paperOrder.findMany({
      where: { status: { in: ["APPROVED", "WAITING_MARKET_DATA"] } },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    const results = [];
    for (const order of orders) results.push(await this.processOrder(order.id));
    return { processed: results.length, results };
  }

  async setKillSwitch(dto: KillSwitchDto) {
    const reason =
      dto.reason?.trim() || (dto.enabled ? "用户触发全局模拟交易停止" : "用户解除全局停止");
    return this.prisma.$transaction(async (transaction) => {
      const control = await transaction.paperTradingControl.upsert({
        where: { id: "global" },
        update: { killSwitchEnabled: dto.enabled, reason },
        create: { id: "global", killSwitchEnabled: dto.enabled, reason },
      });
      await transaction.paperAccount.updateMany({
        data: { killSwitchEnabled: dto.enabled, killSwitchReason: dto.enabled ? reason : null },
      });
      const portfolios = await transaction.strategyPortfolio.findMany({
        select: { id: true },
      });
      if (dto.enabled) {
        const runningDeployments = await transaction.strategyDeployment.findMany({
          where: { status: "PAPER_RUNNING" },
          select: { strategyId: true },
        });
        await transaction.strategyDeployment.updateMany({
          where: { status: "PAPER_RUNNING" },
          data: { status: "PAPER_PAUSED", pausedAt: new Date() },
        });
        if (runningDeployments.length > 0) {
          await transaction.strategy.updateMany({
            where: { id: { in: runningDeployments.map((item) => item.strategyId) } },
            data: { approvalStatus: "PAPER_PAUSED" },
          });
        }
        await transaction.paperOrder.updateMany({
          where: { status: { in: ["CREATED", "APPROVED", "WAITING_MARKET_DATA"] } },
          data: { status: "CANCELLED", cancelledAt: new Date(), rejectionReason: reason },
        });
        await transaction.strategyPortfolio.updateMany({
          where: { status: "PAPER_RUNNING" },
          data: { pausedAt: new Date(), status: "PAUSED" },
        });
        await transaction.portfolioOrder.updateMany({
          where: { status: { in: ["CREATED", "APPROVED", "WAITING_MARKET_DATA"] } },
          data: { status: "CANCELLED", cancelledAt: new Date(), rejectionReason: reason },
        });
      }
      if (portfolios.length > 0) {
        await transaction.portfolioAuditEvent.createMany({
          data: portfolios.map((portfolio) => ({
            eventType: dto.enabled ? "GLOBAL_KILL_SWITCH_ENABLED" : "GLOBAL_KILL_SWITCH_DISABLED",
            payloadJson: JSON.stringify({ enabled: dto.enabled, reason }),
            portfolioId: portfolio.id,
            severity: dto.enabled ? "CRITICAL" : "INFO",
          })),
        });
      }
      const accounts = await transaction.paperAccount.findMany({ select: { id: true } });
      if (accounts.length > 0) {
        await transaction.paperTradingEvent.createMany({
          data: accounts.map((account) => ({
            paperAccountId: account.id,
            eventType: dto.enabled ? "KILL_SWITCH_ENABLED" : "KILL_SWITCH_DISABLED",
            severity: dto.enabled ? "CRITICAL" : "INFO",
            payloadJson: JSON.stringify({ enabled: dto.enabled, reason }),
          })),
        });
      }
      if (dto.enabled) {
        await transaction.systemNotification.upsert({
          where: { dedupeKey: "KILL_SWITCH:GLOBAL" },
          update: { message: reason, severity: "CRITICAL", status: "UNREAD" },
          create: {
            dedupeKey: "KILL_SWITCH:GLOBAL",
            message: reason,
            severity: "CRITICAL",
            title: "全局模拟交易 Kill Switch 已启用",
            type: "KILL_SWITCH_ENABLED",
          },
        });
      }
      return control;
    });
  }

  async review(deploymentId?: string) {
    const deployments = await this.prisma.strategyDeployment.findMany({
      where: deploymentId ? { id: deploymentId } : undefined,
      include: {
        orders: { include: { fills: true } },
        paperAccount: { include: { snapshots: { orderBy: { snapshotTime: "asc" } } } },
        strategy: {
          include: {
            backtestRuns: {
              where: { status: "COMPLETED" },
              orderBy: { completedAt: "desc" },
              take: 1,
            },
          },
        },
      },
    });
    return deployments.map((deployment) => {
      const fills = deployment.orders.flatMap((order) => order.fills);
      const commissions = fills.reduce((sum, fill) => sum + toNumber(fill.commission), 0);
      const realized = fills
        .map((fill) => toNumber(fill.realizedPnl))
        .filter((value) => value !== 0);
      const wins = realized.filter((value) => value > 0);
      const latestSnapshot = deployment.paperAccount.snapshots.at(-1);
      const paperReturn = latestSnapshot
        ? (toNumber(latestSnapshot.totalEquity) / toNumber(deployment.paperAccount.initialCapital) -
            1) *
          100
        : 0;
      const backtest = deployment.strategy.backtestRuns[0];
      const backtestReturn = backtest?.totalReturn ? toNumber(backtest.totalReturn) : null;
      const deviation = backtestReturn === null ? null : paperReturn - backtestReturn;
      return {
        deploymentId: deployment.id,
        deploymentName: deployment.name,
        status: deployment.status,
        paperReturn,
        backtestReturn,
        returnDeviation: deviation,
        fillCount: fills.length,
        commissionImpact: commissions,
        winRate: realized.length > 0 ? (wins.length / realized.length) * 100 : 0,
        maxDrawdown: toNumber(deployment.paperAccount.maxDrawdown),
        alerts: [
          ...(deviation !== null && Math.abs(deviation) >= 10
            ? ["模拟表现与回测偏差超过 10 个百分点"]
            : []),
          ...(deployment.consecutiveLosses >= 3 ? ["策略已出现至少 3 次连续亏损"] : []),
          ...(commissions > toNumber(deployment.capitalAllocation) * 0.02
            ? ["手续费影响超过分配资金的 2%"]
            : []),
        ],
      };
    });
  }

  private async reviewPaperSignal(deploymentId: string, strategySignalId: string) {
    const [deployment, signal, dbRules, control] = await Promise.all([
      this.prisma.strategyDeployment.findUnique({
        where: { id: deploymentId },
        include: { paperAccount: true, positions: true, orders: true },
      }),
      this.prisma.strategySignal.findUnique({ where: { id: strategySignalId } }),
      this.prisma.riskRule.findMany({ where: { enabled: true } }),
      this.getControl(),
    ]);
    if (!deployment || !signal) throw new NotFoundException("模拟风险审查上下文不存在");
    const instrument = await this.prisma.instrument.findUnique({
      where: { symbol: signal.symbol },
    });
    const recentSnapshots = await this.prisma.paperAccountEquitySnapshot.findMany({
      where: { paperAccountId: deployment!.paperAccountId },
      orderBy: { snapshotTime: "desc" },
      take: 2,
    });
    const instruments = await this.prisma.instrument.findMany({
      where: { symbol: { in: deployment.positions.map((item) => item.symbol) } },
    });
    const instrumentMap = new Map(instruments.map((item) => [item.symbol, item]));
    const rules = dbRules.map<RiskRuleInput>((rule) => ({
      code: rule.code,
      enabled: rule.enabled,
      level: rule.level,
      limitValue: toNumber(rule.limitValue),
    }));
    const limits = Object.fromEntries(rules.map((rule) => [rule.code, rule.limitValue]));
    const currentPositions: RiskPositionInput[] = deployment.positions.map((position) => {
      const metadata = instrumentMap.get(position.symbol);
      return {
        id: position.id,
        symbol: position.symbol,
        name: metadata?.name ?? position.symbol,
        assetType: metadata?.assetType ?? "UNKNOWN",
        category: metadata?.category ?? null,
        theme: metadata?.theme ?? null,
        quantity: toNumber(position.quantity),
        avgCost: toNumber(position.avgCost),
        currentPrice: toNumber(position.currentPrice),
      };
    });
    const requestedAmount = toNumber(signal.requestedAmount);
    const referencePrice = toNumber(signal.referencePrice);
    const projectedPositions = currentPositions.map((item) => ({ ...item }));
    if (signal.signalType === "BUY" && instrument) {
      const existing = projectedPositions.find((item) => item.symbol === signal.symbol);
      const quantity = requestedAmount / referencePrice;
      if (existing) {
        const oldCost = existing.quantity * existing.avgCost;
        existing.quantity += quantity;
        existing.avgCost = (oldCost + requestedAmount) / existing.quantity;
        existing.currentPrice = referencePrice;
      } else {
        projectedPositions.push({
          id: `paper-signal-${signal.id}`,
          symbol: instrument.symbol,
          name: instrument.name ?? instrument.symbol,
          assetType: instrument.assetType,
          category: instrument.category,
          theme: instrument.theme,
          quantity,
          avgCost: referencePrice,
          currentPrice: referencePrice,
        });
      }
    }
    const accountInput = {
      id: deployment.paperAccount.id,
      name: deployment.paperAccount.name,
      totalEquity: toNumber(deployment.paperAccount.totalEquity),
      cashBalance: toNumber(deployment.paperAccount.cashBalance),
      realizedPnlYtd: toNumber(deployment.paperAccount.realizedPnl),
    };
    const current = this.riskEngine.evaluate(accountInput, currentPositions, rules);
    const projected = this.riskEngine.evaluate(
      { ...accountInput, cashBalance: accountInput.cashBalance - requestedAmount },
      projectedPositions,
      rules,
    );
    const violations: PaperViolation[] = [];
    const add = (violation: PaperViolation) => {
      if (!violations.some((item) => item.code === violation.code)) violations.push(violation);
    };
    if (control.killSwitchEnabled || deployment.paperAccount.killSwitchEnabled) {
      add({
        code: "PAPER_KILL_SWITCH",
        currentValue: 1,
        expectedValue: 1,
        limitValue: 0,
        reason: "Kill Switch 已启用",
      });
    }
    if (!instrument) {
      add({
        code: "INSTRUMENT_UNKNOWN",
        currentValue: null,
        expectedValue: null,
        limitValue: null,
        reason: "标的无法识别",
      });
    }
    if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
      add({
        code: "PAPER_DATA_INTEGRITY",
        currentValue: referencePrice,
        expectedValue: referencePrice,
        limitValue: 0,
        reason: "参考价格无效，禁止生成模拟订单",
      });
    }
    if (!signal.stopLossCondition?.trim() || !signal.exitCondition?.trim()) {
      add({
        code: "ENTRY_EXIT_REQUIRED",
        currentValue: null,
        expectedValue: null,
        limitValue: 1,
        reason: "禁止开仓：缺少止损或退出条件",
      });
    }
    if (signal.signalType === "BUY" && requestedAmount > accountInput.cashBalance) {
      add({
        code: "CASH_INSUFFICIENT",
        currentValue: accountInput.cashBalance,
        expectedValue: accountInput.cashBalance - requestedAmount,
        limitValue: 0,
        reason: "模拟账户现金不足，禁止融资",
      });
    }
    const projectedPosition = projected.positions.find((item) => item.symbol === signal.symbol);
    const currentPosition = current.positions.find((item) => item.symbol === signal.symbol);
    if (signal.signalType === "BUY" && projectedPosition) {
      const deploymentLimit = Math.min(
        toNumber(deployment.maxPositionPercent),
        instrument?.assetType === "LEVERAGED_ETF"
          ? (limits.LEVERAGED_ETF_SINGLE_MAX ?? 5)
          : (limits.SINGLE_STOCK_MAX ?? 15),
      );
      if (projectedPosition.positionPercent > deploymentLimit) {
        add({
          code: "PAPER_POSITION_LIMIT",
          currentValue: currentPosition?.positionPercent ?? 0,
          expectedValue: projectedPosition.positionPercent,
          limitValue: deploymentLimit,
          reason: "买入后单只持仓超过模拟部署或统一风控上限",
        });
      }
      if (projected.leveragedEtfPercent > (limits.LEVERAGED_ETF_TOTAL_MAX ?? 10)) {
        add({
          code: "LEVERAGED_ETF_TOTAL_MAX",
          currentValue: current.leveragedEtfPercent,
          expectedValue: projected.leveragedEtfPercent,
          limitValue: limits.LEVERAGED_ETF_TOTAL_MAX ?? 10,
          reason: "买入后杠杆 ETF 总仓位超限",
        });
      }
      if (projected.storageThemePercent > (limits.STORAGE_THEME_MAX ?? 15)) {
        add({
          code: "STORAGE_THEME_MAX",
          currentValue: current.storageThemePercent,
          expectedValue: projected.storageThemePercent,
          limitValue: limits.STORAGE_THEME_MAX ?? 15,
          reason: "买入后存储主题仓位超限",
        });
      }
      if (instrument?.theme) {
        const themePercent =
          (projected.positions
            .filter((item) => item.theme === instrument.theme)
            .reduce((sum, item) => sum + item.marketValue, 0) /
            accountInput.totalEquity) *
          100;
        if (themePercent > (limits.THEME_MAX ?? 20)) {
          add({
            code: "THEME_MAX",
            currentValue: 0,
            expectedValue: themePercent,
            limitValue: limits.THEME_MAX ?? 20,
            reason: "买入后单一主题仓位超过 20% 上限",
          });
        }
      }
    }
    if (recentSnapshots.length >= 2) {
      const latestEquity = toNumber(recentSnapshots[0]!.totalEquity);
      const previousEquity = toNumber(recentSnapshots[1]!.totalEquity);
      const dailyLossPercent = previousEquity > 0 ? (latestEquity / previousEquity - 1) * 100 : 0;
      if (dailyLossPercent <= -(limits.PAPER_DAILY_LOSS_MAX ?? 5)) {
        add({
          code: "PAPER_DAILY_LOSS_MAX",
          currentValue: dailyLossPercent,
          expectedValue: dailyLossPercent,
          limitValue: -(limits.PAPER_DAILY_LOSS_MAX ?? 5),
          reason: "模拟账户单日亏损已达到停止线",
        });
      }
    }
    if (
      toNumber(deployment.paperAccount.maxDrawdown) <= -(limits.PAPER_ACCOUNT_DRAWDOWN_MAX ?? 20)
    ) {
      add({
        code: "PAPER_ACCOUNT_DRAWDOWN_MAX",
        currentValue: toNumber(deployment.paperAccount.maxDrawdown),
        expectedValue: toNumber(deployment.paperAccount.maxDrawdown),
        limitValue: -(limits.PAPER_ACCOUNT_DRAWDOWN_MAX ?? 20),
        reason: "模拟账户回撤已触发停止线",
      });
    }
    if (deployment.consecutiveLosses >= (limits.PAPER_CONSECUTIVE_LOSSES_MAX ?? 5)) {
      add({
        code: "PAPER_CONSECUTIVE_LOSSES_MAX",
        currentValue: deployment.consecutiveLosses,
        expectedValue: deployment.consecutiveLosses,
        limitValue: limits.PAPER_CONSECUTIVE_LOSSES_MAX ?? 5,
        reason: "连续亏损次数达到停止线",
      });
    }
    if (currentPositions.length >= (limits.PAPER_MAX_POSITIONS ?? 10) && !currentPosition) {
      add({
        code: "PAPER_MAX_POSITIONS",
        currentValue: currentPositions.length,
        expectedValue: currentPositions.length + 1,
        limitValue: limits.PAPER_MAX_POSITIONS ?? 10,
        reason: "模拟账户持仓数量超限",
      });
    }
    const todayOrders = deployment.orders.filter(
      (order) =>
        order.signalTradeDate.toISOString().slice(0, 10) ===
        signal.signalTime.toISOString().slice(0, 10),
    ).length;
    if (todayOrders >= (limits.PAPER_MAX_ORDERS_PER_DAY ?? 10)) {
      add({
        code: "PAPER_MAX_ORDERS_PER_DAY",
        currentValue: todayOrders,
        expectedValue: todayOrders + 1,
        limitValue: limits.PAPER_MAX_ORDERS_PER_DAY ?? 10,
        reason: "当日模拟订单数量超限",
      });
    }
    const approved = violations.length === 0;
    const decision = await this.prisma.paperRiskDecision.create({
      data: {
        strategyDeploymentId: deployment.id,
        strategySignalId: signal.id,
        decision: approved ? "RISK_APPROVED" : "RISK_REJECTED",
        inputSnapshotJson: JSON.stringify({ accountInput, currentPositions, projectedPositions }),
        resultJson: JSON.stringify({ approved, current, projected }),
        violationsJson: JSON.stringify(violations),
        engineVersion: "risk-engine-v1.4-paper",
      },
    });
    return { approved, current, decisionId: decision.id, projected, violations };
  }

  private async processOrder(id: string) {
    const order = await this.prisma.paperOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException("模拟订单不存在");
    if (order.status === "FILLED") return this.serializeOrder(order);
    const control = await this.getControl();
    if (control.killSwitchEnabled) return this.cancelOrder(order, "Kill Switch 已启用");
    const brokerSafety = await this.prisma.brokerConnection.findUnique({
      where: { id: "broker-connection-ibkr-readonly" },
      select: { safetyState: true },
    });
    if (brokerSafety?.safetyState === "LOCKDOWN") {
      return this.cancelOrder(order, "全局安全状态为 LOCKDOWN");
    }
    const bar = await this.prisma.marketDataDaily.findFirst({
      where: { symbol: order.symbol, tradeDate: { gt: order.signalTradeDate } },
      orderBy: [{ tradeDate: "asc" }, { updatedAt: "desc" }],
    });
    if (!bar) {
      const waiting = await this.prisma.paperOrder.update({
        where: { id },
        data: { status: "WAITING_MARKET_DATA" },
      });
      return this.serializeOrder(waiting);
    }
    return this.prisma.$transaction(
      async (transaction) => {
        const locked = await transaction.paperOrder.findUnique({ where: { id } });
        if (!locked || locked.status === "FILLED")
          return locked ? this.serializeOrder(locked) : null;
        const [account, deployment, currentPosition, brokerConnection] = await Promise.all([
          transaction.paperAccount.findUnique({ where: { id: locked.paperAccountId } }),
          transaction.strategyDeployment.findUnique({ where: { id: locked.strategyDeploymentId } }),
          transaction.paperPosition.findUnique({
            where: {
              paperAccountId_strategyDeploymentId_symbol: {
                paperAccountId: locked.paperAccountId,
                strategyDeploymentId: locked.strategyDeploymentId,
                symbol: locked.symbol,
              },
            },
          }),
          transaction.brokerConnection.findUnique({
            where: { id: "broker-connection-ibkr-readonly" },
            select: { safetyState: true },
          }),
        ]);
        if (!account || !deployment) throw new BadRequestException("模拟订单上下文缺失");
        if (
          account.killSwitchEnabled ||
          deployment.status !== "PAPER_RUNNING" ||
          brokerConnection?.safetyState === "LOCKDOWN"
        ) {
          return this.serializeOrder(
            await transaction.paperOrder.update({
              where: { id },
              data: {
                status: "CANCELLED",
                cancelledAt: new Date(),
                rejectionReason:
                  brokerConnection?.safetyState === "LOCKDOWN"
                    ? "全局安全状态为 LOCKDOWN"
                    : "模拟交易已停止",
              },
            }),
          );
        }
        const open = toNumber(bar.open);
        const commissionRate = toNumber(locked.commissionRate);
        const slippageRate = toNumber(locked.slippageRate);
        const price = open * (locked.side === "BUY" ? 1 + slippageRate : 1 - slippageRate);
        let quantity =
          locked.side === "BUY"
            ? Math.floor(toNumber(locked.requestedAmount) / (price * (1 + commissionRate)))
            : Math.min(toNumber(locked.requestedQuantity), toNumber(currentPosition?.quantity));
        if (locked.side === "BUY") {
          const affordable = Math.floor(
            toNumber(account.cashBalance) / (price * (1 + commissionRate)),
          );
          quantity = Math.min(quantity, affordable);
        }
        if (quantity <= 0 || (locked.side === "SELL" && !currentPosition)) {
          return this.serializeOrder(
            await transaction.paperOrder.update({
              where: { id },
              data: { status: "REJECTED", rejectionReason: "现金不足或没有可卖持仓" },
            }),
          );
        }
        const notional = quantity * price;
        const commission = notional * commissionRate;
        const slippage = quantity * open * slippageRate;
        let realizedPnl = 0;
        let cashBalance = toNumber(account.cashBalance);
        if (locked.side === "BUY") {
          cashBalance -= notional + commission;
          const oldQuantity = toNumber(currentPosition?.quantity);
          const oldCost = oldQuantity * toNumber(currentPosition?.avgCost);
          const newQuantity = oldQuantity + quantity;
          const avgCost = (oldCost + notional + commission) / newQuantity;
          await transaction.paperPosition.upsert({
            where: {
              paperAccountId_strategyDeploymentId_symbol: {
                paperAccountId: account.id,
                strategyDeploymentId: deployment.id,
                symbol: locked.symbol,
              },
            },
            update: {
              quantity: newQuantity,
              avgCost,
              currentPrice: price,
              marketValue: newQuantity * price,
              unrealizedPnl: newQuantity * (price - avgCost),
            },
            create: {
              paperAccountId: account.id,
              strategyDeploymentId: deployment.id,
              symbol: locked.symbol,
              quantity,
              avgCost,
              currentPrice: price,
              marketValue: quantity * price,
              unrealizedPnl: quantity * (price - avgCost),
              openedAt: bar.tradeDate,
            },
          });
        } else {
          const avgCost = toNumber(currentPosition!.avgCost);
          realizedPnl = notional - commission - quantity * avgCost;
          cashBalance += notional - commission;
          const remaining = toNumber(currentPosition!.quantity) - quantity;
          if (remaining <= 1e-8) {
            await transaction.paperPosition.delete({ where: { id: currentPosition!.id } });
          } else {
            await transaction.paperPosition.update({
              where: { id: currentPosition!.id },
              data: {
                quantity: remaining,
                currentPrice: price,
                marketValue: remaining * price,
                unrealizedPnl: remaining * (price - avgCost),
                realizedPnl: { increment: realizedPnl },
              },
            });
          }
        }
        const fillTime = new Date(`${bar.tradeDate.toISOString().slice(0, 10)}T14:30:00.000Z`);
        const fill = await transaction.paperFill.create({
          data: {
            paperOrderId: locked.id,
            fillSequence: 1,
            executionTime: fillTime,
            price,
            quantity,
            notional,
            commission,
            slippage,
            realizedPnl: locked.side === "SELL" ? realizedPnl : null,
          },
        });
        await transaction.paperCashMovement.create({
          data: {
            paperAccountId: account.id,
            paperOrderId: locked.id,
            movementType: locked.side === "BUY" ? "TRADE_BUY" : "TRADE_SELL",
            amount: locked.side === "BUY" ? -(notional + commission) : notional - commission,
            balanceAfter: cashBalance,
            description: `${locked.side} ${locked.symbol}`,
            eventTime: fillTime,
          },
        });
        const positions = await transaction.paperPosition.findMany({
          where: { paperAccountId: account.id },
        });
        const positionValue = positions.reduce((sum, item) => sum + toNumber(item.marketValue), 0);
        const unrealizedPnl = positions.reduce(
          (sum, item) => sum + toNumber(item.unrealizedPnl),
          0,
        );
        const totalEquity = cashBalance + positionValue;
        const peakEquity = Math.max(toNumber(account.peakEquity), totalEquity);
        const drawdown = peakEquity > 0 ? (totalEquity / peakEquity - 1) * 100 : 0;
        const maxDrawdown = Math.min(toNumber(account.maxDrawdown), drawdown);
        await transaction.paperAccount.update({
          where: { id: account.id },
          data: {
            cashBalance,
            totalEquity,
            peakEquity,
            maxDrawdown,
            realizedPnl: { increment: realizedPnl },
            unrealizedPnl,
          },
        });
        await transaction.paperAccountEquitySnapshot.upsert({
          where: {
            paperAccountId_snapshotTime: { paperAccountId: account.id, snapshotTime: fillTime },
          },
          update: {
            cashBalance,
            drawdown,
            positionValue,
            realizedPnl: toNumber(account.realizedPnl) + realizedPnl,
            totalEquity,
            unrealizedPnl,
          },
          create: {
            paperAccountId: account.id,
            snapshotTime: fillTime,
            cashBalance,
            drawdown,
            positionValue,
            realizedPnl: toNumber(account.realizedPnl) + realizedPnl,
            totalEquity,
            unrealizedPnl,
            source: "PAPER_FILL",
          },
        });
        const updated = await transaction.paperOrder.update({
          where: { id: locked.id },
          data: { approvedQuantity: quantity, status: "FILLED", filledAt: fillTime },
        });
        await transaction.strategyExecutionRun.update({
          where: { id: locked.executionRunId },
          data: { status: "PAPER_EXECUTED", completedAt: fillTime },
        });
        await transaction.strategyDeployment.update({
          where: { id: deployment.id },
          data: {
            consecutiveLosses:
              locked.side === "SELL"
                ? realizedPnl < 0
                  ? { increment: 1 }
                  : 0
                : deployment.consecutiveLosses,
          },
        });
        if (locked.strategySignalId) {
          await transaction.strategySignal.update({
            where: { id: locked.strategySignalId },
            data: { status: "PAPER_EXECUTED" },
          });
        }
        await transaction.paperTradingEvent.create({
          data: {
            paperAccountId: account.id,
            strategyDeploymentId: deployment.id,
            paperOrderId: locked.id,
            paperFillId: fill.id,
            eventType: "ORDER_FILLED",
            payloadJson: JSON.stringify({
              commission,
              fillId: fill.id,
              price,
              quantity,
              realizedPnl,
            }),
          },
        });
        return this.serializeOrder(updated);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 },
    );
  }

  async controlState() {
    return this.getControl();
  }

  async refreshEquitySnapshots(snapshotTime: Date) {
    const accounts = await this.prisma.paperAccount.findMany({ include: { positions: true } });
    const results = [];
    for (const account of accounts) {
      const pricedPositions = await Promise.all(
        account.positions.map(async (position) => {
          const bar = await this.prisma.marketDataDaily.findFirst({
            where: { symbol: position.symbol, tradeDate: { lte: snapshotTime } },
            orderBy: [{ tradeDate: "desc" }, { updatedAt: "desc" }],
          });
          const price = bar ? toNumber(bar.close) : toNumber(position.currentPrice);
          const quantity = toNumber(position.quantity);
          const avgCost = toNumber(position.avgCost);
          return {
            id: position.id,
            marketValue: quantity * price,
            price,
            unrealizedPnl: quantity * (price - avgCost),
          };
        }),
      );
      const result = await this.prisma.$transaction(
        async (transaction) => {
          for (const position of pricedPositions) {
            await transaction.paperPosition.update({
              where: { id: position.id },
              data: {
                currentPrice: position.price,
                marketValue: position.marketValue,
                unrealizedPnl: position.unrealizedPnl,
              },
            });
          }
          const positionValue = pricedPositions.reduce(
            (sum, position) => sum + position.marketValue,
            0,
          );
          const unrealizedPnl = pricedPositions.reduce(
            (sum, position) => sum + position.unrealizedPnl,
            0,
          );
          const totalEquity = toNumber(account.cashBalance) + positionValue;
          const peakEquity = Math.max(toNumber(account.peakEquity), totalEquity);
          const drawdown = peakEquity > 0 ? (totalEquity / peakEquity - 1) * 100 : 0;
          await transaction.paperAccount.update({
            where: { id: account.id },
            data: {
              maxDrawdown: Math.min(toNumber(account.maxDrawdown), drawdown),
              peakEquity,
              totalEquity,
              unrealizedPnl,
            },
          });
          await transaction.paperAccountEquitySnapshot.upsert({
            where: { paperAccountId_snapshotTime: { paperAccountId: account.id, snapshotTime } },
            update: {
              cashBalance: account.cashBalance,
              drawdown,
              positionValue,
              realizedPnl: account.realizedPnl,
              totalEquity,
              unrealizedPnl,
            },
            create: {
              paperAccountId: account.id,
              snapshotTime,
              cashBalance: account.cashBalance,
              drawdown,
              positionValue,
              realizedPnl: account.realizedPnl,
              totalEquity,
              unrealizedPnl,
              source: "V1_5_DAILY_MARK",
            },
          });
          return { accountId: account.id, drawdown, positionValue, totalEquity };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 },
      );
      results.push(result);
    }
    return results;
  }

  private cancelOrder(order: PaperOrder, reason: string) {
    return this.prisma.paperOrder
      .update({
        where: { id: order.id },
        data: { status: "CANCELLED", cancelledAt: new Date(), rejectionReason: reason },
      })
      .then((updated) => this.serializeOrder(updated));
  }

  private async executionResult(id: string, idempotent: boolean) {
    const run = await this.prisma.strategyExecutionRun.findUnique({
      where: { id },
      include: { orders: { include: { fills: true, riskDecisions: true } } },
    });
    if (!run) throw new NotFoundException("模拟执行任务不存在");
    return {
      ...run,
      idempotent,
      inputSnapshot: JSON.parse(run.inputSnapshotJson),
      result: run.resultJson ? JSON.parse(run.resultJson) : null,
      orders: run.orders.map((order) => this.serializeOrder(order)),
    };
  }

  private getControl() {
    return this.prisma.paperTradingControl.upsert({
      where: { id: "global" },
      update: {},
      create: { id: "global", killSwitchEnabled: false },
    });
  }

  private event(
    paperAccountId: string,
    eventType: string,
    payload: Record<string, unknown>,
    strategyDeploymentId?: string,
    paperOrderId?: string,
  ) {
    return this.prisma.paperTradingEvent.create({
      data: {
        paperAccountId,
        strategyDeploymentId,
        paperOrderId,
        eventType,
        payloadJson: JSON.stringify(payload),
      },
    });
  }

  private serializePaperAccount<T extends Prisma.PaperAccountGetPayload<Record<string, never>>>(
    account: T,
  ) {
    return {
      ...account,
      cashBalance: toNumber(account.cashBalance),
      initialCapital: toNumber(account.initialCapital),
      maxDrawdown: toNumber(account.maxDrawdown),
      peakEquity: toNumber(account.peakEquity),
      realizedPnl: toNumber(account.realizedPnl),
      totalEquity: toNumber(account.totalEquity),
      unrealizedPnl: toNumber(account.unrealizedPnl),
    };
  }

  private serializePosition<T extends Prisma.PaperPositionGetPayload<Record<string, never>>>(
    position: T,
  ) {
    return {
      ...position,
      avgCost: toNumber(position.avgCost),
      currentPrice: toNumber(position.currentPrice),
      marketValue: toNumber(position.marketValue),
      quantity: toNumber(position.quantity),
      realizedPnl: toNumber(position.realizedPnl),
      unrealizedPnl: toNumber(position.unrealizedPnl),
    };
  }

  private serializeOrder<T extends Prisma.PaperOrderGetPayload<Record<string, never>>>(order: T) {
    return {
      ...order,
      approvedQuantity: order.approvedQuantity === null ? null : toNumber(order.approvedQuantity),
      commissionRate: toNumber(order.commissionRate),
      referencePrice: order.referencePrice === null ? null : toNumber(order.referencePrice),
      requestedAmount: order.requestedAmount === null ? null : toNumber(order.requestedAmount),
      requestedQuantity:
        order.requestedQuantity === null ? null : toNumber(order.requestedQuantity),
      slippageRate: toNumber(order.slippageRate),
    };
  }

  private mapBar(bar: Prisma.MarketDataDailyGetPayload<Record<string, never>>) {
    return {
      symbol: bar.symbol,
      tradeDate: bar.tradeDate.toISOString().slice(0, 10),
      open: toNumber(bar.open),
      high: toNumber(bar.high),
      low: toNumber(bar.low),
      close: toNumber(bar.close),
      adjustedClose: toNumber(bar.adjustedClose),
      volume: toNumber(bar.volume),
      dividend: toNumber(bar.dividend),
      splitFactor: toNumber(bar.splitFactor),
      currency: bar.currency,
      source: bar.source,
    };
  }

  private utcDate(input: string) {
    const date = new Date(`${input.slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new BadRequestException("日期格式必须为 YYYY-MM-DD");
    return date;
  }
}
