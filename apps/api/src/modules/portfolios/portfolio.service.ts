import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { toNumber } from "../../common/decimal";
import { PrismaService } from "../../prisma/prisma.service";
import { UsMarketCalendarService } from "../market-data/us-market-calendar.service";
import { QuantEngineClient } from "../quant-engine/quant-engine.client";
import type {
  AddPortfolioStrategyDto,
  CreatePortfolioDto,
  PortfolioStatusDto,
  PortfolioStrategyStatusDto,
  PreviewPortfolioRunDto,
  UpdatePortfolioAllocationDto,
  UpdatePortfolioRiskDto,
} from "./portfolio.dto";
import {
  allocatePortfolioCapital,
  portfolioOrderKey,
  portfolioRunKey,
  evaluatePortfolioRisk,
  resolveSignalConflicts,
  type AllocationCandidate,
  type ConflictPolicy,
  type PortfolioRiskViolation,
  type RawPortfolioSignal,
} from "./portfolio.rules";

const ELIGIBLE_STRATEGY_STATUSES = new Set([
  "PAPER_APPROVED",
  "PAPER_RUNNING",
  "PAPER_OBSERVING",
  "PAPER_PAUSED",
]);
const ELIGIBLE_DEPLOYMENT_STATUSES = new Set([
  "PAPER_APPROVED",
  "PAPER_RUNNING",
  "PAPER_OBSERVING",
  "PAPER_PAUSED",
]);
const dateOnly = (input: string) => new Date(`${input}T00:00:00.000Z`);
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const roundQuantity = (value: number) => Math.round((value + Number.EPSILON) * 1e8) / 1e8;

type PortfolioBundle = Prisma.StrategyPortfolioGetPayload<{
  include: {
    allocationRules: true;
    attributions: true;
    auditEvents: true;
    cashMovements: true;
    orders: { include: { allocations: true; fills: { include: { allocations: true } } } };
    positions: true;
    rebalanceRuns: true;
    riskRules: true;
    snapshots: true;
    strategies: {
      include: {
        deployment: true;
        positions: true;
        strategy: true;
      };
    };
  };
}>;

@Injectable()
export class PortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: UsMarketCalendarService,
    private readonly quantEngine: QuantEngineClient,
  ) {}

  async list() {
    const portfolios = await this.prisma.strategyPortfolio.findMany({
      include: {
        _count: {
          select: { orders: true, positions: true, rebalanceRuns: true, strategies: true },
        },
        snapshots: { orderBy: { snapshotDate: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "asc" },
    });
    return portfolios.map((portfolio) => ({
      ...this.serializePortfolioBase(portfolio),
      counts: portfolio._count,
      latestSnapshot: portfolio.snapshots[0]
        ? this.serializeSnapshot(portfolio.snapshots[0])
        : null,
    }));
  }

  async dashboard(portfolioId?: string) {
    const portfolio = portfolioId
      ? await this.bundle(portfolioId)
      : await this.prisma.strategyPortfolio.findFirst({
          include: this.bundleInclude(),
          orderBy: { createdAt: "asc" },
        });
    const availableStrategies = await this.prisma.strategy.findMany({
      where: { approvalStatus: { in: [...ELIGIBLE_STRATEGY_STATUSES] } },
      include: {
        paperDeployments: {
          where: { status: { in: [...ELIGIBLE_DEPLOYMENT_STATUSES] } },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { name: "asc" },
    });
    const control = await this.prisma.paperTradingControl.findUnique({ where: { id: "global" } });
    return {
      availableStrategies: availableStrategies.map((strategy) => ({
        approvalStatus: strategy.approvalStatus,
        code: strategy.code,
        deployments: strategy.paperDeployments.map((deployment) => ({
          id: deployment.id,
          name: deployment.name,
          status: deployment.status,
        })),
        id: strategy.id,
        name: strategy.name,
        symbolUniverse: JSON.parse(strategy.symbolUniverse) as string[],
      })),
      control: {
        killSwitchEnabled: control?.killSwitchEnabled ?? false,
        reason: control?.reason ?? null,
      },
      portfolio: portfolio ? this.serializeBundle(portfolio) : null,
      safeguards: {
        failClosedPortfolioRisk: true,
        immutableAllocationVersions: true,
        independentPortfolioLedger: true,
        noBrokerOrders: true,
        originalSignalsPreserved: true,
        tPlusOneOpenFill: true,
      },
    };
  }

  async autoRebalanceDecision(portfolioId: string) {
    const portfolio = await this.bundle(portfolioId);
    if (portfolio.status !== "PAPER_RUNNING") {
      return { reason: "组合未处于 PAPER_RUNNING", run: false };
    }
    if (portfolio.rebalanceMode === "MANUAL") {
      return { reason: "手动再平衡只允许用户显式执行", run: false };
    }
    if (portfolio.rebalanceMode === "SCHEDULED") {
      return { reason: "定期再平衡随每日交易闭环执行", run: true };
    }
    if (portfolio.rebalanceMode === "THRESHOLD") {
      const equity = Math.max(toNumber(portfolio.totalEquity), 1);
      const drift = portfolio.strategies.map((member) => {
        const memberEquity =
          toNumber(member.virtualCash) +
          member.positions.reduce((sum, position) => sum + toNumber(position.marketValue), 0);
        const actualPercent = (memberEquity / equity) * 100;
        return {
          actualPercent,
          driftPercent: Math.abs(actualPercent - toNumber(member.targetAllocationPercent)),
          memberId: member.id,
        };
      });
      const breached = drift.some((item) => item.driftPercent >= 5);
      return {
        details: drift,
        reason: breached ? "成员资金占比偏离目标至少 5%" : "成员资金偏离未达到 5% 阈值",
        run: breached,
      };
    }
    try {
      const rule = portfolio.riskRules.at(-1);
      if (!rule) return { reason: "组合风控规则缺失；默认不执行", run: false };
      const review = await this.portfolioRiskReview(
        portfolio,
        rule,
        { cashAfter: toNumber(portfolio.cashBalance), commission: 0 },
        [],
      );
      const breached = review.violations.some((item) =>
        ["DANGER", "VIOLATION"].includes(item.level),
      );
      return {
        details: review.violations,
        reason: breached ? "组合风险阈值已触发" : "组合风险阈值未触发",
        run: breached,
      };
    } catch (error: unknown) {
      return {
        reason: error instanceof Error ? `组合风控检测失败：${error.message}` : "组合风控检测失败",
        run: false,
      };
    }
  }

  async create(dto: CreatePortfolioDto) {
    const result = await this.prisma.$transaction(
      async (transaction) => {
        const portfolio = await transaction.strategyPortfolio.create({
          data: {
            allocationMode: dto.allocationMode,
            baseCurrency: dto.baseCurrency ?? "USD",
            cashBalance: dto.initialCapital,
            cashReservePercent: dto.cashReservePercent,
            conflictPolicy: dto.conflictPolicy ?? "NETTING",
            description: dto.description,
            initialCapital: dto.initialCapital,
            name: dto.name,
            peakEquity: dto.initialCapital,
            rebalanceMode: dto.rebalanceMode,
            totalEquity: dto.initialCapital,
          },
        });
        await transaction.portfolioAllocationRule.create({
          data: {
            allocationMode: dto.allocationMode,
            configurationJson: JSON.stringify({ items: [], source: "PORTFOLIO_CREATED" }),
            portfolioId: portfolio.id,
            version: 1,
          },
        });
        await transaction.portfolioRiskRule.create({
          data: { portfolioId: portfolio.id, version: 1 },
        });
        const now = new Date();
        await transaction.portfolioCashMovement.create({
          data: {
            amount: dto.initialCapital,
            balanceAfter: dto.initialCapital,
            description: "组合模拟初始资金；不涉及真实账户",
            eventTime: now,
            idempotencyKey: `PORTFOLIO_INITIAL_CAPITAL:${portfolio.id}`,
            movementType: "INITIAL_CAPITAL",
            portfolioId: portfolio.id,
          },
        });
        await transaction.portfolioAuditEvent.create({
          data: {
            eventType: "PORTFOLIO_CREATED",
            payloadJson: JSON.stringify({
              allocationMode: dto.allocationMode,
              cashReservePercent: dto.cashReservePercent,
              initialCapital: dto.initialCapital,
              noBrokerOrder: true,
            }),
            portfolioId: portfolio.id,
          },
        });
        return portfolio;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.serializePortfolioBase(result);
  }

  async addStrategy(portfolioId: string, dto: AddPortfolioStrategyDto) {
    const portfolio = await this.requirePortfolio(portfolioId);
    if (["STOPPED"].includes(portfolio.status))
      throw new BadRequestException("已停止组合不能新增策略");
    const strategy = await this.prisma.strategy.findUnique({
      where: { id: dto.strategyId },
      include: { paperDeployments: true },
    });
    if (!strategy || !ELIGIBLE_STRATEGY_STATUSES.has(strategy.approvalStatus)) {
      throw new BadRequestException("只有已通过验证并允许 Paper 部署的策略才能加入组合");
    }
    const deployment = dto.strategyDeploymentId
      ? strategy.paperDeployments.find((item) => item.id === dto.strategyDeploymentId)
      : strategy.paperDeployments.find((item) => ELIGIBLE_DEPLOYMENT_STATUSES.has(item.status));
    if (!deployment || !ELIGIBLE_DEPLOYMENT_STATUSES.has(deployment.status)) {
      throw new BadRequestException("策略必须存在允许部署或观察中的模拟部署");
    }
    const symbols = JSON.parse(strategy.symbolUniverse) as string[];
    const leveragedCount = await this.prisma.instrument.count({
      where: { assetType: "LEVERAGED_ETF", symbol: { in: symbols } },
    });
    const riskRule = await this.latestRiskRule(portfolioId);
    if (
      leveragedCount > 0 &&
      dto.maxCapitalPercent > toNumber(riskRule.leveragedStrategyMaxPercent)
    ) {
      throw new BadRequestException("杠杆 ETF 策略必须使用更低的组合资金上限");
    }
    const created = await this.prisma.$transaction(
      async (transaction) => {
        const member = await transaction.portfolioStrategy.create({
          data: {
            manualAmount: dto.manualAmount,
            maxCapitalPercent: dto.maxCapitalPercent,
            portfolioId,
            priority: dto.priority ?? 100,
            strategyDeploymentId: deployment.id,
            strategyId: strategy.id,
            targetAllocationPercent: dto.targetAllocationPercent,
          },
          include: { deployment: true, positions: true, strategy: true },
        });
        await transaction.portfolioAuditEvent.create({
          data: {
            eventType: "STRATEGY_ADDED",
            payloadJson: JSON.stringify({
              deploymentId: deployment.id,
              maxCapitalPercent: dto.maxCapitalPercent,
              strategyId: strategy.id,
              targetAllocationPercent: dto.targetAllocationPercent,
            }),
            portfolioId,
            portfolioStrategyId: member.id,
          },
        });
        return member;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.serializeMember(created);
  }

  async updateStrategyStatus(
    portfolioId: string,
    memberId: string,
    dto: PortfolioStrategyStatusDto,
  ) {
    const member = await this.prisma.portfolioStrategy.findFirst({
      where: { id: memberId, portfolioId },
      include: { deployment: true, positions: true, strategy: true },
    });
    if (!member) throw new NotFoundException("组合成员策略不存在");
    const status = dto.action === "PAUSE" ? "PAUSED" : "ACTIVE";
    if (dto.action === "RESUME") {
      const portfolio = await this.requirePortfolio(portfolioId);
      if (portfolio.status === "STOPPED") throw new BadRequestException("已停止组合不能恢复策略");
      if (!ELIGIBLE_STRATEGY_STATUSES.has(member.strategy.approvalStatus)) {
        throw new BadRequestException("策略已不再满足组合部署条件");
      }
      if (!member.deployment || !ELIGIBLE_DEPLOYMENT_STATUSES.has(member.deployment.status)) {
        throw new BadRequestException("策略模拟部署已不再允许运行");
      }
      const control = await this.prisma.paperTradingControl.findUnique({ where: { id: "global" } });
      if (control?.killSwitchEnabled) throw new BadRequestException("全局 Kill Switch 已启用");
    }
    if (dto.action === "PAUSE") {
      await this.cancelOpenOrders(
        portfolioId,
        dto.reason?.trim() || `组合成员策略 ${member.strategy.code} 已暂停`,
        memberId,
      );
    }
    const updated = await this.prisma.portfolioStrategy.update({
      where: { id: memberId },
      data: { status },
      include: { deployment: true, positions: true, strategy: true },
    });
    await this.prisma.portfolioAuditEvent.create({
      data: {
        eventType: `PORTFOLIO_STRATEGY_${dto.action}`,
        payloadJson: JSON.stringify({ reason: dto.reason, resultingStatus: status }),
        portfolioId,
        portfolioStrategyId: memberId,
      },
    });
    return this.serializeMember(updated);
  }

  async updateAllocation(portfolioId: string, dto: UpdatePortfolioAllocationDto) {
    const portfolio = await this.bundle(portfolioId);
    const riskRule = portfolio.riskRules.at(-1);
    if (!riskRule) throw new BadRequestException("组合缺少风控规则；默认拒绝分配变更");
    const instruments = await this.instrumentMap(
      portfolio.strategies.flatMap((item) => JSON.parse(item.strategy.symbolUniverse) as string[]),
    );
    const itemMap = new Map(dto.items.map((item) => [item.portfolioStrategyId, item]));
    const candidates: AllocationCandidate[] = portfolio.strategies.map((member) => {
      const item = itemMap.get(member.id);
      if (!item) throw new BadRequestException(`缺少策略 ${member.strategy.name} 的分配参数`);
      const symbols = JSON.parse(member.strategy.symbolUniverse) as string[];
      return {
        id: member.id,
        isLeveraged: symbols.some(
          (symbol) => instruments.get(symbol)?.assetType === "LEVERAGED_ETF",
        ),
        manualAmount: item.manualAmount,
        maxCapitalPercent: toNumber(member.maxCapitalPercent),
        riskBudget: item.riskBudget,
        targetAllocationPercent: item.targetAllocationPercent,
        volatility: item.volatility,
      };
    });
    const allocation = allocatePortfolioCapital({
      candidates,
      cashReservePercent: toNumber(portfolio.cashReservePercent),
      initialCapital: toNumber(portfolio.initialCapital),
      leveragedStrategyMaxPercent: toNumber(riskRule.leveragedStrategyMaxPercent),
      mode: dto.allocationMode,
    });
    if (!allocation.valid) throw new BadRequestException(allocation.errors);
    const nextVirtualCash = new Map<string, number>();
    for (const row of allocation.allocations) {
      const member = portfolio.strategies.find((item) => item.id === row.candidateId);
      if (!member) throw new BadRequestException("组合资金分配包含未知成员策略");
      const cash = roundMoney(
        toNumber(member.virtualCash) + row.amount - toNumber(member.virtualCapital),
      );
      if (cash < -0.01) {
        throw new BadRequestException(
          `策略 ${member.strategy.name} 的新分配低于已占用资金，预计虚拟现金将为负数`,
        );
      }
      nextVirtualCash.set(member.id, cash);
    }
    const latestVersion = portfolio.allocationRules.at(-1)?.version ?? 0;
    await this.prisma.$transaction(
      async (transaction) => {
        for (const row of allocation.allocations) {
          const source = itemMap.get(row.candidateId);
          await transaction.portfolioStrategy.update({
            where: { id: row.candidateId },
            data: {
              manualAmount: source?.manualAmount,
              targetAllocationPercent: row.percentOfCapital,
              virtualCapital: row.amount,
              virtualCash: nextVirtualCash.get(row.candidateId) ?? row.amount,
            },
          });
        }
        await transaction.strategyPortfolio.update({
          where: { id: portfolioId },
          data: { allocationMode: dto.allocationMode },
        });
        await transaction.portfolioAllocationRule.create({
          data: {
            allocationMode: dto.allocationMode,
            configurationJson: JSON.stringify({
              allocation,
              input: dto.items,
            }),
            portfolioId,
            version: latestVersion + 1,
          },
        });
        await transaction.portfolioAuditEvent.create({
          data: {
            eventType: "ALLOCATION_VERSION_CREATED",
            payloadJson: JSON.stringify({ allocation, version: latestVersion + 1 }),
            portfolioId,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return { ...allocation, version: latestVersion + 1 };
  }

  async updateRiskRules(portfolioId: string, dto: UpdatePortfolioRiskDto) {
    await this.requirePortfolio(portfolioId);
    const current = await this.latestRiskRule(portfolioId);
    const created = await this.prisma.portfolioRiskRule.create({
      data: { ...dto, portfolioId, version: current.version + 1 },
    });
    await this.audit(portfolioId, "RISK_RULE_VERSION_CREATED", {
      rules: dto,
      version: created.version,
    });
    return this.serializeRiskRule(created);
  }

  async updateStatus(portfolioId: string, dto: PortfolioStatusDto) {
    const portfolio = await this.bundle(portfolioId);
    let data: Prisma.StrategyPortfolioUpdateInput = {};
    if (dto.action === "VALIDATE") {
      if (portfolio.status !== "DRAFT") throw new BadRequestException("只有草稿组合可以进入验证");
      if (portfolio.strategies.length < 2)
        throw new BadRequestException("组合验证至少需要两个策略");
      const allocated = portfolio.strategies.reduce(
        (sum, member) => sum + toNumber(member.virtualCapital),
        0,
      );
      const investable =
        toNumber(portfolio.initialCapital) * (1 - toNumber(portfolio.cashReservePercent) / 100);
      if (allocated <= 0 || allocated > investable + 0.01) {
        throw new BadRequestException("组合必须先完成资金分配并保留现金储备");
      }
      if (
        portfolio.strategies.some(
          (member) =>
            (toNumber(member.virtualCapital) / toNumber(portfolio.initialCapital)) * 100 >
            toNumber(member.maxCapitalPercent) + 1e-8,
        )
      ) {
        throw new BadRequestException("成员策略资金分配超过其最大资金占比");
      }
      data = { status: "VALIDATING" };
    } else if (dto.action === "APPROVE") {
      if (portfolio.status !== "VALIDATING")
        throw new BadRequestException("只有验证中的组合可以审批");
      data = { status: "PAPER_APPROVED" };
    } else if (dto.action === "START" || dto.action === "RESUME") {
      if (!["PAPER_APPROVED", "PAUSED", "PAPER_RUNNING"].includes(portfolio.status)) {
        throw new BadRequestException("组合当前状态不允许启动");
      }
      const control = await this.prisma.paperTradingControl.findUnique({ where: { id: "global" } });
      if (control?.killSwitchEnabled)
        throw new BadRequestException("全局 Kill Switch 已启用，组合不得启动");
      data = {
        noNewPositions: false,
        pausedAt: null,
        readOnlyMode: false,
        status: "PAPER_RUNNING",
      };
    } else if (dto.action === "PAUSE") {
      if (portfolio.status !== "PAPER_RUNNING")
        throw new BadRequestException("只有运行中的组合可以暂停");
      await this.cancelOpenOrders(portfolioId, dto.reason ?? "组合人工暂停");
      data = { pausedAt: new Date(), status: "PAUSED" };
    } else if (dto.action === "STOP") {
      if (portfolio.status === "STOPPED") throw new BadRequestException("组合已经停止");
      data = { status: "STOPPED", stoppedAt: new Date() };
      await this.cancelOpenOrders(portfolioId, dto.reason ?? "组合人工停止");
    } else if (dto.action === "NO_NEW_POSITIONS") {
      if (portfolio.status === "STOPPED")
        throw new BadRequestException("已停止组合不能修改开仓控制");
      data = { noNewPositions: dto.enabled ?? true };
    } else if (dto.action === "READ_ONLY") {
      if (portfolio.status === "STOPPED")
        throw new BadRequestException("已停止组合不能修改只读状态");
      data = { readOnlyMode: dto.enabled ?? true };
      if (dto.enabled ?? true)
        await this.cancelOpenOrders(portfolioId, dto.reason ?? "组合进入只读观察模式");
    } else if (dto.action === "CANCEL_OPEN_ORDERS") {
      await this.cancelOpenOrders(portfolioId, dto.reason ?? "人工撤销全部组合未成交模拟订单");
    }
    const updated = await this.prisma.strategyPortfolio.update({
      where: { id: portfolioId },
      data,
    });
    await this.audit(portfolioId, `PORTFOLIO_${dto.action}`, {
      enabled: dto.enabled,
      reason: dto.reason,
      resultingStatus: updated.status,
    });
    return this.serializePortfolioBase(updated);
  }

  async previewOrExecute(portfolioId: string, dto: PreviewPortfolioRunDto) {
    const session = this.calendar.session(dto.tradeDate);
    if (!session.isTradingDay) throw new BadRequestException("组合运行日期必须是美股交易日");
    if (dto.execute) await this.assertNotLockdown();
    const portfolio = await this.bundle(portfolioId);
    const allocationRule = portfolio.allocationRules.at(-1);
    const riskRule = portfolio.riskRules.at(-1);
    if (!allocationRule || !riskRule) throw new BadRequestException("组合规则不可用；风控默认拒绝");
    const runType = dto.runType ?? portfolio.rebalanceMode;
    const conflictPolicy = (dto.conflictPolicy ?? portfolio.conflictPolicy) as ConflictPolicy;
    const idempotencyKey = portfolioRunKey(portfolioId, session.date, runType);
    const existing = await this.prisma.portfolioRebalanceRun.findUnique({
      where: { idempotencyKey },
      include: { orders: { include: { allocations: true, fills: true } }, signalIntents: true },
    });
    if (existing) {
      if (dto.execute && existing.previewOnly && existing.status === "PREVIEWED") {
        return this.executeExistingRun(existing.id);
      }
      return { ...this.serializeRun(existing), idempotent: true };
    }
    const rawSignals = await this.rawSignals(portfolio, session.date, dto.signalIds);
    const resolution = resolveSignalConflicts(rawSignals, conflictPolicy);
    const priceMap = await this.priceMap(
      [...new Set(resolution.netOrders.map((item) => item.symbol))],
      session.date,
    );
    const proposedOrders = resolution.netOrders.map((intent) => {
      const price = priceMap.get(intent.symbol);
      if (!price)
        throw new BadRequestException(`${intent.symbol} 缺少完整交易日行情；组合运行被阻止`);
      const quantity = intent.quantity ?? roundQuantity((intent.amount ?? 0) / price.close);
      return { ...intent, quantity, referencePrice: price.close };
    });
    const estimates = this.estimateOrders(portfolio, proposedOrders);
    let riskResult: {
      allowed: boolean;
      projected?: {
        leveragedExposure: number;
        positions: Array<{
          assetType: string;
          marketValue: number;
          symbol: string;
          theme?: string | null;
        }>;
        symbolExposure: Record<string, number>;
        themeExposure: Record<string, number>;
      };
      violations: PortfolioRiskViolation[];
    };
    try {
      riskResult = await this.portfolioRiskReview(portfolio, riskRule, estimates, proposedOrders);
    } catch (error: unknown) {
      riskResult = {
        allowed: false,
        violations: [
          {
            code: "PORTFOLIO_RISK_ENGINE_FAILURE",
            level: "VIOLATION",
            message: error instanceof Error ? error.message : "组合风控服务异常；默认拒绝",
          },
        ],
      };
    }
    if (conflictPolicy === "MANUAL_REVIEW" && rawSignals.length > proposedOrders.length) {
      riskResult.violations.push({
        code: "MANUAL_REVIEW_REQUIRED",
        level: "DANGER",
        message: "冲突信号已进入人工确认，未生成组合订单",
      });
    }
    const run = await this.prisma.$transaction(
      async (transaction) => {
        const created = await transaction.portfolioRebalanceRun.create({
          data: {
            afterAllocationJson: allocationRule.configurationJson,
            allocationVersion: allocationRule.version,
            beforeAllocationJson: JSON.stringify(
              portfolio.strategies.map((item) => ({
                amount: toNumber(item.virtualCapital),
                id: item.id,
                percent: toNumber(item.targetAllocationPercent),
              })),
            ),
            conflictPolicy,
            estimatedCash: estimates.cashAfter,
            estimatedCommission: estimates.commission,
            estimatedOrdersJson: JSON.stringify(proposedOrders),
            idempotencyKey,
            netIntentsJson: JSON.stringify(resolution),
            portfolioId,
            previewOnly: true,
            rawSignalsJson: JSON.stringify(rawSignals),
            riskResultJson: JSON.stringify(riskResult),
            riskVersion: riskRule.version,
            runType,
            status: riskResult.allowed ? "PREVIEWED" : "RISK_REJECTED",
            tradeDate: dateOnly(session.date),
          },
        });
        for (const signal of rawSignals) {
          const decision = resolution.signalDecisions.find((item) => item.signalId === signal.id);
          await transaction.portfolioSignalIntent.create({
            data: {
              allocatedAmount: signal.amount,
              idempotencyKey: `${idempotencyKey}:SIGNAL:${signal.id}`,
              originalAmount: signal.amount,
              originalQuantity: signal.quantity,
              portfolioId,
              portfolioStrategyId: signal.portfolioStrategyId,
              reason: decision?.reason,
              rebalanceRunId: created.id,
              side: signal.side,
              status: decision?.status ?? "PENDING",
              strategySignalId: signal.id,
              symbol: signal.symbol,
              tradeDate: dateOnly(session.date),
            },
          });
        }
        await transaction.portfolioAuditEvent.create({
          data: {
            eventType: riskResult.allowed ? "REBALANCE_PREVIEWED" : "PORTFOLIO_RISK_REJECTED",
            payloadJson: JSON.stringify({ proposedOrders, resolution, riskResult }),
            portfolioId,
            rebalanceRunId: created.id,
            severity: riskResult.allowed ? "INFO" : "CRITICAL",
          },
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (dto.execute && riskResult.allowed) return this.executeExistingRun(run.id);
    return { ...this.serializeRun(run), proposedOrders, resolution, riskResult };
  }

  private async executeExistingRun(runId: string) {
    await this.assertNotLockdown();
    const run = await this.prisma.portfolioRebalanceRun.findUnique({
      where: { id: runId },
      include: {
        portfolio: true,
        signalIntents: { include: { portfolioStrategy: true } },
      },
    });
    if (!run) throw new NotFoundException("组合再平衡记录不存在");
    if (!run.previewOnly) return { ...this.serializeRun(run), idempotent: true };
    if (run.status !== "PREVIEWED") throw new BadRequestException("组合风控未通过，禁止模拟执行");
    if (run.portfolio.status !== "PAPER_RUNNING")
      throw new BadRequestException("组合未处于 PAPER_RUNNING");
    if (run.portfolio.readOnlyMode) throw new BadRequestException("组合处于只读观察模式");
    if (run.signalIntents.some((intent) => intent.portfolioStrategy.status !== "ACTIVE")) {
      throw new BadRequestException("组合成员策略已暂停，原预览不得继续生成订单");
    }
    const control = await this.prisma.paperTradingControl.findUnique({ where: { id: "global" } });
    if (control?.killSwitchEnabled)
      throw new BadRequestException("全局 Kill Switch 已阻止组合订单");
    const proposed = JSON.parse(run.estimatedOrdersJson) as Array<{
      allocations: Array<{ portfolioStrategyId: string; quantity: number; signalId: string }>;
      quantity: number;
      referencePrice: number;
      side: "BUY" | "SELL";
      symbol: string;
    }>;
    const nextDate = this.nextTradingDay(run.tradeDate.toISOString().slice(0, 10));
    const result = await this.prisma.$transaction(
      async (transaction) => {
        const orders = [];
        for (const item of proposed) {
          if (item.side === "BUY" && run.portfolio.noNewPositions) continue;
          const order = await transaction.portfolioOrder.create({
            data: {
              approvedQuantity: item.quantity,
              commissionRate: 0.001,
              earliestFillDate: dateOnly(nextDate),
              idempotencyKey: portfolioOrderKey(run.id, item.symbol, item.side),
              portfolioId: run.portfolioId,
              rebalanceRunId: run.id,
              referencePrice: item.referencePrice,
              requestedQuantity: item.quantity,
              side: item.side,
              signalTradeDate: run.tradeDate,
              slippageRate: 0.0005,
              status: "APPROVED",
              symbol: item.symbol,
            },
          });
          for (const allocation of item.allocations) {
            const intent = run.signalIntents.find(
              (candidate) => candidate.strategySignalId === allocation.signalId,
            );
            if (!intent) continue;
            await transaction.portfolioOrderAllocation.create({
              data: {
                notionalPercent: item.quantity > 0 ? allocation.quantity / item.quantity : 0,
                portfolioOrderId: order.id,
                portfolioSignalIntentId: intent.id,
                portfolioStrategyId: allocation.portfolioStrategyId,
                quantity: allocation.quantity,
              },
            });
          }
          orders.push(order);
        }
        const updated = await transaction.portfolioRebalanceRun.update({
          where: { id: run.id },
          data: {
            completedAt: new Date(),
            previewOnly: false,
            status: "ORDERS_CREATED",
          },
        });
        await transaction.portfolioAuditEvent.create({
          data: {
            eventType: "PORTFOLIO_ORDERS_CREATED",
            payloadJson: JSON.stringify({ nextFillDate: nextDate, orderCount: orders.length }),
            portfolioId: run.portfolioId,
            rebalanceRunId: run.id,
          },
        });
        return { orders, run: updated };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return {
      ...this.serializeRun(result.run),
      orders: result.orders.map((order) => this.serializeOrder(order)),
    };
  }

  async processPendingOrders() {
    const [control, brokerSafety] = await Promise.all([
      this.prisma.paperTradingControl.findUnique({ where: { id: "global" } }),
      this.prisma.brokerConnection.findUnique({
        where: { id: "broker-connection-ibkr-readonly" },
        select: { safetyState: true },
      }),
    ]);
    const latestCompletedDate = this.calendar.latestCompletedSession().date;
    const orders = await this.prisma.portfolioOrder.findMany({
      where: { status: { in: ["APPROVED", "WAITING_MARKET_DATA"] } },
      include: {
        allocations: {
          include: { portfolioStrategy: { include: { positions: true } }, signalIntent: true },
        },
        portfolio: true,
      },
      orderBy: { createdAt: "asc" },
    });
    const results = [];
    for (const order of orders) {
      const fillDate = order.earliestFillDate?.toISOString().slice(0, 10);
      if (!fillDate) continue;
      if (fillDate > latestCompletedDate) continue;
      if (
        control?.killSwitchEnabled ||
        brokerSafety?.safetyState === "LOCKDOWN" ||
        order.portfolio.status !== "PAPER_RUNNING" ||
        order.portfolio.readOnlyMode
      ) {
        const reason =
          brokerSafety?.safetyState === "LOCKDOWN"
            ? "全局安全状态为 LOCKDOWN"
            : control?.killSwitchEnabled
              ? "全局 Kill Switch 已启用"
              : "组合暂停、停止或处于只读观察模式";
        await this.cancelOrder(order.id, order.portfolioId, reason);
        results.push({ orderId: order.id, status: "CANCELLED" });
        continue;
      }
      const price = await this.prisma.marketDataDaily.findFirst({
        where: { symbol: order.symbol, tradeDate: dateOnly(fillDate) },
      });
      if (!price) {
        await this.prisma.portfolioOrder.update({
          where: { id: order.id },
          data: { status: "WAITING_MARKET_DATA" },
        });
        continue;
      }
      results.push(await this.fillOrder(order.id, price));
    }
    return results;
  }

  private async fillOrder(
    orderId: string,
    price: Prisma.MarketDataDailyGetPayload<Record<string, never>>,
  ) {
    return this.prisma.$transaction(
      async (transaction) => {
        const order = await transaction.portfolioOrder.findUnique({
          where: { id: orderId },
          include: {
            allocations: {
              include: { portfolioStrategy: { include: { positions: true } }, signalIntent: true },
            },
            portfolio: { include: { positions: true } },
          },
        });
        if (!order) throw new NotFoundException("组合模拟订单不存在");
        if (order.status === "FILLED") return { idempotent: true, orderId };
        if (!["APPROVED", "WAITING_MARKET_DATA"].includes(order.status)) {
          return { idempotent: true, orderId, status: order.status };
        }
        const [control, brokerSafety] = await Promise.all([
          transaction.paperTradingControl.findUnique({ where: { id: "global" } }),
          transaction.brokerConnection.findUnique({
            where: { id: "broker-connection-ibkr-readonly" },
            select: { safetyState: true },
          }),
        ]);
        if (
          control?.killSwitchEnabled ||
          brokerSafety?.safetyState === "LOCKDOWN" ||
          order.portfolio.status !== "PAPER_RUNNING" ||
          order.portfolio.readOnlyMode
        ) {
          const reason =
            brokerSafety?.safetyState === "LOCKDOWN"
              ? "全局安全状态为 LOCKDOWN"
              : control?.killSwitchEnabled
                ? "全局 Kill Switch 已启用"
                : "组合暂停、停止或只读时不得模拟成交";
          await transaction.portfolioOrder.update({
            where: { id: order.id },
            data: { cancelledAt: new Date(), rejectionReason: reason, status: "CANCELLED" },
          });
          await transaction.portfolioAuditEvent.create({
            data: {
              eventType: "PORTFOLIO_ORDER_CANCELLED",
              payloadJson: JSON.stringify({ reason }),
              portfolioId: order.portfolioId,
              portfolioOrderId: order.id,
            },
          });
          return { orderId, status: "CANCELLED" };
        }
        const quantity = toNumber(order.approvedQuantity);
        const open = toNumber(price.open);
        const slippageRate = toNumber(order.slippageRate);
        const executionPrice =
          order.side === "BUY" ? open * (1 + slippageRate) : open * (1 - slippageRate);
        const notional = roundMoney(executionPrice * quantity);
        const commission = roundMoney(notional * toNumber(order.commissionRate));
        const cashDelta = order.side === "BUY" ? -(notional + commission) : notional - commission;
        const reserve =
          toNumber(order.portfolio.initialCapital) *
          (toNumber(order.portfolio.cashReservePercent) / 100);
        const cashAfter = roundMoney(toNumber(order.portfolio.cashBalance) + cashDelta);
        if (order.side === "BUY" && cashAfter < reserve - 0.01) {
          await transaction.portfolioOrder.update({
            where: { id: order.id },
            data: {
              rejectionReason: "实际开盘价导致现金低于组合储备下限",
              status: "RISK_REJECTED",
            },
          });
          return { orderId, status: "RISK_REJECTED" };
        }
        const existing = order.portfolio.positions.find((item) => item.symbol === order.symbol);
        if (order.side === "SELL" && (!existing || toNumber(existing.quantity) + 1e-8 < quantity)) {
          await transaction.portfolioOrder.update({
            where: { id: order.id },
            data: { rejectionReason: "组合持仓不足，禁止裸空", status: "RISK_REJECTED" },
          });
          return { orderId, status: "RISK_REJECTED" };
        }
        const realized =
          order.side === "SELL" && existing
            ? roundMoney((executionPrice - toNumber(existing.avgCost)) * quantity - commission)
            : 0;
        const newQuantity =
          order.side === "BUY"
            ? toNumber(existing?.quantity) + quantity
            : toNumber(existing?.quantity) - quantity;
        const avgCost =
          order.side === "BUY"
            ? (toNumber(existing?.quantity) * toNumber(existing?.avgCost) + notional + commission) /
              Math.max(newQuantity, 1e-8)
            : toNumber(existing?.avgCost);
        const instrument = await transaction.instrument.findUnique({
          where: { symbol: order.symbol },
        });
        if (!instrument) throw new BadRequestException(`${order.symbol} 标的信息不存在`);
        if (newQuantity <= 1e-8 && existing) {
          await transaction.portfolioPosition.delete({ where: { id: existing.id } });
        } else {
          await transaction.portfolioPosition.upsert({
            where: { portfolioId_symbol: { portfolioId: order.portfolioId, symbol: order.symbol } },
            create: {
              assetType: instrument.assetType,
              avgCost,
              currentPrice: executionPrice,
              marketValue: newQuantity * executionPrice,
              openedAt: price.tradeDate,
              portfolioId: order.portfolioId,
              quantity: newQuantity,
              realizedPnl: realized,
              symbol: order.symbol,
              theme: instrument.theme,
              unrealizedPnl: (executionPrice - avgCost) * newQuantity,
            },
            update: {
              avgCost,
              currentPrice: executionPrice,
              marketValue: newQuantity * executionPrice,
              quantity: newQuantity,
              realizedPnl: { increment: realized },
              unrealizedPnl: (executionPrice - avgCost) * newQuantity,
            },
          });
        }
        const fill = await transaction.portfolioFill.create({
          data: {
            commission,
            executionTime: price.tradeDate,
            notional,
            portfolioOrderId: order.id,
            price: executionPrice,
            quantity,
            slippage: roundMoney(Math.abs(executionPrice - open) * quantity),
          },
        });
        for (const allocation of order.allocations) {
          const allocationRatio = toNumber(allocation.notionalPercent);
          const allocatedQuantity = roundQuantity(quantity * allocationRatio);
          const allocatedCommission = roundMoney(commission * allocationRatio);
          const memberPosition = allocation.portfolioStrategy.positions.find(
            (item) => item.symbol === order.symbol,
          );
          const memberNewQuantity =
            order.side === "BUY"
              ? toNumber(memberPosition?.quantity) + allocatedQuantity
              : toNumber(memberPosition?.quantity) - allocatedQuantity;
          const memberAvgCost =
            order.side === "BUY"
              ? (toNumber(memberPosition?.quantity) * toNumber(memberPosition?.avgCost) +
                  executionPrice * allocatedQuantity +
                  allocatedCommission) /
                Math.max(memberNewQuantity, 1e-8)
              : toNumber(memberPosition?.avgCost);
          const memberRealized =
            order.side === "SELL" && memberPosition
              ? roundMoney(
                  (executionPrice - toNumber(memberPosition.avgCost)) * allocatedQuantity -
                    allocatedCommission,
                )
              : 0;
          if (memberNewQuantity <= 1e-8 && memberPosition) {
            await transaction.portfolioStrategyPosition.delete({
              where: { id: memberPosition.id },
            });
          } else {
            await transaction.portfolioStrategyPosition.upsert({
              where: {
                portfolioStrategyId_symbol: {
                  portfolioStrategyId: allocation.portfolioStrategyId,
                  symbol: order.symbol,
                },
              },
              create: {
                avgCost: memberAvgCost,
                currentPrice: executionPrice,
                marketValue: memberNewQuantity * executionPrice,
                openedAt: price.tradeDate,
                portfolioStrategyId: allocation.portfolioStrategyId,
                quantity: memberNewQuantity,
                realizedPnl: memberRealized,
                symbol: order.symbol,
                unrealizedPnl: (executionPrice - memberAvgCost) * memberNewQuantity,
              },
              update: {
                avgCost: memberAvgCost,
                currentPrice: executionPrice,
                marketValue: memberNewQuantity * executionPrice,
                quantity: memberNewQuantity,
                realizedPnl: { increment: memberRealized },
                unrealizedPnl: (executionPrice - memberAvgCost) * memberNewQuantity,
              },
            });
          }
          await transaction.portfolioStrategy.update({
            where: { id: allocation.portfolioStrategyId },
            data: {
              realizedPnl: { increment: memberRealized },
              virtualCash: {
                increment:
                  order.side === "BUY"
                    ? -(executionPrice * allocatedQuantity + allocatedCommission)
                    : executionPrice * allocatedQuantity - allocatedCommission,
              },
            },
          });
          await transaction.portfolioFillAllocation.create({
            data: {
              commission: allocatedCommission,
              notional: roundMoney(notional * allocationRatio),
              portfolioFillId: fill.id,
              portfolioSignalIntentId: allocation.portfolioSignalIntentId,
              portfolioStrategyId: allocation.portfolioStrategyId,
              quantity: allocatedQuantity,
              realizedPnl: memberRealized,
              slippage: roundMoney(Math.abs(executionPrice - open) * allocatedQuantity),
            },
          });
        }
        await transaction.strategyPortfolio.update({
          where: { id: order.portfolioId },
          data: {
            cashBalance: cashAfter,
            realizedPnl: { increment: realized },
          },
        });
        await transaction.portfolioCashMovement.create({
          data: {
            amount: cashDelta,
            balanceAfter: cashAfter,
            description: `${order.side} ${order.symbol} 组合模拟成交`,
            eventTime: price.tradeDate,
            idempotencyKey: `PORTFOLIO_FILL_CASH:${fill.id}`,
            movementType: order.side === "BUY" ? "BUY_FILL" : "SELL_FILL",
            portfolioId: order.portfolioId,
            portfolioOrderId: order.id,
          },
        });
        await transaction.portfolioOrder.update({
          where: { id: order.id },
          data: { filledAt: price.tradeDate, status: "FILLED" },
        });
        await transaction.portfolioAuditEvent.create({
          data: {
            eventType: "PORTFOLIO_ORDER_FILLED",
            payloadJson: JSON.stringify({
              cashAfter,
              commission,
              executionPrice,
              notional,
              quantity,
            }),
            portfolioId: order.portfolioId,
            portfolioOrderId: order.id,
          },
        });
        return { cashAfter, commission, fillId: fill.id, orderId: order.id, status: "FILLED" };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async refreshSnapshot(portfolioId: string, requestedDate?: string) {
    const date = requestedDate ?? this.calendar.latestCompletedSession().date;
    const portfolio = await this.bundle(portfolioId);
    const prices = await this.priceMap(
      portfolio.positions.map((item) => item.symbol),
      date,
      true,
    );
    let positionValue = 0;
    let unrealizedPnl = 0;
    const exposures: Array<{
      assetType: string;
      marketValue: number;
      symbol: string;
      theme: string | null;
    }> = [];
    for (const position of portfolio.positions) {
      const price = prices.get(position.symbol)?.close ?? toNumber(position.currentPrice);
      const marketValue = toNumber(position.quantity) * price;
      const pnl = (price - toNumber(position.avgCost)) * toNumber(position.quantity);
      positionValue += marketValue;
      unrealizedPnl += pnl;
      exposures.push({
        assetType: position.assetType,
        marketValue,
        symbol: position.symbol,
        theme: position.theme ?? null,
      });
      await this.prisma.portfolioPosition.update({
        where: { id: position.id },
        data: { currentPrice: price, marketValue, unrealizedPnl: pnl },
      });
    }
    for (const member of portfolio.strategies) {
      for (const position of member.positions) {
        const price = prices.get(position.symbol)?.close ?? toNumber(position.currentPrice);
        const marketValue = toNumber(position.quantity) * price;
        const pnl = (price - toNumber(position.avgCost)) * toNumber(position.quantity);
        await this.prisma.portfolioStrategyPosition.update({
          where: { id: position.id },
          data: { currentPrice: price, marketValue, unrealizedPnl: pnl },
        });
      }
    }
    const totalEquity = roundMoney(toNumber(portfolio.cashBalance) + positionValue);
    const peakEquity = Math.max(toNumber(portfolio.peakEquity), totalEquity);
    const drawdown = peakEquity > 0 ? ((totalEquity - peakEquity) / peakEquity) * 100 : 0;
    const snapshotDate = dateOnly(date);
    const previous = portfolio.snapshots.filter((item) => item.snapshotDate < snapshotDate).at(-1);
    const dailyReturn = previous ? (totalEquity / toNumber(previous.totalEquity) - 1) * 100 : 0;
    const benchmarkEquity = await this.benchmarkEquity(portfolio, date);
    const snapshot = await this.prisma.$transaction(async (transaction) => {
      await transaction.strategyPortfolio.update({
        where: { id: portfolioId },
        data: {
          maxDrawdown: Math.min(toNumber(portfolio.maxDrawdown), drawdown),
          peakEquity,
          totalEquity,
          unrealizedPnl,
        },
      });
      return transaction.portfolioEquitySnapshot.upsert({
        where: { portfolioId_snapshotDate: { portfolioId, snapshotDate: dateOnly(date) } },
        create: {
          cashBalance: portfolio.cashBalance,
          benchmarkEquity,
          dailyReturn,
          drawdown,
          exposureJson: JSON.stringify(exposures),
          portfolioId,
          positionValue,
          realizedPnl: portfolio.realizedPnl,
          snapshotDate: dateOnly(date),
          totalEquity,
          totalReturn: (totalEquity / toNumber(portfolio.initialCapital) - 1) * 100,
          unrealizedPnl,
        },
        update: {
          cashBalance: portfolio.cashBalance,
          benchmarkEquity,
          dailyReturn,
          drawdown,
          exposureJson: JSON.stringify(exposures),
          positionValue,
          realizedPnl: portfolio.realizedPnl,
          totalEquity,
          totalReturn: (totalEquity / toNumber(portfolio.initialCapital) - 1) * 100,
          unrealizedPnl,
        },
      });
    });
    await this.refreshAttribution(portfolioId, date);
    return this.serializeSnapshot(snapshot);
  }

  async performance(portfolioId: string) {
    const portfolio = await this.bundle(portfolioId);
    const snapshots = portfolio.snapshots.map((item) => this.serializeSnapshot(item));
    const returns = snapshots.map((item) => item.dailyReturn / 100).filter(Number.isFinite);
    const mean = returns.length
      ? returns.reduce((sum, value) => sum + value, 0) / returns.length
      : 0;
    const variance =
      returns.length > 1
        ? returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1)
        : 0;
    const downside = returns.filter((value) => value < 0);
    const downsideDeviation = downside.length
      ? Math.sqrt(downside.reduce((sum, value) => sum + value ** 2, 0) / downside.length)
      : 0;
    const wins = portfolio.orders
      .flatMap((order) => order.fills.flatMap((fill) => fill.allocations))
      .map((item) => toNumber(item.realizedPnl))
      .filter((value) => value > 0);
    const losses = portfolio.orders
      .flatMap((order) => order.fills.flatMap((fill) => fill.allocations))
      .map((item) => toNumber(item.realizedPnl))
      .filter((value) => value < 0);
    const symbolExposure = new Map<string, number>();
    const themeExposure = new Map<string, number>();
    for (const position of portfolio.positions) {
      symbolExposure.set(position.symbol, toNumber(position.marketValue));
      const theme = position.theme ?? "UNCLASSIFIED";
      themeExposure.set(theme, (themeExposure.get(theme) ?? 0) + toNumber(position.marketValue));
    }
    const totalReturn =
      (toNumber(portfolio.totalEquity) / toNumber(portfolio.initialCapital) - 1) * 100;
    const years = Math.max(returns.length / 252, 1 / 252);
    const annualizedReturn = ((1 + totalReturn / 100) ** (1 / years) - 1) * 100;
    return {
      annualizedReturn,
      annualizedVolatility: Math.sqrt(variance) * Math.sqrt(252) * 100,
      attribution: portfolio.attributions.map((item) => this.serializeAttribution(item)),
      cashBalance: toNumber(portfolio.cashBalance),
      cashPercent:
        toNumber(portfolio.totalEquity) > 0
          ? (toNumber(portfolio.cashBalance) / toNumber(portfolio.totalEquity)) * 100
          : 0,
      idleCashDrag: portfolio.attributions.reduce((sum, item) => sum + toNumber(item.cashDrag), 0),
      maxDrawdown: toNumber(portfolio.maxDrawdown),
      opportunityCost: portfolio.attributions.reduce(
        (sum, item) => sum + toNumber(item.riskOpportunityCost),
        0,
      ),
      positions: portfolio.positions.map((item) => this.serializePosition(item)),
      profitFactor: losses.length
        ? wins.reduce((sum, value) => sum + value, 0) /
          Math.abs(losses.reduce((sum, value) => sum + value, 0))
        : wins.length
          ? 999
          : 0,
      sharpe: variance > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(252) : 0,
      snapshots,
      sortino: downsideDeviation > 0 ? (mean / downsideDeviation) * Math.sqrt(252) : 0,
      strategyAllocation: portfolio.strategies.map((item) => ({
        amount: toNumber(item.virtualCapital),
        id: item.id,
        name: item.strategy.name,
        percent: toNumber(item.targetAllocationPercent),
      })),
      symbolExposure: Object.fromEntries(symbolExposure),
      themeExposure: Object.fromEntries(themeExposure),
      totalEquity: toNumber(portfolio.totalEquity),
      totalReturn,
      totalCommission: portfolio.orders.reduce(
        (sum, order) =>
          sum + order.fills.reduce((fillSum, fill) => fillSum + toNumber(fill.commission), 0),
        0,
      ),
      totalSlippage: portfolio.orders.reduce(
        (sum, order) =>
          sum + order.fills.reduce((fillSum, fill) => fillSum + toNumber(fill.slippage), 0),
        0,
      ),
    };
  }

  async analyze(portfolioId: string) {
    const portfolio = await this.bundle(portfolioId);
    const dates = [
      ...new Set(
        portfolio.attributions.map((item) => item.attributionDate.toISOString().slice(0, 10)),
      ),
    ].sort();
    if (portfolio.strategies.length < 2 || dates.length < 2) {
      return {
        available: false,
        message: "至少需要两个策略和两个交易日的真实组合归因数据才能计算相关性。",
      };
    }
    const strategyReturns: Record<string, number[]> = {};
    const weights: Record<string, number> = {};
    const strategyThemes: Record<string, string> = {};
    const symbols = new Set<string>();
    for (const member of portfolio.strategies) {
      const cumulativeReturns = dates.map((date) => {
        const row = portfolio.attributions.find(
          (item) =>
            item.portfolioStrategyId === member.id &&
            item.attributionDate.toISOString().slice(0, 10) === date,
        );
        return row ? toNumber(row.strategyReturn) / 100 : 0;
      });
      strategyReturns[member.strategy.code] = cumulativeReturns.map((value, index) => {
        if (index === 0) return value;
        const previous = cumulativeReturns[index - 1] ?? 0;
        return 1 + previous > 0 ? (1 + value) / (1 + previous) - 1 : 0;
      });
      weights[member.strategy.code] = toNumber(member.targetAllocationPercent) / 100;
      const universe = JSON.parse(member.strategy.symbolUniverse) as string[];
      for (const symbol of universe) symbols.add(symbol);
      const instrument = await this.prisma.instrument.findFirst({
        where: { symbol: { in: universe } },
      });
      strategyThemes[member.strategy.code] = instrument?.theme ?? "UNCLASSIFIED";
    }
    const bars = await this.prisma.marketDataDaily.findMany({
      where: {
        symbol: { in: [...symbols] },
        tradeDate: { in: dates.map(dateOnly) },
      },
      orderBy: [{ symbol: "asc" }, { tradeDate: "asc" }],
    });
    const assetReturns: Record<string, number[]> = {};
    for (const symbol of symbols) {
      const byDate = new Map(
        bars
          .filter((bar) => bar.symbol === symbol)
          .map((bar) => [bar.tradeDate.toISOString().slice(0, 10), toNumber(bar.adjustedClose)]),
      );
      const closes = dates.map((date) => byDate.get(date));
      if (closes.some((value) => value === undefined)) continue;
      assetReturns[symbol] = closes.map((value, index) => {
        if (index === 0) return 0;
        const previous = closes[index - 1] ?? 0;
        return previous > 0 ? value! / previous - 1 : 0;
      });
    }
    return this.quantEngine.analyzePortfolio({
      assetReturns,
      rollingWindows: [20, 60],
      strategyReturns,
      strategyThemes,
      weights,
    });
  }

  private async rawSignals(
    portfolio: PortfolioBundle,
    tradeDate: string,
    explicitIds?: string[],
  ): Promise<RawPortfolioSignal[]> {
    const memberByStrategy = new Map(
      portfolio.strategies
        .filter((item) => item.status === "ACTIVE")
        .map((item) => [item.strategyId, item]),
    );
    let signalIds = explicitIds ?? [];
    if (!explicitIds?.length) {
      const runs = await this.prisma.strategyExecutionRun.findMany({
        where: {
          signalTradeDate: dateOnly(tradeDate),
          strategyDeploymentId: {
            in: portfolio.strategies.flatMap((item) =>
              item.strategyDeploymentId ? [item.strategyDeploymentId] : [],
            ),
          },
          strategySignalId: { not: null },
        },
        select: { strategySignalId: true },
      });
      signalIds = runs.flatMap((item) => (item.strategySignalId ? [item.strategySignalId] : []));
    }
    const signals = signalIds.length
      ? await this.prisma.strategySignal.findMany({
          where: {
            id: { in: signalIds },
            signalTime: { gte: dateOnly(tradeDate), lt: dateOnly(this.addDays(tradeDate, 1)) },
          },
        })
      : [];
    return signals.map((signal) => {
      const member = memberByStrategy.get(signal.strategyId);
      if (!member) throw new BadRequestException("原始信号不属于当前启用中的组合策略");
      if (signal.status !== "RISK_APPROVED") {
        throw new BadRequestException(`信号 ${signal.id} 未通过单策略 RiskEngine`);
      }
      if (!member.strategyDeploymentId) throw new BadRequestException("组合策略缺少模拟部署");
      return {
        amount: toNumber(signal.requestedAmount),
        id: signal.id,
        portfolioStrategyId: member.id,
        priority: member.priority,
        quantity: toNumber(signal.requestedQuantity),
        side: signal.signalType === "SELL" ? "SELL" : "BUY",
        symbol: signal.symbol,
      };
    });
  }

  private estimateOrders(
    portfolio: PortfolioBundle,
    orders: Array<{ quantity: number; referencePrice: number; side: "BUY" | "SELL" }>,
  ) {
    let cashAfter = toNumber(portfolio.cashBalance);
    let commission = 0;
    for (const order of orders) {
      const notional = order.quantity * order.referencePrice;
      const fee = notional * 0.001;
      commission += fee;
      cashAfter += order.side === "BUY" ? -(notional + fee) : notional - fee;
    }
    return { cashAfter: roundMoney(cashAfter), commission: roundMoney(commission) };
  }

  private async portfolioRiskReview(
    portfolio: PortfolioBundle,
    rule: Prisma.PortfolioRiskRuleGetPayload<Record<string, never>>,
    estimates: { cashAfter: number; commission: number },
    orders: Array<{
      allocations: Array<{ portfolioStrategyId: string }>;
      quantity: number;
      referencePrice: number;
      side: "BUY" | "SELL";
      symbol: string;
    }>,
  ) {
    const positionMap = new Map(
      portfolio.positions.map((position) => [
        position.symbol,
        {
          assetType: position.assetType,
          marketValue: toNumber(position.marketValue),
          quantity: toNumber(position.quantity),
          symbol: position.symbol,
          theme: position.theme,
        },
      ]),
    );
    const instruments = await this.instrumentMap(orders.map((item) => item.symbol));
    const preViolations: PortfolioRiskViolation[] = [];
    for (const order of orders) {
      const current = positionMap.get(order.symbol) ?? {
        assetType: instruments.get(order.symbol)?.assetType ?? "STOCK",
        marketValue: 0,
        quantity: 0,
        symbol: order.symbol,
        theme: instruments.get(order.symbol)?.theme ?? null,
      };
      if (order.side === "SELL" && order.quantity > current.quantity + 1e-8) {
        preViolations.push({
          code: "NAKED_SHORT",
          level: "VIOLATION",
          message: `${order.symbol} 组合持仓不足，禁止裸空`,
        });
      }
      const signedValue = order.quantity * order.referencePrice * (order.side === "BUY" ? 1 : -1);
      current.marketValue = Math.max(0, current.marketValue + signedValue);
      current.quantity = Math.max(
        0,
        current.quantity + order.quantity * (order.side === "BUY" ? 1 : -1),
      );
      positionMap.set(order.symbol, current);
    }
    const positions = [...positionMap.values()];
    const leveragedExposure = positions
      .filter((item) => item.assetType === "LEVERAGED_ETF")
      .reduce((sum, item) => sum + item.marketValue, 0);
    const correlations = await this.correlationRiskRows(portfolio);
    const evaluated = evaluatePortfolioRisk({
      cashAfterOrders: estimates.cashAfter,
      cashReservePercent: toNumber(portfolio.cashReservePercent),
      correlations,
      currentDrawdownPercent: Math.abs(toNumber(portfolio.maxDrawdown)),
      dailyLossPercent: Math.max(
        0,
        -(portfolio.snapshots.at(-1) ? toNumber(portfolio.snapshots.at(-1)?.dailyReturn) : 0),
      ),
      equity: toNumber(portfolio.totalEquity),
      leveragedExposure,
      losingStrategyCount: portfolio.strategies.filter((item) => toNumber(item.realizedPnl) < 0)
        .length,
      maxConcurrentPositions: rule.maxConcurrentPositions,
      positionsAfterOrders: positions,
      proposedOrders: orders.map((order) => ({
        side: order.side,
        strategyIds: [...new Set(order.allocations.map((item) => item.portfolioStrategyId))],
        symbol: order.symbol,
      })),
      rules: this.riskRuleNumbers(rule),
      strategyAllocations: portfolio.strategies.map((item) => ({
        drawdownContributionPercent: Math.abs(
          toNumber(
            portfolio.attributions.filter((row) => row.portfolioStrategyId === item.id).at(-1)
              ?.riskContribution,
          ),
        ),
        id: item.id,
        percent: toNumber(item.targetAllocationPercent),
      })),
    });
    const symbolExposure = new Map<string, number>();
    const themeExposure = new Map<string, number>();
    for (const position of positions) {
      symbolExposure.set(
        position.symbol,
        (symbolExposure.get(position.symbol) ?? 0) + position.marketValue,
      );
      const theme = position.theme ?? "UNCLASSIFIED";
      themeExposure.set(theme, (themeExposure.get(theme) ?? 0) + position.marketValue);
    }
    const violations = [...preViolations, ...evaluated.violations];
    return {
      allowed: evaluated.allowed && !preViolations.some((item) => item.level === "VIOLATION"),
      projected: {
        leveragedExposure,
        positions,
        symbolExposure: Object.fromEntries(symbolExposure),
        themeExposure: Object.fromEntries(themeExposure),
      },
      violations,
    };
  }

  private async correlationRiskRows(portfolio: PortfolioBundle) {
    const dates = [
      ...new Set(
        portfolio.attributions.map((item) => item.attributionDate.toISOString().slice(0, 10)),
      ),
    ].sort();
    if (dates.length < 2 || portfolio.strategies.length < 2) return [];
    const analysis = (await this.analyze(portfolio.id)) as {
      strategyCorrelationMatrix?: Record<string, Record<string, number>>;
    };
    const rows: Array<{
      allocationPercent: number;
      correlation: number;
      left: string;
      right: string;
    }> = [];
    for (let leftIndex = 0; leftIndex < portfolio.strategies.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < portfolio.strategies.length;
        rightIndex += 1
      ) {
        const left = portfolio.strategies[leftIndex]!;
        const right = portfolio.strategies[rightIndex]!;
        rows.push({
          allocationPercent:
            toNumber(left.targetAllocationPercent) + toNumber(right.targetAllocationPercent),
          correlation:
            analysis.strategyCorrelationMatrix?.[left.strategy.code]?.[right.strategy.code] ?? 0,
          left: left.id,
          right: right.id,
        });
      }
    }
    return rows;
  }

  private async refreshAttribution(portfolioId: string, date: string) {
    const members = await this.prisma.portfolioStrategy.findMany({
      where: { portfolioId },
      include: { fillAllocations: true, positions: true },
    });
    for (const member of members) {
      const fills = member.fillAllocations.filter(
        (item) => item.createdAt.toISOString().slice(0, 10) <= date,
      );
      const realized = fills.reduce((sum, item) => sum + toNumber(item.realizedPnl), 0);
      const commission = fills.reduce((sum, item) => sum + toNumber(item.commission), 0);
      const slippage = fills.reduce((sum, item) => sum + toNumber(item.slippage), 0);
      const unrealized = member.positions.reduce(
        (sum, item) => sum + toNumber(item.unrealizedPnl),
        0,
      );
      const capital = Math.max(toNumber(member.virtualCapital), 1);
      await this.prisma.portfolioPerformanceAttribution.upsert({
        where: {
          portfolioId_portfolioStrategyId_attributionDate: {
            attributionDate: dateOnly(date),
            portfolioId,
            portfolioStrategyId: member.id,
          },
        },
        create: {
          allocatedContribution: ((realized + unrealized - commission - slippage) / capital) * 100,
          attributionDate: dateOnly(date),
          cashDrag: Math.max(0, toNumber(member.virtualCash)) * 0.0001,
          commissionImpact: commission,
          detailsJson: JSON.stringify({ capital, realized, unrealized }),
          portfolioId,
          portfolioStrategyId: member.id,
          riskContribution: 0,
          riskOpportunityCost: 0,
          slippageImpact: slippage,
          strategyReturn: ((realized + unrealized) / capital) * 100,
        },
        update: {
          allocatedContribution: ((realized + unrealized - commission - slippage) / capital) * 100,
          cashDrag: Math.max(0, toNumber(member.virtualCash)) * 0.0001,
          commissionImpact: commission,
          detailsJson: JSON.stringify({ capital, realized, unrealized }),
          slippageImpact: slippage,
          strategyReturn: ((realized + unrealized) / capital) * 100,
        },
      });
    }
  }

  private async cancelOpenOrders(portfolioId: string, reason: string, memberId?: string) {
    const result = await this.prisma.portfolioOrder.updateMany({
      where: {
        portfolioId,
        status: { in: ["CREATED", "APPROVED", "WAITING_MARKET_DATA"] },
        ...(memberId ? { allocations: { some: { portfolioStrategyId: memberId } } } : {}),
      },
      data: { cancelledAt: new Date(), rejectionReason: reason, status: "CANCELLED" },
    });
    await this.audit(portfolioId, "PORTFOLIO_ORDERS_CANCELLED", {
      count: result.count,
      memberId: memberId ?? null,
      reason,
    });
    return result;
  }

  private async cancelOrder(orderId: string, portfolioId: string, reason: string) {
    return this.prisma.$transaction(async (transaction) => {
      const order = await transaction.portfolioOrder.update({
        where: { id: orderId },
        data: { cancelledAt: new Date(), rejectionReason: reason, status: "CANCELLED" },
      });
      await transaction.portfolioAuditEvent.create({
        data: {
          eventType: "PORTFOLIO_ORDER_CANCELLED",
          payloadJson: JSON.stringify({ reason }),
          portfolioId,
          portfolioOrderId: orderId,
        },
      });
      return order;
    });
  }

  private nextTradingDay(input: string) {
    const cursor = dateOnly(input);
    for (let offset = 0; offset < 15; offset += 1) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      const session = this.calendar.session(cursor.toISOString().slice(0, 10));
      if (session.isTradingDay) return session.date;
    }
    throw new BadRequestException("无法确定下一美股交易日");
  }

  private addDays(input: string, days: number) {
    const date = dateOnly(input);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  private async priceMap(symbols: string[], date: string, allowPrior = false) {
    const result = new Map<string, { close: number; open: number }>();
    for (const symbol of symbols) {
      const row = await this.prisma.marketDataDaily.findFirst({
        where: {
          symbol,
          tradeDate: allowPrior ? { lte: dateOnly(date) } : dateOnly(date),
        },
        orderBy: { tradeDate: "desc" },
      });
      if (row) result.set(symbol, { close: toNumber(row.adjustedClose), open: toNumber(row.open) });
    }
    return result;
  }

  private async benchmarkEquity(portfolio: PortfolioBundle, date: string) {
    const firstSnapshot = portfolio.snapshots.at(0);
    const baseDate = firstSnapshot?.snapshotDate.toISOString().slice(0, 10) ?? date;
    const [base, current] = await Promise.all([
      this.prisma.marketDataDaily.findFirst({
        where: { symbol: "QQQM", tradeDate: { lte: dateOnly(baseDate) } },
        orderBy: { tradeDate: "desc" },
      }),
      this.prisma.marketDataDaily.findFirst({
        where: { symbol: "QQQM", tradeDate: { lte: dateOnly(date) } },
        orderBy: { tradeDate: "desc" },
      }),
    ]);
    if (!base || !current || toNumber(base.adjustedClose) <= 0) {
      return firstSnapshot?.benchmarkEquity
        ? toNumber(firstSnapshot.benchmarkEquity)
        : toNumber(portfolio.initialCapital);
    }
    return roundMoney(
      toNumber(portfolio.initialCapital) *
        (toNumber(current.adjustedClose) / toNumber(base.adjustedClose)),
    );
  }

  private async instrumentMap(symbols: string[]) {
    const instruments = await this.prisma.instrument.findMany({
      where: { symbol: { in: [...new Set(symbols)] } },
    });
    return new Map(instruments.map((item) => [item.symbol, item]));
  }

  private async requirePortfolio(id: string) {
    const portfolio = await this.prisma.strategyPortfolio.findUnique({ where: { id } });
    if (!portfolio) throw new NotFoundException("策略组合不存在");
    return portfolio;
  }

  private async latestRiskRule(portfolioId: string) {
    const rule = await this.prisma.portfolioRiskRule.findFirst({
      where: { portfolioId },
      orderBy: { version: "desc" },
    });
    if (!rule) throw new BadRequestException("组合风控规则缺失；默认拒绝");
    return rule;
  }

  private bundleInclude() {
    return {
      allocationRules: { orderBy: { version: "asc" as const } },
      attributions: { orderBy: { attributionDate: "asc" as const } },
      auditEvents: { orderBy: { createdAt: "desc" as const }, take: 100 },
      cashMovements: { orderBy: { eventTime: "desc" as const }, take: 100 },
      orders: {
        include: { allocations: true, fills: { include: { allocations: true } } },
        orderBy: { createdAt: "desc" as const },
        take: 100,
      },
      positions: { orderBy: { symbol: "asc" as const } },
      rebalanceRuns: { orderBy: { createdAt: "desc" as const }, take: 50 },
      riskRules: { orderBy: { version: "asc" as const } },
      snapshots: { orderBy: { snapshotDate: "asc" as const } },
      strategies: {
        include: { deployment: true, positions: true, strategy: true },
        orderBy: { priority: "asc" as const },
      },
    };
  }

  private async bundle(id: string) {
    const portfolio = await this.prisma.strategyPortfolio.findUnique({
      where: { id },
      include: this.bundleInclude(),
    });
    if (!portfolio) throw new NotFoundException("策略组合不存在");
    return portfolio as PortfolioBundle;
  }

  private async audit(portfolioId: string, eventType: string, payload: unknown) {
    return this.prisma.portfolioAuditEvent.create({
      data: { eventType, payloadJson: JSON.stringify(payload), portfolioId },
    });
  }

  private serializeBundle(portfolio: PortfolioBundle) {
    return {
      ...this.serializePortfolioBase(portfolio),
      allocationRules: portfolio.allocationRules.map((item) => ({
        ...item,
        configuration: JSON.parse(item.configurationJson) as unknown,
      })),
      attributions: portfolio.attributions.map((item) => this.serializeAttribution(item)),
      auditEvents: portfolio.auditEvents.map((item) => ({
        ...item,
        payload: JSON.parse(item.payloadJson) as unknown,
      })),
      cashMovements: portfolio.cashMovements.map((item) => ({
        ...item,
        amount: toNumber(item.amount),
        balanceAfter: toNumber(item.balanceAfter),
      })),
      orders: portfolio.orders.map((item) => this.serializeOrder(item)),
      positions: portfolio.positions.map((item) => this.serializePosition(item)),
      rebalanceRuns: portfolio.rebalanceRuns.map((item) => this.serializeRun(item)),
      riskRules: portfolio.riskRules.map((item) => this.serializeRiskRule(item)),
      snapshots: portfolio.snapshots.map((item) => this.serializeSnapshot(item)),
      strategies: portfolio.strategies.map((item) => this.serializeMember(item)),
    };
  }

  private serializePortfolioBase<
    T extends Prisma.StrategyPortfolioGetPayload<Record<string, never>>,
  >(portfolio: T) {
    return {
      ...portfolio,
      cashBalance: toNumber(portfolio.cashBalance),
      cashReservePercent: toNumber(portfolio.cashReservePercent),
      initialCapital: toNumber(portfolio.initialCapital),
      maxDrawdown: toNumber(portfolio.maxDrawdown),
      peakEquity: toNumber(portfolio.peakEquity),
      realizedPnl: toNumber(portfolio.realizedPnl),
      totalEquity: toNumber(portfolio.totalEquity),
      unrealizedPnl: toNumber(portfolio.unrealizedPnl),
    };
  }

  private serializeMember(member: PortfolioBundle["strategies"][number]) {
    return {
      ...member,
      manualAmount: toNumber(member.manualAmount),
      maxCapitalPercent: toNumber(member.maxCapitalPercent),
      positions: member.positions.map((item) => ({
        ...item,
        avgCost: toNumber(item.avgCost),
        currentPrice: toNumber(item.currentPrice),
        marketValue: toNumber(item.marketValue),
        quantity: toNumber(item.quantity),
        realizedPnl: toNumber(item.realizedPnl),
        unrealizedPnl: toNumber(item.unrealizedPnl),
      })),
      realizedPnl: toNumber(member.realizedPnl),
      strategy: {
        ...member.strategy,
        initialCapital: toNumber(member.strategy.initialCapital),
        symbolUniverse: JSON.parse(member.strategy.symbolUniverse) as string[],
      },
      targetAllocationPercent: toNumber(member.targetAllocationPercent),
      virtualCapital: toNumber(member.virtualCapital),
      virtualCash: toNumber(member.virtualCash),
    };
  }

  private serializeRiskRule(rule: Prisma.PortfolioRiskRuleGetPayload<Record<string, never>>) {
    return { ...rule, ...this.riskRuleNumbers(rule) };
  }

  private async assertNotLockdown() {
    const connection = await this.prisma.brokerConnection.findUnique({
      where: { id: "broker-connection-ibkr-readonly" },
      select: { safetyState: true },
    });
    if (connection?.safetyState === "LOCKDOWN") {
      throw new BadRequestException("全局安全状态为 LOCKDOWN，禁止生成新的组合模拟订单");
    }
  }

  private riskRuleNumbers(rule: Prisma.PortfolioRiskRuleGetPayload<Record<string, never>>) {
    return {
      correlatedStrategiesMaxPercent: toNumber(rule.correlatedStrategiesMaxPercent),
      correlationThreshold: toNumber(rule.correlationThreshold),
      leveragedEtfMaxPercent: toNumber(rule.leveragedEtfMaxPercent),
      leveragedStrategyMaxPercent: toNumber(rule.leveragedStrategyMaxPercent),
      maxDailyLossPercent: toNumber(rule.maxDailyLossPercent),
      maxDrawdownPercent: toNumber(rule.maxDrawdownPercent),
      maxLosingStrategies: rule.maxLosingStrategies,
      maxStrategyDrawdownContributionPercent: toNumber(rule.maxStrategyDrawdownContributionPercent),
      minCashPercent: toNumber(rule.minCashPercent),
      singleStrategyMaxPercent: toNumber(rule.singleStrategyMaxPercent),
      singleSymbolMaxPercent: toNumber(rule.singleSymbolMaxPercent),
      singleThemeMaxPercent: toNumber(rule.singleThemeMaxPercent),
    };
  }

  private serializeSnapshot(
    snapshot: Prisma.PortfolioEquitySnapshotGetPayload<Record<string, never>>,
  ) {
    return {
      ...snapshot,
      benchmarkEquity: toNumber(snapshot.benchmarkEquity),
      cashBalance: toNumber(snapshot.cashBalance),
      dailyReturn: toNumber(snapshot.dailyReturn),
      drawdown: toNumber(snapshot.drawdown),
      exposure: JSON.parse(snapshot.exposureJson) as unknown,
      positionValue: toNumber(snapshot.positionValue),
      realizedPnl: toNumber(snapshot.realizedPnl),
      totalEquity: toNumber(snapshot.totalEquity),
      totalReturn: toNumber(snapshot.totalReturn),
      unrealizedPnl: toNumber(snapshot.unrealizedPnl),
    };
  }

  private serializePosition(position: Prisma.PortfolioPositionGetPayload<Record<string, never>>) {
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

  private serializeOrder(
    order: Prisma.PortfolioOrderGetPayload<Record<string, never>> & {
      allocations?: unknown;
      fills?: unknown;
    },
  ) {
    return {
      ...order,
      approvedQuantity: toNumber(order.approvedQuantity),
      commissionRate: toNumber(order.commissionRate),
      referencePrice: toNumber(order.referencePrice),
      requestedAmount: toNumber(order.requestedAmount),
      requestedQuantity: toNumber(order.requestedQuantity),
      slippageRate: toNumber(order.slippageRate),
    };
  }

  private serializeRun(run: Prisma.PortfolioRebalanceRunGetPayload<Record<string, never>>) {
    return {
      ...run,
      afterAllocation: JSON.parse(run.afterAllocationJson) as unknown,
      beforeAllocation: JSON.parse(run.beforeAllocationJson) as unknown,
      estimatedCash: toNumber(run.estimatedCash),
      estimatedCommission: toNumber(run.estimatedCommission),
      estimatedOrders: JSON.parse(run.estimatedOrdersJson) as unknown,
      netIntents: JSON.parse(run.netIntentsJson) as unknown,
      rawSignals: JSON.parse(run.rawSignalsJson) as unknown,
      riskResult: JSON.parse(run.riskResultJson) as unknown,
    };
  }

  private serializeAttribution(
    item: Prisma.PortfolioPerformanceAttributionGetPayload<Record<string, never>>,
  ) {
    return {
      ...item,
      allocatedContribution: toNumber(item.allocatedContribution),
      cashDrag: toNumber(item.cashDrag),
      commissionImpact: toNumber(item.commissionImpact),
      details: JSON.parse(item.detailsJson) as unknown,
      riskContribution: toNumber(item.riskContribution),
      riskOpportunityCost: toNumber(item.riskOpportunityCost),
      slippageImpact: toNumber(item.slippageImpact),
      strategyReturn: toNumber(item.strategyReturn),
    };
  }
}
